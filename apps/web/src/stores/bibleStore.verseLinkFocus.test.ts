/**
 * A verse link must bring a Bible tab to the front.
 *
 * With the Home screen showing in the left pane and Topics (or Commentary,
 * Study, Search…) on the right, clicking a verse link navigated a Bible tab
 * that nobody could see: `navigateToPreview` left `showHome` set, so the reader
 * saw nothing happen. Every right-pane verse link goes through
 * `navigateToPreview`, so the fix — and these tests — live there.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
import type { VerseData } from '../types';

function makeVerse(verse: number, book: number, chapter: number): VerseData {
  return {
    verse_id: book * 1000000 + chapter * 1000 + verse,
    book_number: book,
    chapter,
    verse,
    text: `verse ${verse}`,
    text_html: `verse ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

const provider = {
  getChapter: vi.fn(async (_m: string, book: number, chapter: number) => ({
    verses: [makeVerse(1, book, chapter), makeVerse(2, book, chapter)],
    hasInterlinearData: false,
    coveredBooks: undefined,
  })),
  getVerseOfTheDay: vi.fn(async () => null),
} as never;

function reset() {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(provider);
}

describe('bibleStore verse links focus a Bible tab', () => {
  beforeEach(async () => {
    reset();
    // Two Bible tabs; the second was used last.
    await bibleStore.navigateTo(1, 1);
    bibleStore.addTab('KJV');
    await bibleStore.navigateTo(43, 3);
  });

  it('dismisses the Home screen for a link into another chapter', async () => {
    bibleStore.setShowHome(true);
    await bibleStore.navigateToPreview(1, 3, 15);

    expect(bibleStore.showHome).toBe(false);
    expect(bibleStore.getActiveTab()?.book).toBe(1);
    expect(bibleStore.getActiveTab()?.chapter).toBe(3);
    expect(bibleStore.getActiveTab()?.previewVerse).toBe(1003015);
  });

  it('dismisses the Home screen for a link into the chapter already open', async () => {
    bibleStore.setShowHome(true);
    await bibleStore.navigateToPreview(43, 3, 2);

    expect(bibleStore.showHome).toBe(false);
    expect(bibleStore.getActiveTab()?.previewVerse).toBe(43003002);
  });

  it('targets the most recently active Bible tab, not the first or last', async () => {
    const [first, second] = bibleStore.tabs;
    bibleStore.addTab('KJV');
    const third = bibleStore.getActiveTab()!;
    await bibleStore.navigateTo(19, 23);
    // Reader goes back to the middle tab, then to Home.
    bibleStore.setActiveTab(second.id);
    bibleStore.setShowHome(true);

    await bibleStore.navigateToPreview(1, 3, 15);

    expect(bibleStore.activeTabId).toBe(second.id);
    expect(second.book).toBe(1);
    expect(first.book).toBe(1);   // untouched: still Genesis 1
    expect(first.chapter).toBe(1);
    expect(third.book).toBe(19);  // untouched
  });

  it('falls back to the right-most tab when the active id names no tab', async () => {
    bibleStore.activeTabId = 'gone';
    bibleStore.setShowHome(true);
    const last = bibleStore.tabs[bibleStore.tabs.length - 1];

    await bibleStore.navigateToPreview(1, 3, 15);

    expect(bibleStore.activeTabId).toBe(last.id);
    expect(last.book).toBe(1);
    expect(bibleStore.showHome).toBe(false);
  });

  it('opens a Bible tab when none exists', async () => {
    bibleStore.tabs = [];
    bibleStore.activeTabId = '';
    bibleStore.setShowHome(true);

    await bibleStore.navigateToPreview(1, 3, 15);

    expect(bibleStore.tabs).toHaveLength(1);
    expect(bibleStore.getActiveTab()?.book).toBe(1);
    expect(bibleStore.getActiveTab()?.previewVerse).toBe(1003015);
    expect(bibleStore.showHome).toBe(false);
  });

  it('leaves a Bible tab that is already on screen alone', async () => {
    bibleStore.setShowHome(false);
    const id = bibleStore.activeTabId;
    await bibleStore.navigateToPreview(1, 3, 15);
    expect(bibleStore.activeTabId).toBe(id);
    expect(bibleStore.tabs).toHaveLength(2);
  });
});
