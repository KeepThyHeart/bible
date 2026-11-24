/**
 * Assembles the audio system from the site configuration: the one place that
 * knows the concrete classes. Everything else talks to interfaces, and the UI
 * talks to `audioStore`.
 *
 * Shared by the web and desktop apps: each passes its own pieces (the engine
 * factories with their asset environment, where chapters come from, book names)
 * and only calls this when the `audio` feature is on.
 */

import type { AudioSiteConfig, ChapterRef, IAssetCache, ITtsEngine, TtsEngineFactory, VerseText } from '@bible/core/browser';
import { AudioPlayer } from './AudioPlayer';
import { AudioSourceResolver } from './AudioSourceResolver';
import { AUDIO_CACHE_NAMES, createAssetCache } from './AssetCache';
import { CdnAudioLocator } from './CdnAudioLocator';
import { layeredAssetCache } from './downloads/cacheDownloadStore';
import { HtmlAudioOutput } from './HtmlAudioOutput';
import { HttpManifestSource } from './HttpManifestSource';
import { MediaSessionBridge } from './MediaSessionBridge';
import { RecordedAudioProvider } from './RecordedAudioProvider';
import { TextPreparer } from '@bible/core/browser';
import { createEngineRegistry, createProviderRegistry } from './registries';
import { LazyTtsEngine } from './tts/LazyTtsEngine';
import { TtsAudioProvider } from './tts/TtsAudioProvider';
import { PronunciationStore } from './tts/pronunciationStore';
import type { AudioSystem } from './AudioStore';

/** What the app supplies; kept small so a test can stand in for the whole app. */
export interface AudioBootstrapDeps {
  /** The app's base path (web: `import.meta.env.BASE_URL`): a `/`-relative audio base is served under it. */
  baseUrl: string;
  /** On-device engines this app can run, with its own asset environment (e.g. `createPiperFactory(env)`). */
  engineFactories: TtsEngineFactory[];
  /** The chapter's verses as the reader would get them (offline-first). */
  getChapter(moduleAbbr: string, book: number, chapter: number): Promise<Array<{ verse: number; text: string; text_html?: string }>>;
  /** Verses the active tab already shows, so no second fetch is needed for the chapter on screen. */
  loadedVerses(ref: ChapterRef): VerseText[] | null;
  languageOf(moduleAbbr: string): string;
  bookName(book: number, language: string): string;
  /** Chapters in a book, or 0 when unknown. */
  chapterCount(book: number): number;
  /**
   * Caches, by role (default: the Cache API caches in `AUDIO_CACHE_NAMES`). `chapters: null`
   * keeps no copy of recorded chapters (the desktop serves its files itself). An app whose
   * scheme the Cache API cannot key (desktop) passes `MemoryAssetCache`s.
   */
  caches?: {
    manifests?: IAssetCache;
    chapters?: IAssetCache | null;
    pronunciation?: IAssetCache;
    /** Downloaded books (web: the pinned `audio-downloads-v1`), read before the manifests and chapters caches. */
    downloads?: IAssetCache;
  };
  /** Test seams. */
  createOutput?: () => HtmlAudioOutput;
  online?: { addEventListener(type: 'online', listener: () => void): void };
}

const LAST_BOOK = 66;

/** `/`-relative bases live under the app's own base path (a sub-path deployment); absolute URLs are left alone. */
export function resolveBase(base: string, baseUrl: string): string {
  if (!base.startsWith('/')) return base;
  const prefix = baseUrl.replace(/\/+$/, '');
  return prefix && !base.startsWith(`${prefix}/`) ? `${prefix}${base}` : base;
}

export function chapterNeighbours(chapterCount: (book: number) => number) {
  return {
    next(ref: ChapterRef): ChapterRef | null {
      const count = chapterCount(ref.book);
      if (count > 0 && ref.chapter < count) return { ...ref, chapter: ref.chapter + 1 };
      if (ref.book < LAST_BOOK) return { ...ref, book: ref.book + 1, chapter: 1 };
      return null;
    },
    prev(ref: ChapterRef): ChapterRef | null {
      if (ref.chapter > 1) return { ...ref, chapter: ref.chapter - 1 };
      if (ref.book > 1) {
        const count = chapterCount(ref.book - 1);
        return count > 0 ? { ...ref, book: ref.book - 1, chapter: count } : null;
      }
      return null;
    },
  };
}

