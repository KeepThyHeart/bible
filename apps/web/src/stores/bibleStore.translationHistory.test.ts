/** 0209 W6: switching a tab's translation updates the current Recent-passages entry. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';

const provider = {
  getChapter: vi.fn(async (module: string, book: number, chapter: number) => ({
    verses: [{ verse_id: book * 1000000 + chapter * 1000 + 1, book_number: book, chapter, verse: 1, text: module, text_html: module, is_paragraph_start: false, words_of_christ: false }],
    hasInterlinearData: false,
    coveredBooks: undefined,
  })),
  getVerseOfTheDay: vi.fn(async () => null),
};

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(provider as never);
});

describe('translation switch and history', () => {
  it('names the new translation on the current entry', async () => {
    await bibleStore.navigateTo(45, 1);
    const tab = bibleStore.getActiveTab()!;
    const before = tab.moduleAbbr;
    const next = before === 'ASV' ? 'KJV' : 'ASV';
    await bibleStore.setTabTranslation(tab.id, next);
    expect(bibleStore.getHistory()[bibleStore.getHistoryIndex()].moduleAbbr).toBe(next);
  });

  it('leaves other passages as they were read and drops a duplicate of the same passage', async () => {
    await bibleStore.navigateTo(45, 1);
    const tab = bibleStore.getActiveTab()!;
    const original = tab.moduleAbbr;
    const other = original === 'ASV' ? 'KJV' : 'ASV';
    await bibleStore.navigateTo(43, 3);
    await bibleStore.setTabTranslation(tab.id, other);
    const hist = bibleStore.getHistory();
    expect(hist.find(h => h.book === 45)!.moduleAbbr).toBe(original);
    expect(hist[bibleStore.getHistoryIndex()]).toMatchObject({ book: 43, moduleAbbr: other });
    // Going back to Romans in the new translation, then switching Romans: no duplicate rows.
    await bibleStore.navigateTo(45, 1);
    await bibleStore.setTabTranslation(tab.id, original);
    const rows = bibleStore.getHistory().filter(h => h.book === 45 && h.chapter === 1 && h.moduleAbbr === original);
    expect(rows).toHaveLength(1);
    expect(bibleStore.getHistory()[bibleStore.getHistoryIndex()]).toMatchObject({ book: 45, moduleAbbr: original });
  });
});
