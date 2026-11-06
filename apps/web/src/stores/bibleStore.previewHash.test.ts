/** 0209 W9: a preview link (Word study occurrence, search result) names its verse in the URL. */
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

describe('navigateToPreview and the URL', () => {
  it('writes the verse into the hash for a different chapter', async () => {
    await bibleStore.navigateTo(43, 1);
    const abbr = bibleStore.getActiveTab()!.moduleAbbr;
    await bibleStore.navigateToPreview(1, 22, 5);
    expect(window.location.hash).toBe(`#/${abbr}/1/22/5`);
  });

  it('writes a chapter-only hash when the link names no verse', async () => {
    await bibleStore.navigateTo(43, 1);
    const abbr = bibleStore.getActiveTab()!.moduleAbbr;
    await bibleStore.navigateToPreview(1, 22);
    expect(window.location.hash).toBe(`#/${abbr}/1/22`);
  });
});
