/**
 * On-device speech as an `IAudioProvider`: one instance per registered engine
 * (`tts:piper`, `tts:kokoro`, ...).
 *
 * The provider is glue. It picks a voice for a translation's language, makes
 * sure the engine has it, fetches the chapter's verse text through `source`
 * (whatever the app uses to read the Bible: the network, OPFS, a test double),
 * and hands the player a `TtsChapterAudio`. The engine itself is behind
 * `ITtsEngine`; nothing here knows about Piper, workers or WASM.
 */

import type {
  AudioCapabilities,
  AudioError,
  AudioVoice,
  ChapterRef,
  IAudioProvider,
  IChapterAudio,
  ITextPreparer,
  ITtsEngine,
  LoadProgress,
  OpenChapterOptions,
  TtsEngineConfig,
  VerseText,
} from '@bible/core/browser';
import { TtsChapterAudio, type LookAhead } from './TtsChapterAudio';
import { abortedError, toTtsError } from './ttsErrors';
import { documentVisibility, type PageVisibility } from './visibility';

export type VerseTextSource = (ref: ChapterRef, signal: AbortSignal) => Promise<VerseText[]>;

export interface TtsProviderOptions {
  /** BCP-47 language of a translation (from the module list). */
  languageOf(moduleAbbr: string): string;
  /** The localized book name for the spoken chapter intro. */
  bookName(ref: ChapterRef, language: string): string;
  /** The engine's site configuration, for `defaultVoices`. */
  config?: TtsEngineConfig;
  /** Language assumed when a call names no translation (`isReady`, `prepare`). */
  defaultLanguage?: string;
  lookAhead?: Partial<LookAhead>;
  longVerseChars?: number;
  visibility?: PageVisibility;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

const DEFAULT_LOOK_AHEAD: LookAhead = { verses: 3, seconds: 30 };
const FALLBACK_PLAYER_RATE = { min: 0.75, max: 1.5, step: 0.05 };

const primary = (lang: string): string => lang.toLowerCase().split(/[-_]/)[0];
const unsupported = (message: string): AudioError => ({ code: 'unsupported', message, retryable: false });
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * The voice to use for a language: an explicit id the engine lists, else the
 * configured default for the language, else the first voice for it. An
 * explicit id the engine does not list falls through rather than failing (a
 * stored preference for a voice the operator has since removed).
 */
export function resolveVoice(
  voices: AudioVoice[],
  language: string,
  explicitId?: string,
  defaults?: Record<string, string>,
): AudioVoice | undefined {
  const lang = primary(language);
  const forLang = voices.filter(v => primary(v.language) === lang);
  const explicit = explicitId ? voices.find(v => v.id === explicitId) : undefined;
  if (explicit) return explicit;
  const configured = defaults?.[lang] ? forLang.find(v => v.id === defaults[lang]) : undefined;
  return configured ?? forLang[0];
}

export class TtsAudioProvider implements IAudioProvider {
  readonly id: string;
  readonly kind = 'tts' as const;
  readonly label: string;

  private readonly visibility: PageVisibility;
  private readonly lookAhead: LookAhead;
  private readonly longVerseChars: number;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;
  private warm: { key: string; chapter: Promise<TtsChapterAudio>; adopted: boolean } | null = null;

  constructor(
    private readonly engine: ITtsEngine,
    private readonly text: ITextPreparer,
    private readonly source: VerseTextSource,
    private readonly opts: TtsProviderOptions,
  ) {
    this.id = `tts:${engine.id}`;
    this.label = engine.label;
    this.visibility = opts.visibility ?? documentVisibility();
    this.lookAhead = { ...DEFAULT_LOOK_AHEAD, ...opts.lookAhead };
    this.longVerseChars = opts.longVerseChars ?? 400;
    this.createObjectURL = opts.createObjectURL ?? (b => URL.createObjectURL(b));
    this.revokeObjectURL = opts.revokeObjectURL ?? (u => URL.revokeObjectURL(u));
  }

  /** Whether the engine changes speed itself (true), or the media element must (false). */
  private get engineRate(): boolean {
    return this.engine.capabilities.nativeRate;
  }

  capabilities(_moduleAbbr: string): AudioCapabilities {
    const range = this.engine.capabilities.rate;
    return {
      rate: this.engineRate ? range : (range ?? FALLBACK_PLAYER_RATE),
      rateMode: this.engineRate ? 'engine' : 'player',
      voices: true,
      onDevice: true,
      offline: true,
      needsDownload: true,
    };
  }

  async supports(_moduleAbbr: string, language: string): Promise<boolean> {
    try {
      if (!(await this.engine.isSupported())) return false;
      const lang = primary(language);
      return (await this.engine.listVoices()).some(v => primary(v.language) === lang);
    } catch {
      return false;
    }
  }

