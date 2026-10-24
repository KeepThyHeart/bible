/**
 * ISpeechApi over a listener, a speaker and a PCM engine.
 *
 * Semantics mirror FakeSpeechApi (core): utterances queue from startListening on, one
 * listen at a time, half duplex (the listen is aborted while sound plays, plus a short
 * tail). Transcripts and audio are never logged.
 */

import type {
  EarconKind,
  IListener,
  ISpeaker,
  ISpeechApi,
  ISttEngine,
  LoadProgress,
  SpeechStatusDto,
  StartListeningDto,
  SttModel,
  UtteranceOutcomeDto,
} from '@bible/core/speech';

export interface SpeechServiceDeps {
  engine: ISttEngine;
  listener: IListener;
  speaker: ISpeaker & { available(lang?: string): Promise<boolean> };
  /** The model id the current prefs and device call for. */
  chooseModel(): Promise<string>;
  /** Delete the model's downloaded files (all variants). */
  removeModel?(id: string): Promise<void>;
  granted?: { listen: boolean; speak: boolean };
  /** Mic stays gated this long after sound ends. Default 250. */
  tailMs?: number;
  /** Pause before reopening the listener after it reports silence. Default 100. */
  idleRetryMs?: number;
  now?: () => number;
}

export interface SpeechModelInfo extends SttModel {
  installed: boolean;
  chosen: boolean;
}

type EndReason = 'max-duration' | 'stopped' | 'aborted';

interface Session {
  id: string;
  dto: StartListeningDto;
  abort: AbortController;
  queue: UtteranceOutcomeDto[];
  ended: EndReason | null;
  deadline: number;
  /** Aborts the in-flight listener call (to restart it after sound). */
  current: AbortController | null;
  /** Wake pending nextUtterance calls. */
  waiters: Set<() => void>;
}

const DEFAULT_LANGUAGE = 'en-US';

