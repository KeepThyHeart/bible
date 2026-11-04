import type { ITtsEngine } from '@bible/core/audio';
import type { ISpeaker } from '@bible/core/speech';
import { playEarcon, type EarconKind } from './earcons';
import { splitSentences } from './sentences';

/** ISpeaker over a TTS engine (Piper) with WebAudio playback. */
export class TtsEngineSpeaker implements ISpeaker {
  private ctx?: AudioContext;

  constructor(
    private readonly engine: ITtsEngine,
    private readonly voiceId: string,
    private readonly makeContext: () => AudioContext = () => new AudioContext(),
  ) {}

  private context(): AudioContext {
    return (this.ctx ??= this.makeContext());
  }

  async speak(text: string, o: { language: string; voiceId?: string; rate?: number }, signal: AbortSignal): Promise<void> {
    const voiceId = o.voiceId ?? this.voiceId;
    for (const chunk of splitSentences(text)) {
      if (signal.aborted) return;
      const { pcm, sampleRate } = await this.engine.synthesize({ text: chunk, voiceId, rate: o.rate ?? 1 }, signal);
      if (signal.aborted) return;
      await this.play(pcm, sampleRate, signal);
    }
  }

  private async play(pcm: Float32Array, sampleRate: number, signal: AbortSignal): Promise<void> {
    const ctx = this.context();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = ctx.createBuffer(1, pcm.length, sampleRate);
    buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      src.onended = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      src.start();
    });
  }

  earcon(kind: EarconKind): Promise<void> {
    return playEarcon(this.context(), kind);
  }
}
