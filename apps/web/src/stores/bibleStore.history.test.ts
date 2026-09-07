/**
 * Navigation history: what "Recent Passages" is allowed to contain.
 *
 * The menu is a list of *passages*, not of clicks. Two rules make it one:
 *  - re-visiting a chapter moves its existing entry to the end rather than
 *    adding a second row (John 7 → John 3 → John 7 listed "John 7" twice), and
 *  - a sequential step — next/previous chapter, a swipe — modifies the entry
 *    the reader is standing on instead of appending one per chapter paged
 *    through.
 *
 * The reducer is tested as a pure function so these invariants are pinned
 * independently of the store's async loading, and then once through the store
 * to prove the flag actually reaches it from `navigateTo`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addHistoryEntry, bibleStore, MAX_HISTORY_ENTRIES } from './bibleStore';
import type { HistoryEntry, HistorySlot } from './bibleStore';
import type { VerseData } from '../types';

function entry(book: number, chapter: number, verse?: number, moduleAbbr = 'KJV'): HistoryEntry {
  return { moduleAbbr, book, chapter, verse };
}

/** Fold a list of visits through the reducer, starting from an empty history. */
function visitAll(entries: HistoryEntry[], options?: { replace?: boolean }): HistorySlot {
  return entries.reduce<HistorySlot>(
    (slot, e) => addHistoryEntry(slot, e, options),
    { history: [], historyIndex: -1 },
  );
}

function labels(slot: HistorySlot): string[] {
  return slot.history.map(h => `${h.book}:${h.chapter}${h.verse ? `.${h.verse}` : ''}`);
}