export class SpeechService implements ISpeechApi {
  private session: Session | null = null;
  private nextId = 1;
  private prepared: string | null = null;
  private preparing: Promise<void> | null = null;
  private readonly speech = new Set<AbortController>();
  private sounds = 0;
  private quiet: Promise<void> | null = null;
  private quietDone: (() => void) | null = null;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: SpeechServiceDeps) {}

  private get now(): number {
    return (this.d.now ?? Date.now)();
  }

  // ---- status and model management -----------------------------------------------------

  chosen(): Promise<string> {
    return this.d.chooseModel();
  }

  async status(): Promise<SpeechStatusDto> {
    const { engine, speaker } = this.d;
    const model = await this.chosen();
    const listen: SpeechStatusDto['listen'] = !(await engine.isSupported())
      ? 'unavailable'
      : (await engine.isModelReady(model))
        ? 'ready'
        : 'needs-download';
    return {
      granted: { ...(this.d.granted ?? { listen: true, speak: true }) },
      listen,
      speak: (await speaker.available()) ? 'ready' : 'unavailable',
      languages: engine.capabilities.languages,
      engineLabel: `Whisper (${model})`,
      onDevice: true,
    };
  }

  /** For a settings UI: every model with its install state. */
  async models(): Promise<SpeechModelInfo[]> {
    const chosen = await this.chosen();
    const list = await this.d.engine.listModels();
    return Promise.all(
      list.map(async (m) => ({ ...m, installed: await this.d.engine.isModelReady(m.id), chosen: m.id === chosen })),
    );
  }

  async prepareModel(id: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    this.prepared = null;
    await this.d.engine.prepare(id, onProgress, signal);
    this.prepared = id;
  }

  async removeModel(id: string): Promise<void> {
    if (this.prepared === id) this.prepared = null;
    await this.d.removeModel?.(id);
  }

  // ---- speaking (half duplex) ----------------------------------------------------------

  private beginSound(): void {
    if (this.sounds++ === 0) {
      if (this.tailTimer) clearTimeout(this.tailTimer);
      this.tailTimer = null;
      this.quiet ??= new Promise<void>((r) => (this.quietDone = r));
    }
    this.session?.current?.abort();
  }

  private endSound(): void {
    if (--this.sounds > 0) return;
    this.tailTimer = setTimeout(() => {
      this.tailTimer = null;
      const done = this.quietDone;
      this.quiet = this.quietDone = null;
      done?.();
    }, this.d.tailMs ?? 250);
  }

  async speak(text: string, o?: { language?: string; rate?: number }): Promise<{ completed: boolean }> {
    const ac = new AbortController();
    this.speech.add(ac);
    this.beginSound();
    try {
      await this.d.speaker.speak(
        text,
        { language: o?.language ?? DEFAULT_LANGUAGE, ...(o?.rate !== undefined ? { rate: o.rate } : {}) },
        ac.signal,
      );
      return { completed: !ac.signal.aborted };
    } catch {
      return { completed: false };
    } finally {
      this.speech.delete(ac);
      this.endSound();
    }
  }

  async earcon(kind: EarconKind): Promise<void> {
    this.beginSound();
    try {
      await this.d.speaker.earcon(kind);
    } catch {
      /* an earcon is best effort */
    } finally {
      this.endSound();
    }
  }

  // ---- listening -----------------------------------------------------------------------

  private ensurePrepared(model: string, signal: AbortSignal): Promise<void> {
    if (this.prepared === model) return Promise.resolve();
    return (this.preparing ??= (async () => {
      try {
        await this.d.engine.prepare(model, () => undefined, signal);
        this.prepared = model;
      } finally {
        this.preparing = null;
      }
    })());
  }

  async startListening(o: StartListeningDto): Promise<{ listenId: string }> {
    if (this.session && !this.session.ended) throw new Error('busy');
    const s: Session = {
      id: `listen-${this.nextId++}`,
      dto: o,
      abort: new AbortController(),
      queue: [],
      ended: null,
      deadline: this.now + o.maxDurationMs,
      current: null,
      waiters: new Set(),
    };
    this.session = s;
    try {
      const model = await this.chosen();
      if (!(await this.d.engine.isModelReady(model))) throw new Error('not-ready');
      await this.ensurePrepared(model, s.abort.signal);
    } catch (e) {
      if (this.session === s) this.session = null;
      this.finish(s, 'aborted');
      throw e instanceof Error && e.message === 'not-ready' ? e : new Error('not-ready');
    }
    if (s.ended) return { listenId: s.id };
    s.deadline = this.now + o.maxDurationMs; // loading the model is not listening time
    void this.loop(s);
    return { listenId: s.id };
  }

  private finish(s: Session, reason: EndReason): void {
    if (s.ended) return;
    s.ended = reason;
    s.abort.abort();
    s.current?.abort();
    for (const w of [...s.waiters]) w();
  }

  private push(s: Session, outcome: UtteranceOutcomeDto): void {
    s.queue.push(outcome);
    for (const w of [...s.waiters]) w();
  }

  private async loop(s: Session): Promise<void> {
    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        s.abort.signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
      });
    while (!s.ended) {
      if (this.now >= s.deadline) return this.finish(s, 'max-duration');
      if (this.quiet) {
        await this.quiet;
        continue;
      }
      const remaining = s.deadline - this.now;
      const ac = (s.current = new AbortController());
      const sounding = () => this.sounds > 0 || this.quiet !== null;
      let outcome;
      try {
        outcome = await this.d.listener.listen(
          {
            language: s.dto.language,
            ...(s.dto.bias ? { bias: s.dto.bias } : {}),
            noSpeechTimeoutMs: remaining,
            endSilenceMs: s.dto.endSilenceMs ?? 1500,
            maxDurationMs: remaining,
          },
          ac.signal,
        );
      } catch {
        outcome = { kind: 'error', code: 'engine', message: 'listener failed' } as const;
      }
      s.current = null;
      if (s.ended) return;
      // Anything heard while sound played (or that raced it) is the speaker's echo.
      if (sounding() || ac.signal.aborted) continue;
      switch (outcome.kind) {
        case 'speech':
          s.deadline += Math.max(0, outcome.transcript.decodeMs || 0); // decoding is not listening time
          this.push(s, { kind: 'speech', transcript: outcome.transcript });
          break;
        case 'error':
          this.push(s, {
            kind: 'error',
            code: outcome.code === 'network' ? 'engine' : outcome.code,
            message: outcome.message,
          });
          return this.finish(s, 'stopped');
        case 'no-speech':
          await sleep(this.d.idleRetryMs ?? 100);
          break;
        case 'aborted':
          break;
      }
    }
  }

  async nextUtterance(listenId: string, o: { noSpeechTimeoutMs: number }): Promise<UtteranceOutcomeDto> {
    const s = this.session;
    if (!s || s.id !== listenId) return { kind: 'ended', reason: 'stopped' };
    return new Promise<UtteranceOutcomeDto>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = (): boolean => {
        const q = s.queue.shift();
        if (q) resolve(q);
        else if (s.ended) resolve({ kind: 'ended', reason: s.ended });
        else return false;
        if (timer) clearTimeout(timer);
        s.waiters.delete(check);
        return true;
      };
      if (check()) return;
      s.waiters.add(check);
      // "Nobody spoke" only counts while nobody is speaking: a non-streaming listener reports an
      // utterance after it ends, so hold the timer while one is being captured or decoded.
      const fire = (): void => {
        if ((this.d.listener as { capturing?: boolean }).capturing && !s.ended) {
          timer = setTimeout(fire, 250);
          return;
        }
        s.waiters.delete(check);
        resolve({ kind: 'no-speech' });
      };
      timer = setTimeout(fire, o.noSpeechTimeoutMs);
    });
  }

  async stopListening(listenId: string): Promise<void> {
    const s = this.session;
    if (!s || s.id !== listenId) return;
    this.finish(s, 'stopped');
    this.session = null;
    // Late queued items are dropped; waiters got 'ended'.
  }

  async cancel(): Promise<void> {
    for (const ac of this.speech) ac.abort();
    const s = this.session;
    if (!s) return;
    this.finish(s, 'aborted');
    this.session = null;
  }
}
