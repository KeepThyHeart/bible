/**
 * Test doubles for the audio layer. Imported by tests only.
 *
 * They plug into the same seams as the real implementations, so a test (or the
 * Playwright suite) can run the whole feature with no recordings, no TTS engine
 * and no sound: `FakeMediaElement` stands in for `<audio>`, `FakeTtsEngine`
 * produces silence whose length follows the text, and `FakeManifestSource`
 * serves a fixture manifest.
 */

import { buildFixtureManifest } from '@bible/core/browser';
import type {
  AudioNarrator,
  AudioVoice,
  ChapterManifest,
  ChapterRef,
  IManifestSource,
  ITtsEngine,
  LoadProgress,
  SynthesisRequest,
  SynthesisResult,
  TranslationAudioIndex,
  TtsEngineCapabilities,
} from '@bible/core/browser';

/** A minimal, controllable stand-in for HTMLAudioElement. */
export class FakeMediaElement extends EventTarget {
  src = '';
  preload = '';
  currentTime = 0;
  duration = 0;
  paused = true;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  webkitPreservesPitch = false;
  error: { code: number; message: string } | null = null;
  /** What `play()` does: resolve, or reject with a DOMException-like name. */
  playBehaviour: 'ok' | 'NotAllowedError' | 'AbortError' | 'other' = 'ok';
  loadCalls = 0;
  /** When false, `load()` does not fire `loadedmetadata` by itself. */
  autoReady = true;

  load(): void {
    this.loadCalls++;
    this.currentTime = 0;
    if (this.autoReady) queueMicrotask(() => this.fire('loadedmetadata'));
  }

  async play(): Promise<void> {
    if (this.playBehaviour !== 'ok') {
      const e = new Error(this.playBehaviour);
      e.name = this.playBehaviour === 'other' ? 'Error' : this.playBehaviour;
      throw e;
    }
    this.paused = false;
    this.fire('play');
    this.fire('playing');
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.fire('pause');
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  fire(type: string): void {
    this.dispatchEvent(new Event(type));
  }

  /** Move the clock and fire `timeupdate`, as a playing element would. */
  advanceTo(seconds: number): void {
    this.currentTime = seconds;
    this.fire('timeupdate');
  }

  finish(): void {
    this.paused = true;
    this.fire('ended');
  }

  fail(code: number): void {
    this.error = { code, message: 'fake media error' };
    this.fire('error');
  }
}

export function asAudioElement(fake: FakeMediaElement): HTMLAudioElement {
  return fake as unknown as HTMLAudioElement;
}

/** Deferred promise, for tests that need to release an async step by hand. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export class FakeManifestSource implements IManifestSource {
  indexCalls = 0;
  chapterCalls: ChapterRef[] = [];
  /** Modules with recordings. Empty: nothing is recorded anywhere. */
  constructor(
    private readonly index: Record<string, TranslationAudioIndex | null> = {},
    private readonly manifests: Record<string, ChapterManifest | null> = {},
  ) {}

  async translationIndex(moduleAbbr: string): Promise<TranslationAudioIndex | null> {
    this.indexCalls++;
    return this.index[moduleAbbr] ?? null;
  }

  async chapter(ref: ChapterRef, _narrator: AudioNarrator): Promise<ChapterManifest | null> {
    this.chapterCalls.push(ref);
    return this.manifests[`${ref.moduleAbbr}:${ref.book}:${ref.chapter}`] ?? null;
  }

  /** A source holding one recorded translation with the given chapters. */
  static withChapters(
    moduleAbbr: string,
    chapters: Array<{ book: number; chapter: number; verseCount: number; secondsPerVerse?: number; intro?: number }>,
    narratorId = 'fixture-1',
  ): FakeManifestSource {
    const books = Array.from(new Set(chapters.map(c => c.book)));
    const index: TranslationAudioIndex = {
      schema: 'kth-audio-index/1',
      module: moduleAbbr,
      narrators: [{ id: narratorId, label: 'Fixture narrator', language: 'en', rev: '0', books }],
    };
    const manifests: Record<string, ChapterManifest> = {};
    for (const c of chapters) {
      manifests[`${moduleAbbr}:${c.book}:${c.chapter}`] = buildFixtureManifest({
        module: moduleAbbr, narrator: narratorId, ...c,
      });
    }
    return new FakeManifestSource({ [moduleAbbr]: index }, manifests);
  }
}

const FAKE_CAPS: TtsEngineCapabilities = {
  rate: { min: 0.5, max: 2, step: 0.1 },
  nativeRate: true,
  languages: ['en'],
  backends: ['wasm'],
  approxRuntimeBytes: 0,
};

/**
 * A TTS engine that "speaks" silence: 0.05 s per character, at rate 1. Records
 * every request so tests can assert order and cancellation.
 */
export class FakeTtsEngine implements ITtsEngine {
  readonly id: string;
  readonly label: string;
  readonly capabilities: TtsEngineCapabilities;
  requests: SynthesisRequest[] = [];
  prepared = new Set<string>();
  supported = true;
  /** Optional gate a test can hold to keep `synthesize` pending. */
  gate: Promise<void> | null = null;
  failNextWith: Error | null = null;
  disposed = false;
  private readonly voices: AudioVoice[];

  constructor(opts: { id?: string; label?: string; voices?: AudioVoice[]; caps?: Partial<TtsEngineCapabilities> } = {}) {
    this.id = opts.id ?? 'fake';
    this.label = opts.label ?? 'Fake';
    this.capabilities = { ...FAKE_CAPS, ...opts.caps };
    this.voices = opts.voices ?? [{ id: 'fake-en', label: 'Fake English', language: 'en-US', downloadBytes: 1000 }];
  }

  async isSupported(): Promise<boolean> { return this.supported; }
  async listVoices(): Promise<AudioVoice[]> { return this.voices; }
  async isVoiceReady(voiceId: string): Promise<boolean> { return this.prepared.has(voiceId); }

  async prepare(voiceId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
    onProgress({ phase: 'voice', loaded: 0, total: 1000 });
    onProgress({ phase: 'voice', loaded: 1000, total: 1000 });
    this.prepared.add(voiceId);
  }

  async synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    this.requests.push(req);
    if (this.gate) await this.gate;
    if (signal.aborted) throw abortError();
    if (this.failNextWith) { const e = this.failNextWith; this.failNextWith = null; throw e; }
    const sampleRate = 8000;
    const seconds = (req.text.length * 0.05) / req.rate;
    return { pcm: new Float32Array(Math.max(1, Math.round(seconds * sampleRate))), sampleRate };
  }

  async evictVoice(voiceId: string): Promise<void> { this.prepared.delete(voiceId); }
  dispose(): void { this.disposed = true; }
}

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}
