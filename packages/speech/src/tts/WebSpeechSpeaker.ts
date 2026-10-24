import type { ISpeaker } from '@bible/core/speech';
import { playEarcon, type EarconKind } from './earcons';
import { splitSentences } from './sentences';

export interface WebSpeechDeps {
  synth?: SpeechSynthesis;
  Utterance?: new (text: string) => SpeechSynthesisUtterance;
  audioContext?: () => AudioContext;
  /** Wait for `voiceschanged` this long before giving up on an empty voice list. */
  voicesTimeoutMs?: number;
}

const langMatches = (voiceLang: string, lang: string): boolean =>
  voiceLang.toLowerCase().replace('_', '-').split('-')[0] === lang.toLowerCase().split('-')[0];

/** ISpeaker over the browser's speechSynthesis (local OS voices preferred). */
export class WebSpeechSpeaker implements ISpeaker {
  private readonly synth?: SpeechSynthesis;
  private readonly Utterance?: new (text: string) => SpeechSynthesisUtterance;
  private ctx?: AudioContext;

  constructor(private readonly deps: WebSpeechDeps = {}) {
    this.synth = deps.synth ?? (typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined);
    this.Utterance = deps.Utterance ?? (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined);
  }

  private async voices(): Promise<SpeechSynthesisVoice[]> {
    const synth = this.synth;
    if (!synth) return [];
    const now = synth.getVoices();
    if (now.length) return now;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', done);
        resolve();
      };
      const timer = setTimeout(done, this.deps.voicesTimeoutMs ?? 1500);
      synth.addEventListener?.('voiceschanged', done);
    });
    return synth.getVoices();
  }

  private async pick(lang: string, voiceId?: string): Promise<SpeechSynthesisVoice | undefined> {
    const all = await this.voices();
    const byId = voiceId ? all.find((v) => v.voiceURI === voiceId || v.name === voiceId) : undefined;
    if (byId) return byId;
    const matching = all.filter((v) => langMatches(v.lang, lang));
    return matching.find((v) => v.localService) ?? matching[0];
  }

  async available(lang = 'en'): Promise<boolean> {
    return !!this.synth && !!this.Utterance && !!(await this.pick(lang));
  }

  async speak(text: string, o: { language: string; voiceId?: string; rate?: number }, signal: AbortSignal): Promise<void> {
    const { synth, Utterance } = this;
    if (!synth || !Utterance) throw new Error('speechSynthesis unavailable');
    if (signal.aborted) return;
    const voice = await this.pick(o.language, o.voiceId);
    if (!voice) throw new Error(`no voice for ${o.language}`);
    const onAbort = () => synth.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      for (const chunk of splitSentences(text)) {
        if (signal.aborted) return;
        await new Promise<void>((resolve, reject) => {
          const u = new Utterance(chunk);
          u.voice = voice;
          u.lang = voice.lang;
          u.rate = o.rate ?? 1;
          u.onend = () => resolve();
          u.onerror = (e) => {
            const err = (e as SpeechSynthesisErrorEvent).error;
            if (signal.aborted || err === 'interrupted' || err === 'canceled') resolve();
            else reject(new Error(`speech error: ${err}`));
          };
          synth.speak(u);
        });
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async earcon(kind: EarconKind): Promise<void> {
    const make = this.deps.audioContext ?? (() => new AudioContext());
    this.ctx ??= make();
    await playEarcon(this.ctx, kind);
  }
}
