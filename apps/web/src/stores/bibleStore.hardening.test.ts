/** W-020 / W-025 / W-033: translation hash, bad hashes, bad references. */
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
  provider.getChapter.mockClear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(provider as never);
});

describe('W-020 translation switch updates the URL hash', () => {
  it('rewrites the module in the hash without adding a history entry', async () => {
    await bibleStore.navigateTo(43, 3);
    const tab = bibleStore.getActiveTab()!;
    tab.moduleAbbr = 'KJV';
    bibleStore.updateHash();
    expect(window.location.hash).toBe('#/KJV/43/3');
    const len = history.length;
    await bibleStore.setTabTranslation(tab.id, 'ASV');
    expect(window.location.hash).toBe('#/ASV/43/3');
    expect(history.length).toBe(len);
  });

  it('also does so when the new translation fails to load', async () => {
    await bibleStore.navigateTo(43, 3);
    const tab = bibleStore.getActiveTab()!;
    provider.getChapter.mockRejectedValueOnce(new Error('404'));
    await bibleStore.setTabTranslation(tab.id, 'GONE');
    expect(window.location.hash).toBe('#/GONE/43/3');
  });
});

describe('W-033 out-of-range references', () => {
  it.each([[40, 0], [43, 99], [99, 1], [0, 1]])('navigateTo(%i, %i) makes no request and leaves the tab alone', async (book, chapter) => {
    await bibleStore.navigateTo(43, 3);
    provider.getChapter.mockClear();
    const tab = bibleStore.getActiveTab()!;
    const hist = tab.history.length;
    await bibleStore.navigateTo(book, chapter);
    expect(provider.getChapter).not.toHaveBeenCalled();
    expect(tab.book).toBe(43);
    expect(tab.chapter).toBe(3);
    expect(tab.history.length).toBe(hist);
  });
});

describe('W-025 navigateFromHash', () => {
  it('accepts a trailing slash', async () => {
    expect(await bibleStore.navigateFromHash('#/KJV/43/3/')).toBe(true);
    expect(bibleStore.getActiveTab()?.chapter).toBe(3);
  });

  it('returns false for a bad or unrelated hash so boot can restore the session', async () => {
    expect(await bibleStore.navigateFromHash('#top')).toBe(false);
    expect(await bibleStore.navigateFromHash('#/KJV/99/1')).toBe(false);
    expect(await bibleStore.navigateFromHash('#/KJV/43/0')).toBe(false);
    expect(provider.getChapter).not.toHaveBeenCalled();
  });
});
