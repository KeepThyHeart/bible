/**
 * Test doubles for the audio layer. Imported by tests only.
 *
 * They plug into the same seams as the real implementations, so a test (or the
 * Playwright suite) can run the whole feature with no recordings, no TTS engine
 * and no sound: `FakeMediaElement` stands in for `<audio>`, `FakeTtsEngine`
 * produces silence whose length follows the text, and `FakeManifestSource`
 * serves a fixture manifest.
 */

import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { buildFixtureManifest } from '@bible/core/browser';
import type {
  AudioCapabilities,
  AudioError,
  AudioNarrator,
  AudioSegment,
  AudioVoice,
  ChapterManifest,
  ChapterRef,
  IAudioOutput,
  IAudioProvider,
  IChapterAudio,
  IManifestSource,
  ITtsEngine,
  LoadProgress,
  OpenChapterOptions,
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
  /** Optional gate a test can hold to keep every `synthesize` pending. */
  gate: Promise<void> | null = null;
  /** When true, each `synthesize` waits for `releaseRequest()`, one at a time. */
  holdRequests = false;
  heldRequests: Array<{ req: SynthesisRequest; d: ReturnType<typeof deferred<void>> }> = [];
  /** Requests that are in flight right now (started, not yet returned). */
  inFlight = 0;
  maxInFlight = 0;
  /** Seconds of "speech" per character at rate 1. */
  secondsPerChar = 0.05;
  sampleRate = 8000;
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
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      if (this.holdRequests) {
        const d = deferred<void>();
        this.heldRequests.push({ req, d });
        await d.promise;
      }
      if (signal.aborted) throw abortError();
      if (this.failNextWith) { const e = this.failNextWith; this.failNextWith = null; throw e; }
      const seconds = (req.text.length * this.secondsPerChar) / req.rate;
      return { pcm: new Float32Array(Math.max(1, Math.round(seconds * this.sampleRate))), sampleRate: this.sampleRate };
    } finally {
      this.inFlight--;
    }
  }

  /** Let the oldest held `synthesize` continue. */
  releaseRequest(index = 0): SynthesisRequest {
    const [entry] = this.heldRequests.splice(index, 1);
    entry.d.resolve();
    return entry.req;
  }

  async evictVoice(voiceId: string): Promise<void> { this.prepared.delete(voiceId); }
  dispose(): void { this.disposed = true; }
}

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

// ---------------------------------------------------------------------------
// Player-level doubles
// ---------------------------------------------------------------------------

/** An `IAudioOutput` a test drives by hand: loads can be held, time and events injected. */
export class FakeOutput implements IAudioOutput {
  currentTime = 0;
  rate = 1;
  loaded: AudioSegment[] = [];
  playCalls = 0;
  pauseCalls = 0;
  seeks: number[] = [];
  /** When true, `load()` stays pending until `releaseLoad()`. */
  holdLoads = false;
  pendingLoads: Array<{ seg: AudioSegment; d: ReturnType<typeof deferred<void>> }> = [];
  /** What `play()` does next: undefined resolves; an object rejects with it. */
  playFails: unknown = undefined;
  private timeCbs = new Set<(t: number) => void>();
  private endedCbs = new Set<() => void>();
  private errorCbs = new Set<(e: AudioError) => void>();

  load(seg: AudioSegment): Promise<void> {
    this.loaded.push(seg);
    const settle = () => { this.currentTime = seg.offset; };
    if (!this.holdLoads) { settle(); return Promise.resolve(); }
    const d = deferred<void>();
    this.pendingLoads.push({ seg, d });
    return d.promise.then(settle);
  }

  /** Resolve the oldest (or given) held load. */
  releaseLoad(index = 0): void {
    const [entry] = this.pendingLoads.splice(index, 1);
    entry.d.resolve();
  }

  failLoad(index = 0, err: unknown = { code: 'network', message: 'x', retryable: true }): void {
    const [entry] = this.pendingLoads.splice(index, 1);
    entry.d.reject(err);
  }

  async play(): Promise<void> {
    this.playCalls++;
    if (this.playFails !== undefined) {
      const e = this.playFails;
      this.playFails = undefined;
      throw e;
    }
  }