  async voices(_moduleAbbr: string, language: string): Promise<AudioVoice[]> {
    const lang = primary(language);
    return (await this.engine.listVoices()).filter(v => primary(v.language) === lang);
  }

  async isReady(voiceId?: string): Promise<boolean> {
    const voice = await this.voiceFor(this.opts.defaultLanguage ?? 'en', voiceId);
    return this.engine.isVoiceReady(voice.id);
  }

  async prepare(voiceId: string | undefined, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    if (!(await this.engine.isSupported())) throw unsupported('This browser cannot run on-device speech.');
    const voice = await this.voiceFor(this.opts.defaultLanguage ?? 'en', voiceId);
    await this.engine.prepare(voice.id, onProgress, signal);
  }

  async openChapter(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<IChapterAudio> {
    const key = this.chapterKey(ref, opts);
    const warm = this.warm;
    if (warm && warm.key === key && !warm.adopted) {
      warm.adopted = true;
      this.warm = null;
      try {
        const chapter = await warm.chapter;
        if (signal.aborted) { chapter.dispose(); throw abortedError(); }
        return chapter;
      } catch (e) {
        if ((e as { code?: string })?.code === 'aborted' && !signal.aborted) {
          // The warm-up was cancelled under us; just build it again.
        } else {
          throw toTtsError(e);
        }
      }
    }
    return this.build(ref, opts, signal, true);
  }

  /** Warm the next chapter: fetch its text and start its first verse. Best effort. */
  async prefetch(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<void> {
    if (this.warm) {
      void this.warm.chapter.then(c => { if (!this.warm?.adopted) c.dispose(); }, () => {});
      this.warm = null;
    }
    const key = this.chapterKey(ref, opts);
    const chapter = this.build(ref, opts, signal, false);
    const entry = { key, chapter, adopted: false };
    this.warm = entry;
    // A prefetch that is cancelled before anyone adopts it is thrown away.
    signal.addEventListener('abort', () => {
      if (entry.adopted) return;
      if (this.warm === entry) this.warm = null;
      void chapter.then(c => c.dispose(), () => {});
    }, { once: true });
    try {
      const c = await chapter;
      c.warm();
    } catch (e) {
      if (this.warm === entry) this.warm = null;
      if ((e as { code?: string })?.code === 'aborted') throw e;
      // Any other failure only means the chapter is built on demand later.
    }
  }

  // -- internals -----------------------------------------------------------

  private chapterKey(ref: ChapterRef, opts: OpenChapterOptions): string {
    return `${ref.moduleAbbr}:${ref.book}:${ref.chapter}:${opts.voiceId ?? ''}:${this.synthRate(opts.rate)}:${opts.readIntro !== false}`;
  }

  private synthRate(requested: number): number {
    if (!this.engineRate) return 1;
    const range = this.engine.capabilities.rate;
    return range ? clamp(requested, range.min, range.max) : requested;
  }

  private async voiceFor(language: string, voiceId?: string): Promise<AudioVoice> {
    const voice = resolveVoice(await this.engine.listVoices(), language, voiceId, this.opts.config?.defaultVoices);
    if (!voice) throw unsupported(`There is no ${language} voice for ${this.engine.label}.`);
    return voice;
  }

  private async build(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal, prepareVoice: boolean): Promise<TtsChapterAudio> {
    const language = this.opts.languageOf(ref.moduleAbbr);
    const voice = await this.voiceFor(language, opts.voiceId);
    if (signal.aborted) throw abortedError();
    if (!(await this.engine.isVoiceReady(voice.id))) {
      // Never download on a background prefetch: only an explicit play may.
      if (!prepareVoice) throw unsupported('The voice is not downloaded yet.');
      await this.engine.prepare(voice.id, opts.onProgress ?? (() => {}), signal);
      if (signal.aborted) throw abortedError();
    }
    const verses = await this.source(ref, signal);
    if (signal.aborted) throw abortedError();
    const chapter = new TtsChapterAudio({
      ref,
      language,
      bookName: this.opts.bookName(ref, language),
      voiceId: voice.id,
      rate: this.synthRate(opts.rate),
      readIntro: opts.readIntro !== false,
      engine: this.engine,
      text: this.text,
      verses,
      lookAhead: this.lookAhead,
      longVerseChars: this.longVerseChars,
      visibility: this.visibility,
      createObjectURL: this.createObjectURL,
      revokeObjectURL: this.revokeObjectURL,
    });
    if (chapter.verses.length === 0) {
      chapter.dispose();
      throw { code: 'not-found', message: 'There is no text to read in this chapter.', retryable: false } satisfies AudioError;
    }
    return chapter;
  }
}
