/**
 * Assembles the audio system from the site configuration: the one place that
 * knows the concrete classes. Everything else talks to interfaces, and the UI
 * talks to `audioStore`.
 *
 * Called from `main.tsx` after the Bible store is up, and only when the site
 * turned the feature on (`getAudioConfig()` is null otherwise, and this file's
 * imports are then never executed beyond their module scope).
 */

import type { AudioSiteConfig, ChapterRef, ITtsEngine, VerseText } from '@bible/core/browser';
import { AudioPlayer } from './AudioPlayer';
import { AudioSourceResolver } from './AudioSourceResolver';
import { AUDIO_CACHE_NAMES, createAssetCache } from './AssetCache';
import { CdnAudioLocator } from './CdnAudioLocator';
import { HtmlAudioOutput } from './HtmlAudioOutput';
import { HttpManifestSource } from './HttpManifestSource';
import { MediaSessionBridge } from './MediaSessionBridge';
import { RecordedAudioProvider } from './RecordedAudioProvider';
import { TextPreparer } from './TextPreparer';
import { createEngineRegistry, createProviderRegistry } from './registries';
import { LazyTtsEngine } from './tts/LazyTtsEngine';
import { TtsAudioProvider } from './tts/TtsAudioProvider';
import { piperFactory } from './tts/piper/piperFactory';
import type { AudioSystem } from '../stores/audioStore';

/** What the app supplies; kept small so a test can stand in for the whole app. */
export interface AudioBootstrapDeps {
  /** `import.meta.env.BASE_URL`: a `/`-relative audio base is served under it. */
  baseUrl: string;
  /** The chapter's verses as the reader would get them (offline-first). */
  getChapter(moduleAbbr: string, book: number, chapter: number): Promise<Array<{ verse: number; text: string; text_html?: string }>>;
  /** Verses the active tab already shows, so no second fetch is needed for the chapter on screen. */
  loadedVerses(ref: ChapterRef): VerseText[] | null;
  languageOf(moduleAbbr: string): string;
  bookName(book: number, language: string): string;
  /** Chapters in a book, or 0 when unknown. */
  chapterCount(book: number): number;
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
  engineFactories.register(piperFactory);

  const base = resolveBase(config.base, deps.baseUrl);
  const engines = new Map<string, ITtsEngine>();
  const engineOrder: string[] = [];
  const text = new TextPreparer();

  if (config.recorded) {
    const locator = new CdnAudioLocator(base);
    const manifests = new HttpManifestSource(locator, createAssetCache(AUDIO_CACHE_NAMES.manifests));
    providers.register(new RecordedAudioProvider(manifests, locator, { cache: createAssetCache(AUDIO_CACHE_NAMES.chapters) }));
  }

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

  return { player, resolver, config, engines, languageOf: deps.languageOf };
}
