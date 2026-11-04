/**
 * Commentary follows the selected verse of whichever Bible tab is active.
 *
 * Bug: the commentary was only told about a chapter by a verse click or a
 * navigation. Switching to a Bible tab that already had a verse selected (or
 * opening the Commentary pane afterwards) left it synced to the previous tab's
 * chapter, so it rejected the selection and showed "Select a verse in the
 * Bible pane to see its commentary".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
import { eventBus } from '../events/eventBus';
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

function chapterOf(book: number, chapter: number, count: number): VerseData[] {
  return Array.from({ length: count }, (_, i) => makeVerse(i + 1, book, chapter));
}

function stubProvider() {
  return {
    getChapter: vi.fn(async (_m: string, book: number, chapter: number) => ({
      verses: book === 43 && chapter === 3 ? chapterOf(43, 3, 36) : chapterOf(book, chapter, 10),
      hasInterlinearData: false,
      coveredBooks: undefined,
    })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never;
}

let loads: { book: number; chapter: number }[] = [];
let off: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(stubProvider());
  loads = [];
  off = eventBus.on('commentary:load-chapter', (e) => { loads.push(e); });
});

afterEach(() => off());

/** Two tabs: the first on John 3:16, the second (active) on Genesis 1:5. */
async function twoTabs() {
  await bibleStore.navigateTo(43, 3, 16);
  const john = bibleStore.activeTabId;
  bibleStore.addTab();
  await bibleStore.navigateTo(1, 1, 5);
  const gen = bibleStore.activeTabId;
  loads = [];
  return { john, gen };
}

describe('bibleStore — commentary follows the active tab selection', () => {
  it('switching tabs syncs the commentary to that tab\'s selected verse', async () => {
    const { john } = await twoTabs();
    bibleStore.setActiveTab(john);
    expect(loads).toEqual([{ book: 43, chapter: 3 }]);
    expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003016);
  });

  it('closing the active tab syncs to the tab that takes its place', async () => {
    const { gen } = await twoTabs();
    bibleStore.removeTab(gen);
    expect(loads).toEqual([{ book: 43, chapter: 3 }]);
  });

  it('selects a verse on a tab that has none, and syncs to it', async () => {
    const { john } = await twoTabs();
    bibleStore.tabs.find(t => t.id === john)!.studyVerse = null;
    bibleStore.setActiveTab(john);
    expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003001);
    expect(loads).toEqual([{ book: 43, chapter: 3 }]);
  });

  it('follows the selected verse, not the chapter on screen, after a preview', async () => {
    await bibleStore.navigateTo(43, 3, 16);
    await bibleStore.navigateToPreview(43, 4, 2);
    loads = [];
    bibleStore.syncCommentaryToSelection();
    expect(loads).toEqual([{ book: 43, chapter: 3 }]);
  });

  it('does nothing without a passage', () => {
    bibleStore.syncCommentaryToSelection();
    expect(loads).toEqual([]);
  });
});

describe('bibleStore — verse past the end of the chapter', () => {
  it('lands on the last verse instead of a verse that does not exist', async () => {
    await bibleStore.navigateTo(43, 3, 45);
    expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003036);
  });

  it('keeps an in-range verse as asked', async () => {
    await bibleStore.navigateTo(43, 3, 36);
    expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003036);
  });
});

describe('bibleStore — commentary follows a chapter whose text failed to load (W-069)', () => {
  it('emits commentary:load-chapter even when getChapter rejects', async () => {
    await bibleStore.navigateTo(43, 3, 16);
    const provider = {
      getChapter: vi.fn(async () => { throw new Error('Network error'); }),
      getVerseOfTheDay: vi.fn(async () => null),
    } as never;
    bibleStore.init(provider);
    loads = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await bibleStore.navigateTo(1, 1);
    expect(loads).toEqual([{ book: 1, chapter: 1 }]);
  });
});
