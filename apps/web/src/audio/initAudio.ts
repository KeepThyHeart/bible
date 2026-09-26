/**
 * The app-side half of the audio bootstrap: connects `createAudioSystem` to the
 * real stores and data provider and hands the result to `audioStore`. Kept out of
 * `main.tsx` so that a site with the feature off never loads any of it (`main.tsx`
 * imports this dynamically), and out of `bootstrap.ts` so that file needs no
 * store to be tested.
 */

import type { AudioSiteConfig } from '@bible/core/browser';
import type { IBibleDataProvider } from '../providers/interfaces';
import { bibleStore } from '../stores/bibleStore';
import { moduleStore } from '../stores/moduleStore';
import { audioStore } from '../stores/audioStore';
import { createAudioSystem } from './bootstrap';

export function initAudio(config: AudioSiteConfig, bible: IBibleDataProvider): void {
  const languageOf = (moduleAbbr: string): string =>
    moduleStore.getBibleModules().find(m => m.abbreviation === moduleAbbr)?.language_code ?? '';

  const system = createAudioSystem(config, {
    baseUrl: import.meta.env.BASE_URL,
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
}
