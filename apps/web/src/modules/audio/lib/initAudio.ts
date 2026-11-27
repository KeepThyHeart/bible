/**
 * The app-side half of the audio bootstrap: connects `createAudioSystem` to the
 * real stores and data provider and hands the result to `audioStore`. Kept out of
 * the entry chunk so that a site with the feature off never loads any of it (`module.ts`
 * imports this on activation), and out of `bootstrap.ts` so that file needs no
 * store to be tested.
 */

import type { AudioSiteConfig } from '@bible/core/browser';
import type { IBibleDataProvider } from '../../../providers/interfaces';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';
import { audioStore } from '../audioStore';
import { appRegistry } from '../../../host/appHost';
import { AUDIO_DOWNLOADS_CACHE } from '@bible/audio/cacheNames';
import { createAssetCache, createAudioSystem, createKeybindingRegistry, createPiperFactory, registerAudioShortcuts } from '@bible/audio';
import { setAudioDownloadsHandle } from './downloads';
import { FetchTransport } from '../../../assets/FetchTransport';
import { getReadyAssetManager } from '../../../assets/webAssets';

/** Build the audio system and hand it to `audioStore`. Returns the undo: shortcuts off, store disposed. */
export function initAudio(config: AudioSiteConfig, bible: IBibleDataProvider): () => void {
  const languageOf = (moduleAbbr: string): string =>
    moduleStore.getBibleModules().find(m => m.abbreviation === moduleAbbr)?.language_code ?? '';

  // Books the reader downloaded for offline listening: a pinned cache the player reads first.
  const downloads = createAssetCache(AUDIO_DOWNLOADS_CACHE);
  const system = createAudioSystem(config, {
    baseUrl: import.meta.env.BASE_URL,
    caches: { downloads },
    // Piper's runtime and voices go through the shared web asset manager into the Cache API,
    // where the worker reads them by URL.
    engineFactories: [createPiperFactory({
      assets: getReadyAssetManager,
      fetchText: (url, signal) => new FetchTransport().getText(url, signal),
      storage: 'cache',
    })],
    getChapter: async (moduleAbbr, book, chapter) => (await bible.getChapter(moduleAbbr, book, chapter)).verses,
    loadedVerses: ref => {
      // The chapter on screen is already in memory; reading it again would fetch it twice.
      const tab = bibleStore.tabs.find(t => t.moduleAbbr === ref.moduleAbbr && t.book === ref.book && t.chapter === ref.chapter && !t.loading);
      return tab && tab.verses.length > 0 ? tab.verses.map(v => ({ verse: v.verse, text: v.text, html: v.text_html })) : null;
    },
    languageOf,
    bookName: book => moduleStore.getBookName(book),
    chapterCount: book => moduleStore.getBookByNumber(book)?.chapter_count ?? 0,
  });
  audioStore.init(system);
  if (system.recordings) setAudioDownloadsHandle({ recordings: system.recordings, cache: downloads });
  // Alt+arrows stand down while an app with a live session (the Presenter) is busy.
  const keys = createKeybindingRegistry();
  const offShortcuts = registerAudioShortcuts(keys, audioStore, () => appRegistry.state.getSnapshot().apps.some((a) => a.busy));
  return () => {
    offShortcuts();
    setAudioDownloadsHandle(null);
    keys.dispose();
    audioStore.dispose();
  };
}
