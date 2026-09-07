/**
 * Study-verse selection on chapter entry.
 *
 * Regression coverage for the panes opening on "select a verse" after a chapter
 * change or a cold start. The verse used to be left null here and back-filled
 * by an effect in CommentaryContent that measures the DOM for the first visible
 * verse; that effect runs before the Bible pane has mounted its verses, found
 * nothing, and never re-ran — so the commentary and study panes stayed empty
 * until the user clicked a verse by hand.
 *
 * These assert the verse is established by the store, at load time, from data
 * it already holds.
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

/** Minimal provider: only the calls navigateTo makes. */
function stubProvider(verses: VerseData[]) {
  return {
    getChapter: vi.fn(async () => ({ verses, hasInterlinearData: false, coveredBooks: undefined })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never;
}

/** Reset the singleton to a single clean tab. */
function reset(verses: VerseData[]) {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(stubProvider(verses));
}

describe('bibleStore — study verse on chapter entry', () => {
  beforeEach(() => {
    reset([makeVerse(1), makeVerse(2), makeVerse(3)]);
  });

  describe('navigateTo', () => {
    it('selects the chapter first verse when no verse was asked for', async () => {
      await bibleStore.navigateTo(43, 3);
      expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003001);
    });

    it('selects the requested verse when one was asked for', async () => {
      await bibleStore.navigateTo(43, 3, 2);
      expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003002);
    });

    it('leaves no verse selected when the chapter came back empty', async () => {
      reset([]);
      await bibleStore.navigateTo(43, 3);
      // Nothing to select — must not invent a verse id that has no content.
      expect(bibleStore.getActiveTab()?.studyVerse).toBeNull();
    });

    it('re-establishes a verse on every chapter change, not just the first', async () => {
      await bibleStore.navigateTo(43, 3);
      expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003001);

      // Moving on without naming a verse — the case that left the pane empty.
      reset([makeVerse(1, 43, 4), makeVerse(2, 43, 4)]);
      await bibleStore.navigateTo(43, 4);
      expect(bibleStore.getActiveTab()?.studyVerse).toBe(43004001);
    });

    it('clears a shift-click passage selection carried from the previous chapter', async () => {
      await bibleStore.navigateTo(43, 3);
      const tab = bibleStore.getActiveTab()!;
      tab.selectionEndVerse = 43003003;

      reset([makeVerse(1, 43, 4)]);
      await bibleStore.navigateTo(43, 4);
      expect(bibleStore.getActiveTab()?.selectionEndVerse).toBeNull();
    });
  });

  describe('ensureStudyVerse', () => {
    // The cold-start path: a session-restored tab renders its cached verses
    // without going through navigateTo, and carries studyVerse: null.
    it('selects the first verse when the tab has none', async () => {
      await bibleStore.navigateTo(43, 3);
      const tab = bibleStore.getActiveTab()!;
      tab.studyVerse = null;

      bibleStore.ensureStudyVerse();
      expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003001);
    });

    it('leaves an existing selection alone', async () => {
      await bibleStore.navigateTo(43, 3, 2);
      bibleStore.ensureStudyVerse();
      expect(bibleStore.getActiveTab()?.studyVerse).toBe(43003002);
    });

    it('does nothing when the tab has no verses loaded', () => {
      reset([]);
      bibleStore.ensureStudyVerse();
      expect(bibleStore.getActiveTab()?.studyVerse).toBeNull();
    });

    it('notifies subscribers so the panes re-render', async () => {
      await bibleStore.navigateTo(43, 3);
      bibleStore.getActiveTab()!.studyVerse = null;

      const seen = vi.fn();
      const unsubscribe = bibleStore.subscribe(seen);
      bibleStore.ensureStudyVerse();
      unsubscribe();

      expect(seen).toHaveBeenCalled();
    });

    it('does not notify when there is nothing to change', async () => {
      await bibleStore.navigateTo(43, 3, 2);

      const seen = vi.fn();
      const unsubscribe = bibleStore.subscribe(seen);
      bibleStore.ensureStudyVerse();
      unsubscribe();

      expect(seen).not.toHaveBeenCalled();
    });
  });
});
