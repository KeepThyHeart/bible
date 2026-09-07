/**
 * Scroll-to-verse and typed passage ranges on chapter entry.
 *
 * Two separate reports land here:
 *
 *  - "when I switch chapters the selected verse should always be scrolled to,
 *    and it isn't consistent". Navigating *with* a verse set pendingScrollVerse;
 *    navigating without one (every prev/next-chapter button, the swipe, the
 *    cold start) explicitly set it to null, so the pane kept the previous
 *    chapter's scroll offset.
 *
 *  - "typing a verse range should really select that range, the same as
 *    clicking the first verse and shift-clicking the last". A range parsed out
 *    of the reference box had nowhere to go: navigateTo took a single verse and
 *    cleared selectionEndVerse unconditionally.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
import type { VerseData } from '../types';

function makeVerse(verse: number, book = 43, chapter = 3): VerseData {
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

function stubProvider(verses: VerseData[]) {
  return {
    getChapter: vi.fn(async () => ({ verses, hasInterlinearData: false, coveredBooks: undefined })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never;
}

function reset(verses: VerseData[]) {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(stubProvider(verses));
}

describe('bibleStore — scroll to the selected verse', () => {
  beforeEach(() => {
    reset([makeVerse(1), makeVerse(2), makeVerse(3), makeVerse(16), makeVerse(17), makeVerse(18)]);
  });

  it('requests a scroll to the named verse', async () => {
    await bibleStore.navigateTo(43, 3, 16);
    expect(bibleStore.getActiveTab()?.pendingScrollVerse).toBe(43003016);
  });

  it('requests a scroll to the first verse when none was named', async () => {
    // This is the case that used to leave pendingScrollVerse null, so a
    // prev/next chapter step kept the old offset.
    await bibleStore.navigateTo(43, 3);
    const tab = bibleStore.getActiveTab();
    expect(tab?.studyVerse).toBe(43003001);
    expect(tab?.pendingScrollVerse).toBe(43003001);
  });

  it('keeps the scroll target and the selected verse in step', async () => {
    await bibleStore.navigateTo(43, 3);
    const tab = bibleStore.getActiveTab();
    expect(tab?.pendingScrollVerse).toBe(tab?.studyVerse);
  });
});

describe('bibleStore — typed passage ranges', () => {
  beforeEach(() => {
    reset([makeVerse(16), makeVerse(17), makeVerse(18)]);
  });

  it('selects the whole range, as a click plus shift-click would', async () => {
    await bibleStore.navigateTo(43, 3, 16, { endVerse: 18 });

    const tab = bibleStore.getActiveTab();
    expect(tab?.studyVerse).toBe(43003016);        // anchor
    expect(tab?.selectionEndVerse).toBe(43003018); // far end
  });

  it('exposes the range through getSelectedRange', async () => {
    await bibleStore.navigateTo(43, 3, 16, { endVerse: 18 });

    expect(bibleStore.getSelectedRange()).toEqual({ start: 43003016, end: 43003018 });
  });

  it('leaves a single verse unranged', async () => {
    await bibleStore.navigateTo(43, 3, 16);

    expect(bibleStore.getActiveTab()?.selectionEndVerse).toBeNull();
  });

  it('ignores an end verse that is not after the start', async () => {
    // "John 3:18-16" is not a range worth guessing at.
    await bibleStore.navigateTo(43, 3, 18, { endVerse: 16 });

    expect(bibleStore.getActiveTab()?.selectionEndVerse).toBeNull();
  });

  it('clears a previous range when navigating somewhere new', async () => {
    await bibleStore.navigateTo(43, 3, 16, { endVerse: 18 });
    await bibleStore.navigateTo(43, 3, 17);

    expect(bibleStore.getActiveTab()?.selectionEndVerse).toBeNull();
  });
});
