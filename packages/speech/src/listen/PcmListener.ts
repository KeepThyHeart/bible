/** IListener over a PCM microphone, a VAD and a PCM STT engine (Whisper). */

import type {
  IListener,
  IMicrophone,
  ISttEngine,
  IVoiceActivityDetector,
  ListenOptions,
  ListenOutcome,
  MicStream,
  SttCapabilities,
  Transcript,
} from '@bible/core/speech';

export interface PcmListenerDeps {
  mic: IMicrophone;
  vad: () => IVoiceActivityDetector;
  engine: ISttEngine;
  modelId: () => string;
  now?: () => number;
  /** Returns a cancel function. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

const FRAME_MS = 20;
const PRE_ROLL_FRAMES = 300 / FRAME_MS;
const TRAIL_KEEP_FRAMES = 200 / FRAME_MS;
const MIN_SPEECH_MS = 250;
const PARTIAL_EVERY_MS = 1500;
const COMPLETE_END_SILENCE_MS = 700;

const defaultTimer = (fn: () => void, ms: number): (() => void) => {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
};

function micErrorCode(e: unknown): 'mic-denied' | 'mic-busy' {
  const x = e as { code?: string; name?: string } | null;
  if (x?.code === 'mic-denied' || x?.code === 'mic-busy') return x.code;
  if (x?.name === 'mic-denied' || x?.name === 'mic-busy') return x.name;
  return x?.name === 'NotAllowedError' || x?.name === 'SecurityError' ? 'mic-denied' : 'mic-busy';
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

export class PcmListener implements IListener {
  readonly id = 'pcm:whisper';
  readonly capabilities: SttCapabilities;

  constructor(private readonly deps: PcmListenerDeps) {
    this.capabilities = {
      streaming: false,
      partials: true,
      wordTimestamps: deps.engine.capabilities.wordTimestamps,
      wordConfidence: deps.engine.capabilities.wordConfidence,
      biasing: deps.engine.capabilities.biasing,
      onDevice: true,
      offline: true,
      needsDownload: deps.engine.capabilities.needsDownload,
      languages: deps.engine.capabilities.languages,
    };
  }

  /**
   * True from the first detected speech until the transcript is back. The service holds its
   * "nobody spoke" timer while this is on: the engine is not streaming, so a long utterance
   * only produces its outcome after the speaker has stopped.
   */
  capturing = false;

  async listen(o: ListenOptions, signal: AbortSignal): Promise<ListenOutcome> {
    try {
      return await this.listenInner(o, signal);
    } finally {
      this.capturing = false;
    }
  }

  private async listenInner(o: ListenOptions, signal: AbortSignal): Promise<ListenOutcome> {
    if (signal.aborted) return { kind: 'aborted' };
    const { engine } = this.deps;
    const now = this.deps.now ?? Date.now;
    const setTimer = this.deps.setTimer ?? defaultTimer;
    const cancels: (() => void)[] = [];
    const work = new AbortController(); // cancels in-flight partials and the final decode
    let stream: MicStream | undefined;
    let unsub: (() => void) | undefined;
    let finish: (r: 'silence' | 'max' | 'no-speech' | 'aborted') => void = () => {};
    const done = new Promise<'silence' | 'max' | 'no-speech' | 'aborted'>((res) => {
      finish = res;
    });
    const onAbort = (): void => finish('aborted');
    signal.addEventListener('abort', onAbort, { once: true });
    const closeMic = (): void => {
      unsub?.();
      unsub = undefined;
      stream?.close();
      stream = undefined;
    };

    try {
      try {
        if (!(await engine.isModelReady(this.deps.modelId()))) {
          return { kind: 'error', code: 'engine', message: 'not-ready' };
        }
      } catch (e) {
        return { kind: 'error', code: 'engine', message: message(e) };
      }
      try {
        stream = await this.deps.mic.open({ echoCancellation: true, noiseSuppression: true }, signal);
      } catch (e) {
        if (signal.aborted) return { kind: 'aborted' };
        return { kind: 'error', code: micErrorCode(e), message: message(e) };
      }
      if (signal.aborted) return { kind: 'aborted' };

      const vad = this.deps.vad();
      vad.reset();
      const wantPartials = !!(o.onPartial || o.isComplete);
      let preRoll: Float32Array[] = [];
      let frames: Float32Array[] = [];
      let speaking = false;
      let speechFrames = 0;
      let silentFrames = 0;
      let complete = false;
      let busy = false;
      let lastPartialAt = 0;
      let ended = false;

      const stop = (r: 'silence' | 'max' | 'no-speech' | 'aborted'): void => {
        if (ended) return;
        ended = true;
        closeMic();
        finish(r);
      };
      const endFrames = (): number => Math.ceil((complete ? COMPLETE_END_SILENCE_MS : o.endSilenceMs) / FRAME_MS);

      const partial = (): void => {
        busy = true;
        lastPartialAt = now();
        engine
          .transcribe(concat(frames), { language: o.language, bias: o.bias }, work.signal)
          .then((t) => {
            if (ended) return;
            const p: Transcript = { ...t, final: false };
            o.onPartial?.(p);
            if (o.isComplete?.(p)) {
              complete = true;
              if (silentFrames >= endFrames()) stop('silence');
            }
          })
          .catch(() => {}) // a failed partial is dropped; the final decode reports errors
          .finally(() => {
            busy = false;
          });
      };

      cancels.push(setTimer(() => stop(speaking ? 'max' : 'no-speech'), speaking ? o.maxDurationMs : o.noSpeechTimeoutMs));
      unsub = stream.onFrame((f) => {
        if (ended) return;
        const isSpeech = vad.process(f) === 'speech';
        if (!speaking) {
          preRoll.push(f);
          if (preRoll.length > PRE_ROLL_FRAMES + 1) preRoll.shift();
          if (!isSpeech) return;
          speaking = true;
          this.capturing = true;
          frames = preRoll;
          preRoll = [];
          lastPartialAt = now();
          cancels.splice(0).forEach((c) => c());
          cancels.push(setTimer(() => stop('max'), o.maxDurationMs));
        } else {
          frames.push(f);
        }
        if (isSpeech) {
          speechFrames++;
          silentFrames = 0;
        } else if (++silentFrames >= endFrames()) {
          stop('silence');
          return;
        }
        if (wantPartials && !busy && speechFrames * FRAME_MS >= MIN_SPEECH_MS && now() - lastPartialAt >= PARTIAL_EVERY_MS) {
          partial();
        }
      });

      const reason = await done;
      closeMic();
      work.abort(); // drop any in-flight partial
      if (reason === 'aborted' || signal.aborted) return { kind: 'aborted' };
      if (reason === 'no-speech' || !speaking || speechFrames * FRAME_MS < MIN_SPEECH_MS) return { kind: 'no-speech' };

      const keep = reason === 'silence' ? frames.length - Math.max(0, silentFrames - TRAIL_KEEP_FRAMES) : frames.length;
      try {
        const t = await engine.transcribe(
          concat(frames.slice(0, keep)),
          { language: o.language, bias: o.bias },
          signal,
        );
        if (signal.aborted) return { kind: 'aborted' };
        if (!t.text.trim()) return { kind: 'no-speech' };
        return { kind: 'speech', transcript: { ...t, final: true } };
      } catch (e) {
        if (signal.aborted) return { kind: 'aborted' };
        return { kind: 'error', code: 'engine', message: message(e) };
      }
    } finally {
      cancels.splice(0).forEach((c) => c());
      signal.removeEventListener('abort', onAbort);
      work.abort();
      closeMic();
    }
  }
}
