/**
 * The Back button, end to end through the store.
 *
 * Back means "undo my last view change", which is a different thing from the
 * History dropdown's curated jump list. The dropdown dedupes by chapter,
 * collapses sequential paging into one entry and caps at 10; Back has to
 * record every chapter actually looked at, in the order it was looked at,
 * including chapters reached *from the dropdown itself*.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseIdHelper } from '@bible/core';

vi.mock('../../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockImplementation(async (n: number) => (n === 43 ? 'John' : `Book${n}`)),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../../useBibleStore';

const PANEL = 'test_panel_visit_stack';

const KJV = {
  abbreviation: 'KJV',
  name: 'King James Version',
  database_path: 'bible_kjv.db',
  module_id: 1,
};

const JOHN_3_16 = VerseIdHelper.calculate(43, 3, 16);

function panelState() {
  return useBibleStore.getState().getPanelState(PANEL);
}

/** Where the panel currently is, as "book:chapter". */
function where(): string {
  const ps = panelState();
  return `${ps.currentBook}:${ps.currentChapter}`;
}

/** The visit stack as "book:chapter" strings, oldest first. */
function visits(): string[] {
  return panelState().visitStack.map(v => `${v.bookNumber}:${v.chapter}`);
}

describe('Back button - the visit stack', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    useBibleStore.getState().initPanel(PANEL);
    // Opens on John 3 (the default panel passage) and seeds a one-entry stack.
    useBibleStore.getState().openBible(PANEL, KJV.abbreviation, KJV.name);
  });

  it('seeds a single visit when a passage opens, so Back starts disabled', () => {
    expect(visits()).toEqual(['43:3']);
    expect(useBibleStore.getState().canGoBackVisit(PANEL)).toBe(false);
  });

  it('records a visit for every chapter change, whatever caused it', async () => {
    const store = useBibleStore.getState();

    await store.loadChapter(PANEL, 43, 4);                          // typed reference / picker
    await store.loadChapter(PANEL, 43, 5, { replaceHistory: true }); // next chapter (paging)
    await store.navigateToVerse(PANEL, VerseIdHelper.calculate(45, 8, 28)); // search result / xref

    expect(visits()).toEqual(['43:3', '43:4', '43:5', '45:8']);
    expect(useBibleStore.getState().canGoBackVisit(PANEL)).toBe(true);
  });

  it('does not stack a consecutive duplicate, but keeps a non-adjacent repeat', async () => {
    const store = useBibleStore.getState();

    await store.loadChapter(PANEL, 43, 3); // already here
    expect(visits()).toEqual(['43:3']);

    await store.loadChapter(PANEL, 45, 8);
    await store.loadChapter(PANEL, 43, 3); // back to John 3 the long way - a real second visit

    expect(visits()).toEqual(['43:3', '45:8', '43:3']);
  });

  it('walks back one chapter at a time through a paged run', async () => {
    const store = useBibleStore.getState();
    await store.loadChapter(PANEL, 43, 4, { replaceHistory: true });
    await store.loadChapter(PANEL, 43, 5, { replaceHistory: true });
    await store.loadChapter(PANEL, 43, 6, { replaceHistory: true });

    // The dropdown collapsed all of that into one entry, which is why Back
    // cannot be built on it: it would jump straight past chapters 5 and 4.
    expect(panelState().navigationHistory).toHaveLength(1);

    await useBibleStore.getState().goBackVisit(PANEL);
    expect(where()).toBe('43:5');

    await useBibleStore.getState().goBackVisit(PANEL);
    expect(where()).toBe('43:4');

    await useBibleStore.getState().goBackVisit(PANEL);
    expect(where()).toBe('43:3');

    expect(useBibleStore.getState().canGoBackVisit(PANEL)).toBe(false);
  });

  it('is a no-op with nothing behind the current view', async () => {
    await useBibleStore.getState().goBackVisit(PANEL);
    expect(where()).toBe('43:3');
    expect(visits()).toEqual(['43:3']);
  });

  // The headline case: a dropdown pick is itself a visit, so Back afterwards
  // returns the reader to where they were - even though that is "forward" in
  // the dropdown's list.
  it('returns to where you were after a backwards jump from the history dropdown', async () => {
    const store = useBibleStore.getState();
    await store.loadChapter(PANEL, 45, 8);   // John 3 -> Romans 8
    await store.loadChapter(PANEL, 40, 5);   // -> Matthew 5
    expect(where()).toBe('40:5');

    // Pick "John 3" from the history menu (index 0).
    await useBibleStore.getState().navigateToHistoryEntry(PANEL, 0);
    expect(where()).toBe('43:3');
    expect(visits()).toEqual(['43:3', '45:8', '40:5', '43:3']);

    await useBibleStore.getState().goBackVisit(PANEL);

    expect(where()).toBe('40:5');
  });

  it('does not push the chapter it just navigated to, so Back keeps going back', async () => {
    const store = useBibleStore.getState();
    await store.loadChapter(PANEL, 45, 8);
    await store.loadChapter(PANEL, 40, 5);

    await useBibleStore.getState().goBackVisit(PANEL);
    expect(visits()).toEqual(['43:3', '45:8']);

    await useBibleStore.getState().goBackVisit(PANEL);
    expect(where()).toBe('43:3');
    expect(visits()).toEqual(['43:3']);
  });

  it('restores the verse the visit remembers', async () => {
    const store = useBibleStore.getState();
    await store.navigateToVerse(PANEL, JOHN_3_16);
    await store.loadChapter(PANEL, 45, 8);

    await useBibleStore.getState().goBackVisit(PANEL);

    expect(panelState().selectedVerseId).toBe(JOHN_3_16);
  });

  it('moves the history cursor onto the chapter Back landed on', async () => {
    const store = useBibleStore.getState();
    await store.loadChapter(PANEL, 45, 8);
    await store.loadChapter(PANEL, 40, 5);
    await useBibleStore.getState().navigateToHistoryEntry(PANEL, 0); // -> John 3

    await useBibleStore.getState().goBackVisit(PANEL); // -> Matthew 5

    const ps = panelState();
    const cursorEntry = ps.navigationHistory[ps.historyIndex];
    expect(cursorEntry).toMatchObject({ bookNumber: 40, chapter: 5 });
    // The menu itself is untouched - Back is not a history edit.
    expect(ps.navigationHistory.map(h => `${h.bookNumber}:${h.chapter}`))
      .toEqual(['43:3', '45:8', '40:5']);
  });

  it('names the chapter on screen when Back lands somewhere the menu collapsed away', async () => {
    const store = useBibleStore.getState();
    await store.loadChapter(PANEL, 43, 4, { replaceHistory: true });
    await store.loadChapter(PANEL, 43, 5, { replaceHistory: true });

    await useBibleStore.getState().goBackVisit(PANEL); // -> John 4, which the menu never recorded

    const ps = panelState();
    expect(ps.navigationHistory[ps.historyIndex]).toMatchObject({ bookNumber: 43, chapter: 4 });
    // Replaced, not appended: Back must not grow the menu by a row per press.
    expect(ps.navigationHistory).toHaveLength(1);
  });

  it('records the scroll offset on the visit being left behind', () => {
    useBibleStore.getState().saveScrollPosition(PANEL, 512);

    const stack = panelState().visitStack;
    expect(stack[stack.length - 1]?.scrollTop).toBe(512);
  });
});

