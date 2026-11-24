/** Builds the desktop audio system: the shared engine wired to the Bible panes, the asset IPC and the `kth-audio` scheme. */
import { MemoryAssetCache, createAudioSystem, createPiperFactory } from '@bible/audio';
import type { AudioSystem } from '@bible/audio';
import { MAX_CHAPTERS, getBookName, type AudioSiteConfig } from '@bible/core/browser';
import { bibleAPI } from '../../services/electronAPI';
import { useBibleStore } from '../../stores/useBibleStore';
import { desktopLanguageOf } from './desktopPorts';
import { desktopPiperAssets } from './desktopPiper';
import { getDesktopRuntimeBytes } from './desktopAudioConfig';

export function createDesktopAudioSystem(config: AudioSiteConfig): AudioSystem {
  return createAudioSystem(config, {
    // The base is a full `kth-audio://` URL, so no path prefix applies.
    baseUrl: '/',
    engineFactories: [createPiperFactory({
      assets: desktopPiperAssets,
      // The main process serves the installed files; no index.json to read.
      loadManifests: async () => [],
      storage: 'direct',
      // Runtime plus the pronunciation overlay installed with it (from main), for the download gate.
      runtimeBytes: getDesktopRuntimeBytes,
      // The Cache API cannot key a custom scheme.
      cache: new MemoryAssetCache(),
    })],
    // The Cache API cannot key `kth-audio://`; the main process serves recordings from disk itself.
    caches: { manifests: new MemoryAssetCache(), chapters: null, pronunciation: new MemoryAssetCache() },
    getChapter: async (moduleAbbr, book, chapter) => {
      const r = await bibleAPI.getChapter(moduleAbbr, book, chapter);
      return Array.isArray(r) ? r : r.verses;
    },
    loadedVerses: ref => {
      // The chapter a pane already shows is in memory; reading it again would fetch it twice.
      for (const panel of useBibleStore.getState().panels.values()) { // allow-getstate: not render
        const tab = panel.openTabs[panel.activeTabIndex];
        if (!tab || tab.abbreviation !== ref.moduleAbbr || panel.currentBook !== ref.book || panel.currentChapter !== ref.chapter) continue;
        if (panel.loadingByTab.get(tab.tabId)) continue;
        const verses = panel.versesByTab.get(tab.tabId);
        if (verses && verses.length > 0) return verses.map(v => ({ verse: v.verse, text: v.text, html: v.text_html }));
      }
      return null;
    },
    languageOf: desktopLanguageOf,
    // English names: the app has no per-language book names available without a hook.
    bookName: book => getBookName(book),
    chapterCount: book => MAX_CHAPTERS[book] ?? 0,
  });
}
