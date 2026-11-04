/** B-117 / B-138: a chapter that fails to load must not keep the previous chapter's verses under its heading, and must refetch when back online. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';

const verse = (book: number, chapter: number) => ({
  verse_id: book * 1000000 + chapter * 1000 + 1, book_number: book, chapter, verse: 1,
  text: `text ${chapter}`, text_html: `text ${chapter}`, is_paragraph_start: false, words_of_christ: false,
});

describe('bibleStore — offline chapter load failure', () => {
  let offline = false;
  beforeEach(() => {
    offline = false;
    localStorage.clear();
    bibleStore.tabs = [];
    bibleStore.activeTabId = '';
    bibleStore.init({
      getChapter: vi.fn(async (_m: string, book: number, chapter: number) => {
        if (offline) throw new TypeError('Failed to fetch');
        return { verses: [verse(book, chapter)], hasInterlinearData: false, coveredBooks: undefined };
      }),
      getVerse: vi.fn(async () => null),
      getVerseOfTheDay: vi.fn(async () => null),
    } as never);
  });

  it('clears the old verses on failure and refetches on the online event', async () => {
    await bibleStore.navigateTo(43, 3);
    expect(bibleStore.getActiveTab()!.verses[0].text).toBe('text 3');
    offline = true;
    await bibleStore.navigateTo(43, 4);
    const tab = bibleStore.getActiveTab()!;
    expect(tab.chapter).toBe(4);
    expect(tab.verses).toEqual([]);
    expect(tab.loadError).toBeTruthy();
    offline = false;
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 20));
    expect(tab.loadError).toBeUndefined();
    expect(tab.verses[0].text).toBe('text 4');
  });
});