  pause(): void { this.pauseCalls++; }
  seek(seconds: number): void { this.seeks.push(seconds); this.currentTime = seconds; }
  onTime(cb: (t: number) => void): () => void { this.timeCbs.add(cb); return () => this.timeCbs.delete(cb); }
  onEnded(cb: () => void): () => void { this.endedCbs.add(cb); return () => this.endedCbs.delete(cb); }
  onError(cb: (e: AudioError) => void): () => void { this.errorCbs.add(cb); return () => this.errorCbs.delete(cb); }

  tick(t: number): void { this.currentTime = t; for (const cb of [...this.timeCbs]) cb(t); }
  end(): void { for (const cb of [...this.endedCbs]) cb(); }
  error(e: AudioError): void { for (const cb of [...this.errorCbs]) cb(e); }
  get listenerCount(): number { return this.timeCbs.size + this.endedCbs.size + this.errorCbs.size; }
}

export function mkSeg(
  id: string,
  verses: Array<[number, number, number]>,
  opts: { offset?: number; duration?: number } = {},
): AudioSegment & { release: Mock } {
  return {
    id, url: `blob:${id}`, mime: 'audio/wav', offset: opts.offset ?? 0, duration: opts.duration,
    verses: verses.map(([verse, start, end]) => ({ verse, start, end })),
    release: vi.fn(),
  };
}

interface Held<T> { verse?: number; signal: AbortSignal; d: ReturnType<typeof deferred<T>> }

/**
 * A chapter of a fake provider. `style: 'whole'` mimics a recording (one
 * segment covering every verse, offset at the requested verse); `'per-verse'`
 * mimics TTS (one short segment per verse, `segmentAfter` walks on).
 */
export class FakeChapterAudio implements IChapterAudio {
  readonly verses: number[];
  segmentForCalls: Array<{ verse: number; signal: AbortSignal }> = [];
  disposed = 0;
  segments: AudioSegment[] = [];
  /** When true, segmentFor/segmentAfter stay pending until `settle()`. */
  hold = false;
  held: Array<Held<AudioSegment | null> & { kind: 'for' | 'after' }> = [];
  afterOverride: ((seg: AudioSegment) => AudioSegment | null) | null = null;
  failSegmentFor: unknown = undefined;
  /** Simulate a provider that does not honour its AbortSignal. */
  ignoreAbort = false;

  constructor(
    readonly ref: ChapterRef,
    verses: number[],
    readonly style: 'whole' | 'per-verse' = 'whole',
    private readonly secondsPerVerse = 10,
    private readonly intro = 0,
  ) {
    this.verses = verses;
  }

  private timing(v: number): [number, number, number] {
    const i = this.verses.indexOf(v);
    const start = this.intro + i * this.secondsPerVerse;
    return [v, start, start + this.secondsPerVerse];
  }

  private make(verse: number): AudioSegment {
    const id = `${this.ref.book}:${this.ref.chapter}:${this.style}:${verse}`;
    const seg = this.style === 'whole'
      ? mkSeg(id, this.verses.map(v => this.timing(v)), {
        offset: verse === this.verses[0] ? 0 : this.timing(verse)[1],
        duration: this.intro + this.verses.length * this.secondsPerVerse,
      })
      : mkSeg(id, [[verse, 0, this.secondsPerVerse]], { duration: this.secondsPerVerse });
    this.segments.push(seg);
    return seg;
  }

  segmentFor(verse: number, signal: AbortSignal): Promise<AudioSegment> {
    this.segmentForCalls.push({ verse, signal });
    if (this.failSegmentFor !== undefined) {
      const e = this.failSegmentFor; this.failSegmentFor = undefined;
      return Promise.reject(e);
    }
    const at = this.verses.find(v => v >= verse) ?? this.verses[this.verses.length - 1];
    if (!this.hold) return Promise.resolve(this.make(at));
    return this.holdIt('for', at, signal) as Promise<AudioSegment>;
  }

