/**
 * The pre-generated channel: an `IAudioProvider` that plays recordings.
 *
 * It is just another provider. It knows nothing about the media element, the
 * queue or the UI; it turns a chapter reference into an `IChapterAudio` whose
 * one segment is the chapter's audio file with the manifest's verse timings.
 *
 * Everything it depends on is injected and replaceable: where manifests come
 * from (`IManifestSource`), how URLs are built (`IAudioLocator`), where files
 * are cached (`IAssetCache`) and what the browser can play (`canPlay`).
 *
 * With no recordings published, `supports()` is false for every translation and
 * the app behaves as if this provider did not exist.
 */

import { manifestTimings, narratorHasChapter, pickPlayableFile } from '@bible/core/browser';
import type {
  AudioCapabilities,
  AudioError,
  AudioNarrator,
  AudioSegment,
  AudioVoice,
  ChapterManifest,
  ChapterRef,
  IAssetCache,
  IAudioLocator,
  IAudioProvider,
  IChapterAudio,
  IManifestSource,
  ManifestFile,
  OpenChapterOptions,
  TranslationAudioIndex,
  VerseTiming,
} from '@bible/core/browser';
import { isAbort } from './HttpManifestSource';

export const RECORDED_PROVIDER_ID = 'recorded';

/** Recorded speed: the media element's playbackRate, pitch preserved. */
const RECORDED_RATE = { min: 0.75, max: 1.5, step: 0.05 } as const;

/** Chapters kept in the cache (least recently played are evicted first). */
export const RECORDED_CACHE_LIMIT = 150;

export interface RecordedAudioOptions {
  cache?: IAssetCache;
  /** True when the browser can play this MIME type. Default: an `<audio>` element's `canPlayType`. */
  canPlay?: (mime: string) => boolean;
  fetchFn?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  /** Object-URL helpers, injectable for tests. */
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  cacheLimit?: number;
}

function defaultCanPlay(): (mime: string) => boolean {
  if (typeof Audio === 'undefined') return () => true;
  const probe = new Audio();
  return mime => probe.canPlayType(mime) !== '';
}

const err = (code: AudioError['code'], message: string, retryable = false): AudioError => ({ code, message, retryable });

function primaryLanguage(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0];
}

export class RecordedAudioProvider implements IAudioProvider {
  readonly id = RECORDED_PROVIDER_ID;
  readonly kind = 'recorded' as const;
  readonly label = 'Recording';

  private readonly cache?: IAssetCache;
  private readonly canPlay: (mime: string) => boolean;
  private readonly fetchFn: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;
  private readonly cacheLimit: number;

  constructor(
    private readonly manifests: IManifestSource,
    private readonly locator: IAudioLocator,
    opts: RecordedAudioOptions = {},
  ) {
    this.cache = opts.cache;
    this.canPlay = opts.canPlay ?? defaultCanPlay();
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.createObjectURL = opts.createObjectURL ?? (b => URL.createObjectURL(b));
    this.revokeObjectURL = opts.revokeObjectURL ?? (u => URL.revokeObjectURL(u));
    this.cacheLimit = opts.cacheLimit ?? RECORDED_CACHE_LIMIT;
  }

  capabilities(_moduleAbbr: string): AudioCapabilities {
    return {
      rate: { ...RECORDED_RATE },
      rateMode: 'player',
      voices: true, // the UI hides the picker unless there is more than one narrator
      onDevice: false,
      offline: true,
      needsDownload: false,
    };
  }

  async supports(moduleAbbr: string, language: string): Promise<boolean> {
    const index = await this.safeIndex(moduleAbbr);
    if (!index || index.narrators.length === 0) return false;
    // A translation's recordings are in its own language; a narrator for another
    // language does not make this translation playable.
    return index.narrators.some(n => !language || primaryLanguage(n.language) === primaryLanguage(language));
  }

  async voices(moduleAbbr: string, language: string): Promise<AudioVoice[]> {
    const index = await this.safeIndex(moduleAbbr);
    if (!index) return [];
    return index.narrators
      .filter(n => !language || primaryLanguage(n.language) === primaryLanguage(language))
      .map(n => ({ id: n.id, label: n.label, language: n.language }));
  }

  async isReady(): Promise<boolean> {
    return true; // nothing to download before the first play
  }

  async prepare(): Promise<void> {
    // Nothing to prepare: manifests and files are fetched per chapter.
  }