export function createAudioSystem(config: AudioSiteConfig, deps: AudioBootstrapDeps): AudioSystem {
  const providers = createProviderRegistry();
  const engineFactories = createEngineRegistry();
  for (const f of deps.engineFactories) engineFactories.register(f);

  const base = resolveBase(config.base, deps.baseUrl);
  const engines = new Map<string, ITtsEngine>();
  const engineOrder: string[] = [];
  const text = new TextPreparer();
  let recordings: AudioSystem['recordings'];

  if (config.recorded) {
    const locator = new CdnAudioLocator(base);
    const pinned = deps.caches?.downloads;
    const layer = (c: IAssetCache): IAssetCache => (pinned ? layeredAssetCache(pinned, c) : c);
    const manifests = new HttpManifestSource(locator, layer(deps.caches?.manifests ?? createAssetCache(AUDIO_CACHE_NAMES.manifests)));
    const chaptersCache = deps.caches?.chapters === null ? undefined : (deps.caches?.chapters ?? createAssetCache(AUDIO_CACHE_NAMES.chapters));
    const chapters = chaptersCache ? layer(chaptersCache) : pinned;
    providers.register(new RecordedAudioProvider(manifests, locator, { cache: chapters }));
    recordings = { manifests, locator };
  }

  // One store for every engine: the files are per accent and module, not per engine.
  const pronunciation = new PronunciationStore({ base: `${base.replace(/\/+$/, '')}/pronunciation`, cache: deps.caches?.pronunciation ?? createAssetCache(AUDIO_CACHE_NAMES.models) });

  const source = async (ref: ChapterRef): Promise<VerseText[]> => {
    const loaded = deps.loadedVerses(ref);
    if (loaded) return loaded;
    const data = await deps.getChapter(ref.moduleAbbr, ref.book, ref.chapter);
    return data.map(v => ({ verse: v.verse, text: v.text, html: v.text_html }));
  };

  for (const cfg of config.engines) {
    const factory = engineFactories.get(cfg.id);
    if (!factory) continue; // named in the site config, unknown to this build: skipped, not fatal
    const resolved = { ...cfg, assetBase: resolveBase(cfg.assetBase, deps.baseUrl) };
    const engine = new LazyTtsEngine(factory, resolved);
    engines.set(cfg.id, engine);
    engineOrder.push(cfg.id);
    providers.register(new TtsAudioProvider(engine, text, source, {
      languageOf: deps.languageOf,
      bookName: (ref, language) => deps.bookName(ref.book, language),
      config: resolved,
      pronunciation: (moduleAbbr, accent) => pronunciation.overlay(moduleAbbr, accent),
    }));
  }

  const resolver = new AudioSourceResolver({
    providers,
    engineOrder,
    engineSupported: async id => (await engines.get(id)?.isSupported()) ?? false,
    defaultVoice: (id, language) => config.engines.find(e => e.id === id)?.defaultVoices?.[language],
  });
  // A "no" may have been about being offline.
  (deps.online ?? window).addEventListener('online', () => resolver.invalidateNegatives());

  const { next, prev } = chapterNeighbours(deps.chapterCount);
  const player = new AudioPlayer((deps.createOutput ?? (() => new HtmlAudioOutput()))(), { nextChapter: next, prevChapter: prev });
  new MediaSessionBridge().attach(player, v => {
    const language = deps.languageOf(v.moduleAbbr);
    return {
      title: `${deps.bookName(v.book, language)} ${v.chapter}`,
      artist: `${v.moduleAbbr}${player.state.voiceId ? ` · ${player.state.voiceId}` : ''}`,
      album: (typeof document !== 'undefined' && document.title) || 'Bible',
    };
  });

  return { player, resolver, config, engines, languageOf: deps.languageOf, recordings };
}