  segmentAfter(seg: AudioSegment, signal: AbortSignal): Promise<AudioSegment | null> {
    if (this.afterOverride) return Promise.resolve(this.afterOverride(seg));
    if (this.style === 'whole') return Promise.resolve(null);
    const last = seg.verses[seg.verses.length - 1].verse;
    const i = this.verses.indexOf(last);
    const next = this.verses[i + 1];
    if (next === undefined) return Promise.resolve(null);
    if (!this.hold) return Promise.resolve(this.make(next));
    return this.holdIt('after', next, signal);
  }

  private holdIt(kind: 'for' | 'after', verse: number, signal: AbortSignal): Promise<AudioSegment | null> {
    const d = deferred<AudioSegment | null>();
    const entry = { kind, verse, signal, d };
    this.held.push(entry);
    if (!this.ignoreAbort) signal.addEventListener('abort', () => d.reject(abortError()));
    return d.promise;
  }

  /** Resolve the held call at `index` with a segment for its verse. */
  settle(index = 0): AudioSegment | null {
    const [entry] = this.held.splice(index, 1);
    const seg = entry.verse === undefined ? null : this.make(entry.verse);
    entry.d.resolve(seg);
    return seg;
  }

  dispose(): void { this.disposed++; }
}

export class FakeProvider implements IAudioProvider {
  readonly kind: 'recorded' | 'tts';
  openCalls: Array<{ ref: ChapterRef; opts: OpenChapterOptions; signal: AbortSignal }> = [];
  chapters = new Map<string, FakeChapterAudio>();
  prefetchCalls: Array<{ ref: ChapterRef; signal: AbortSignal }> = [];
  prefetch = (ref: ChapterRef, _o: OpenChapterOptions, signal: AbortSignal): Promise<void> => {
    this.prefetchCalls.push({ ref, signal });
    return Promise.resolve();
  };
  /** When true, `openChapter` stays pending until `settleOpen()`. */
  holdOpen = false;
  heldOpens: Array<{ ref: ChapterRef; d: ReturnType<typeof deferred<IChapterAudio>>; signal: AbortSignal }> = [];
  ready = true;
  prepareCalls = 0;
  openFails: unknown = undefined;
  /** Builds the chapter served for a ref (default: 5 verses in the provider's style). */
  factory: (ref: ChapterRef) => FakeChapterAudio;

  constructor(readonly id = 'recorded', readonly rateMode: 'player' | 'engine' = 'player', readonly label = 'Fake') {
    this.kind = id.startsWith('tts') ? 'tts' : 'recorded';
    this.factory = ref => new FakeChapterAudio(ref, [1, 2, 3, 4, 5], this.kind === 'tts' ? 'per-verse' : 'whole');
  }

  capabilities(): AudioCapabilities {
    return {
      rate: { min: 0.5, max: 2, step: 0.1 }, rateMode: this.rateMode,
      voices: false, onDevice: this.kind === 'tts', offline: false, needsDownload: false,
    };
  }
  async supports(): Promise<boolean> { return true; }
  async voices(): Promise<AudioVoice[]> { return []; }
  async isReady(): Promise<boolean> { return this.ready; }
  async prepare(_v: string | undefined, onProgress: (p: LoadProgress) => void): Promise<void> {
    this.prepareCalls++;
    onProgress({ phase: 'voice', loaded: 1, total: 2 });
    this.ready = true;
  }

  openChapter(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<IChapterAudio> {
    this.openCalls.push({ ref, opts, signal });
    if (this.openFails !== undefined) {
      const e = this.openFails; this.openFails = undefined;
      return Promise.reject(e);
    }
    const key = `${ref.moduleAbbr}:${ref.book}:${ref.chapter}`;
    const chapter = this.factory(ref);
    this.chapters.set(key, chapter);
    if (!this.holdOpen) return Promise.resolve(chapter);
    const d = deferred<IChapterAudio>();
    this.heldOpens.push({ ref, d, signal });
    return d.promise;
  }

  settleOpen(index = 0): FakeChapterAudio {
    const [entry] = this.heldOpens.splice(index, 1);
    const chapter = this.chapters.get(`${entry.ref.moduleAbbr}:${entry.ref.book}:${entry.ref.chapter}`)!;
    entry.d.resolve(chapter);
    return chapter;
  }

  chapter(book: number, chapter: number, module = 'KJV'): FakeChapterAudio {
    return this.chapters.get(`${module}:${book}:${chapter}`)!;
  }
}