  async openChapter(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<IChapterAudio> {
    const { manifest, narrator } = await this.loadManifest(ref, opts, signal);
    const file = pickPlayableFile(manifest, this.canPlay);
    if (!file) throw err('decode', 'This browser cannot play the available recordings.');
    return new RecordedChapterAudio(ref, manifest, narrator, file, () => this.resolveFileUrl(manifest, file, signal), opts.readIntro !== false);
  }

  /** Warm the cache for a chapter about to be played (the player asks for the next one). */
  async prefetch(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<void> {
    let loaded;
    try {
      loaded = await this.loadManifest(ref, opts, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      return; // prefetch is best effort
    }
    const file = pickPlayableFile(loaded.manifest, this.canPlay);
    if (!file) return;
    await this.storeFile(loaded.manifest, file, signal).catch(() => {});
  }

  // -- internals -----------------------------------------------------------

  private async safeIndex(moduleAbbr: string): Promise<TranslationAudioIndex | null> {
    try {
      return await this.manifests.translationIndex(moduleAbbr, new AbortController().signal);
    } catch {
      return null; // offline with nothing cached: report "no recording", not an error
    }
  }

  private async loadManifest(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal) {
    const index = await this.manifests.translationIndex(ref.moduleAbbr, signal);
    if (signal.aborted) throw err('aborted', 'Aborted');
    if (!index) throw err('not-found', `There is no recording of ${ref.moduleAbbr}.`);
    const narrator = this.chooseNarrator(index.narrators, ref, opts.voiceId);
    if (!narrator) throw err('not-found', 'This chapter has not been recorded yet.');
    const manifest = await this.manifests.chapter(ref, narrator, signal);
    if (signal.aborted) throw err('aborted', 'Aborted');
    if (!manifest) throw err('not-found', 'This chapter has not been recorded yet.');
    return { manifest, narrator };
  }

  private chooseNarrator(narrators: AudioNarrator[], ref: ChapterRef, voiceId?: string): AudioNarrator | undefined {
    const wanted = voiceId ? narrators.find(n => n.id === voiceId) : undefined;
    if (wanted && narratorHasChapter(wanted, ref.book, ref.chapter)) return wanted;
    // The preferred narrator lacks this chapter (or none was named): first that has it.
    return narrators.find(n => narratorHasChapter(n, ref.book, ref.chapter));
  }

  /** A cached copy plays offline (as a blob); otherwise stream from the network. */
  private async resolveFileUrl(
    manifest: ChapterManifest,
    file: ManifestFile,
    signal: AbortSignal,
  ): Promise<{ url: string; release?: () => void }> {
    const url = this.locator.fileUrl(manifest, file);
    if (this.cache && await this.cache.has(url).catch(() => false)) {
      const hit = await this.cache.get(url).catch(() => undefined);
      if (hit) {
        const blob = await hit.blob();
        void this.cache.touch(url).catch(() => {});
        const objectUrl = this.createObjectURL(blob);
        return { url: objectUrl, release: () => this.revokeObjectURL(objectUrl) };
      }
    }
    // Not cached: play straight from the network (Range requests let it start
    // mid-chapter) and keep a copy for next time.
    void this.storeFile(manifest, file, signal).catch(() => {});
    return { url };
  }

  private async storeFile(manifest: ChapterManifest, file: ManifestFile, signal: AbortSignal): Promise<void> {
    if (!this.cache) return;
    const url = this.locator.fileUrl(manifest, file);
    if (await this.cache.has(url)) return;
    const res = await this.fetchFn(url, { signal });
    if (!res.ok) return;
    await this.cache.put(url, res);
    await this.trim(url);
  }

  /**
   * Evict the least recently used chapters beyond the limit. The cache given to
   * this provider holds audio files only (manifests go in their own cache), so
   * every key in it counts.
   */
  private async trim(justStored: string): Promise<void> {
    if (!this.cache) return;
    const keys = await this.cache.keys('');
    const excess = keys.length - this.cacheLimit;
    for (const key of keys.slice(0, Math.max(0, excess))) {
      if (key !== justStored) await this.cache.delete(key);
    }
  }
}

class RecordedChapterAudio implements IChapterAudio {
  readonly verses: readonly number[];
  private readonly timings: VerseTiming[];
  private urlPromise: Promise<{ url: string; release?: () => void }> | undefined;

  constructor(
    readonly ref: ChapterRef,
    private readonly manifest: ChapterManifest,
    private readonly narrator: AudioNarrator,
    private readonly file: ManifestFile,
    private readonly resolveUrl: () => Promise<{ url: string; release?: () => void }>,
    private readonly readIntro: boolean,
  ) {
    this.timings = manifestTimings(manifest);
    this.verses = this.timings.map(t => t.verse);
  }

  async segmentFor(verse: number, signal: AbortSignal): Promise<AudioSegment> {
    if (signal.aborted) throw err('aborted', 'Aborted');
    // The first verse at or after the requested one: a verse the recording
    // lacks (a translation that omits it) starts at the next one that exists.
    const target = this.timings.find(t => t.verse >= verse) ?? this.timings[this.timings.length - 1];
    const first = this.timings[0];
    const intro = this.manifest.intro;
    const offset = target === first && intro && this.readIntro ? intro[0] : target.start;
    // Resolved once per chapter: every segment of it shares one URL, and the
    // blob behind a cached copy (if any) is released by `dispose()`, not by the
    // segment, because a seek within the chapter reuses it.
    this.urlPromise ??= this.resolveUrl();
    const { url } = await this.urlPromise;
    if (signal.aborted) throw err('aborted', 'Aborted');
    return {
      id: `${this.manifest.module}:${this.manifest.book}:${this.manifest.chapter}:${this.narrator.id}:${this.manifest.rev}`,
      url,
      mime: this.file.mime,
      offset,
      duration: this.manifest.duration,
      verses: this.timings,
    };
  }

  /** One segment per chapter: nothing follows it. */
  async segmentAfter(): Promise<AudioSegment | null> {
    return null;
  }

  dispose(): void {
    const pending = this.urlPromise;
    this.urlPromise = undefined;
    void pending?.then(r => r.release?.(), () => {});
  }
}