describe('Back button - session persistence', () => {
  beforeEach(() => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
  });

  it('round-trips the stack through save and restore', async () => {
    useBibleStore.getState().initPanel(PANEL);
    useBibleStore.getState().openBible(PANEL, KJV.abbreviation, KJV.name);
    await useBibleStore.getState().loadChapter(PANEL, 45, 8);
    await useBibleStore.getState().loadChapter(PANEL, 40, 5);

    const saved = { ...panelState() };

    useBibleStore.setState({ panels: new Map() });
    useBibleStore.getState().initPanel(PANEL);
    await useBibleStore.getState().restoreFromSession(PANEL, {
      version: 2,
      panels: {
        [PANEL]: {
          tab: {
            ...saved.openTabs[0],
            book: saved.currentBook,
            chapter: saved.currentChapter,
            history: saved.navigationHistory,
            historyIndex: saved.historyIndex,
          },
          visitStack: saved.visitStack,
        },
      },
    });

    expect(visits()).toEqual(['43:3', '45:8', '40:5']);

    await useBibleStore.getState().goBackVisit(PANEL);
    expect(where()).toBe('45:8');
  });

  it('seeds a one-entry stack for a session saved before this feature existed', async () => {
    useBibleStore.getState().initPanel(PANEL);
    await useBibleStore.getState().restoreFromSession(PANEL, {
      version: 2,
      panels: {
        [PANEL]: {
          tab: {
            tabId: 'kjv-old', abbreviation: 'KJV', name: 'King James Version',
            displayMode: 'standard', book: 45, chapter: 8, bookName: 'Book45',
            selectedVerseId: null, history: [], historyIndex: -1,
          },
        },
      },
    });

    expect(visits()).toEqual(['45:8']);
    expect(useBibleStore.getState().canGoBackVisit(PANEL)).toBe(false);
  });

  it('degrades a corrupt stack to the seeded single entry rather than crashing', async () => {
    useBibleStore.getState().initPanel(PANEL);
    await useBibleStore.getState().restoreFromSession(PANEL, {
      version: 2,
      panels: {
        [PANEL]: {
          tab: {
            tabId: 'kjv-corrupt', abbreviation: 'KJV', name: 'King James Version',
            displayMode: 'standard', book: 45, chapter: 8, bookName: 'Book45',
            selectedVerseId: null, history: [], historyIndex: -1,
          },
          visitStack: 'not a stack',
        },
      },
    });

    expect(visits()).toEqual(['45:8']);
  });
});