describe('addHistoryEntry', () => {
  it('appends a jump to a new passage', () => {
    const slot = visitAll([entry(43, 7), entry(43, 3)]);
    expect(labels(slot)).toEqual(['43:7', '43:3']);
    expect(slot.historyIndex).toBe(1);
  });

  it('does not duplicate a chapter that was visited before', () => {
    const slot = visitAll([entry(43, 7), entry(43, 3), entry(43, 7)]);
    expect(labels(slot)).toEqual(['43:3', '43:7']);
  });

  it('moves the re-visited chapter to the end (most recent last)', () => {
    const slot = visitAll([entry(43, 7), entry(43, 3), entry(45, 8), entry(43, 3)]);
    expect(labels(slot)).toEqual(['43:7', '45:8', '43:3']);
    expect(slot.historyIndex).toBe(slot.history.length - 1);
  });

  it('carries the newest verse onto the surviving entry', () => {
    const slot = visitAll([entry(43, 3, 16), entry(43, 7), entry(43, 3, 5)]);
    expect(labels(slot)).toEqual(['43:7', '43:3.5']);
  });

  it('treats the same chapter in a different translation as a different passage', () => {
    const slot = visitAll([entry(43, 3, 16, 'KJV'), entry(43, 3, 16, 'ASV')]);
    expect(slot.history).toHaveLength(2);
  });

  it('caps the list, dropping the oldest entries', () => {
    // One more than the cap, all distinct chapters.
    const visits = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, i) => entry(43, i + 1));
    const slot = visitAll(visits);

    expect(slot.history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(slot.history[0].chapter).toBe(6); // chapters 1-5 fell off the front
    expect(slot.history[slot.history.length - 1].chapter).toBe(MAX_HISTORY_ENTRIES + 5);
    expect(slot.historyIndex).toBe(MAX_HISTORY_ENTRIES - 1);
  });

  it('drops entries ahead of the cursor when a new visit branches off', () => {
    const slot = visitAll([entry(43, 3), entry(43, 7), entry(45, 8)]);
    const afterBack: HistorySlot = { history: slot.history, historyIndex: 0 };

    const branched = addHistoryEntry(afterBack, entry(40, 5));
    expect(labels(branched)).toEqual(['43:3', '40:5']);
  });

  describe('replace (a sequential step)', () => {
    it('leaves the history length unchanged', () => {
      const before = visitAll([entry(43, 3), entry(43, 7)]);
      const after = addHistoryEntry(before, entry(43, 8), { replace: true });

      expect(after.history).toHaveLength(before.history.length);
      expect(labels(after)).toEqual(['43:3', '43:8']);
    });

    it('still cannot produce a duplicate when paging onto a remembered chapter', () => {
      // Standing on John 2 with John 3 already in the list: paging forward must
      // move the existing John 3 rather than add a second one.
      const before = visitAll([entry(43, 3, 16), entry(43, 2)]);
      const after = addHistoryEntry(before, entry(43, 3), { replace: true });

      expect(labels(after)).toEqual(['43:3']);
    });

    it('leaves a different chapter\'s remembered verse alone', () => {
      const before = visitAll([entry(43, 3, 16), entry(45, 8, 28)]);
      const after = addHistoryEntry(before, entry(45, 9), { replace: true });

      expect(after.history[0]).toMatchObject({ book: 43, chapter: 3, verse: 16 });
    });

    it('records normally when there is nothing to replace', () => {
      const after = addHistoryEntry({ history: [], historyIndex: -1 }, entry(43, 3), { replace: true });
      expect(after.history).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Through the store — the flag has to survive the trip from the call site.
// ---------------------------------------------------------------------------

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

/** Minimal provider: serves whatever chapter is asked for. */
function stubProvider() {
  return {
    getChapter: vi.fn(async (_module: string, book: number, chapter: number) => ({
      verses: [1, 2, 3].map(v => makeVerse(v, book, chapter)),
      hasInterlinearData: false,
      coveredBooks: undefined,
    })),
    getVerseOfTheDay: vi.fn(async () => null),
  } as never;
}

function reset() {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  bibleStore.init(stubProvider());
}

describe('bibleStore — history through navigateTo', () => {
  beforeEach(reset);

  it('a jump adds an entry; a sequential step does not', async () => {
    await bibleStore.navigateTo(43, 3);
    expect(bibleStore.getHistory()).toHaveLength(1);

    // Jump (typed reference, search result, cross-reference...)
    await bibleStore.navigateTo(45, 8);
    expect(bibleStore.getHistory()).toHaveLength(2);

    // Sequential step (next-chapter button / swipe)
    await bibleStore.navigateTo(45, 9, undefined, { replace: true });
    expect(bibleStore.getHistory()).toHaveLength(2);
    expect(bibleStore.getHistory()[1]).toMatchObject({ book: 45, chapter: 9 });
  });

  it('paging through a whole book leaves one entry, not one per chapter', async () => {
    await bibleStore.navigateTo(43, 1);
    for (let chapter = 2; chapter <= 10; chapter++) {
      await bibleStore.navigateTo(43, chapter, undefined, { replace: true });
    }

    expect(bibleStore.getHistory()).toHaveLength(1);
    expect(bibleStore.getHistory()[0]).toMatchObject({ book: 43, chapter: 10 });
  });

  it('revisiting a chapter does not list it twice', async () => {
    await bibleStore.navigateTo(43, 7);
    await bibleStore.navigateTo(43, 3);
    await bibleStore.navigateTo(43, 7);

    const history = bibleStore.getHistory();
    expect(history).toHaveLength(2);
    expect(history.map(h => h.chapter)).toEqual([3, 7]);
  });

  it('remembers the last verse clicked in a chapter without adding an entry', async () => {
    await bibleStore.navigateTo(43, 3);
    const before = bibleStore.getHistory().length;

    bibleStore.setStudyVerse(43003002);

    expect(bibleStore.getHistory()).toHaveLength(before);
    expect(bibleStore.getHistory()[0].verse).toBe(2);
  });

  it('carries that verse when the chapter is revisited later', async () => {
    await bibleStore.navigateTo(43, 3);
    bibleStore.setStudyVerse(43003002);
    await bibleStore.navigateTo(45, 8);
    await bibleStore.navigateTo(43, 3, 3);

    const history = bibleStore.getHistory();
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ book: 43, chapter: 3, verse: 3 });
  });
});
