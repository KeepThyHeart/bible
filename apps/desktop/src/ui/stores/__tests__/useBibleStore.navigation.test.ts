/**
 * Unit tests for the Bible store's navigation slice (history back/forward,
 * history index, saveScrollPosition). Exercises the composed store through
 * its public actions.
 *
 * The behavior under test is implemented by the pure helpers in
 * `internals/navigationHistory.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue({ verses: [], currentBook: 43, currentChapter: 3 }),
    getBookName: vi.fn().mockImplementation(async (n: number) => `Book${n}`),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../useBibleStore';

const PANEL = 'test_panel_nav';

function entry(verseId: number, book: number, chapter: number, bookName = 'John') {
  return { verseId, bookNumber: book, chapter, bookName };
}

describe('useBibleStore - navigation slice', () => {
  beforeEach(() => {
    // Clean slate: reset panels. Navigation history is owned by panel state
    // now, so clearing the panel map is all that's needed.
    useBibleStore.setState({ panels: new Map() });
    useBibleStore.getState().initPanel(PANEL);

    // Seed a tab so _navigateWithoutHistory has something to update.
    const s = useBibleStore.getState();
    const ps = s.getPanelState(PANEL);
    const newPanels = new Map(s.panels);
    newPanels.set(PANEL, {
      ...ps,
      openTabs: [{
        tabId: 'tab-1',
        abbreviation: 'KJV',
        name: 'King James',
        displayMode: 'reading',
        book: 43,
        chapter: 3,
        bookName: 'John',
        selectedVerseId: null,
        history: [],
        historyIndex: -1,
      }],
      activeTabIndex: 0,
    });
    useBibleStore.setState({ panels: newPanels });
  });

  describe('canGoBack / canGoForward', () => {
    it('starts with no back or forward available', () => {
      const s = useBibleStore.getState();
      expect(s.canGoBack(PANEL)).toBe(false);
      expect(s.canGoForward(PANEL)).toBe(false);
    });

    it('enables canGoBack after two history entries', () => {
      const s = useBibleStore.getState();
      // Distinct book+chapter pairs - addHistoryEntry dedupes within-chapter.
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(43004001, 43, 4));
      // After two pushes, cursor is at the second; going back is possible.
      expect(useBibleStore.getState().canGoBack(PANEL)).toBe(true);
      expect(useBibleStore.getState().canGoForward(PANEL)).toBe(false);
    });

    it('enables canGoForward after going back', async () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(43004001, 43, 4));
      await useBibleStore.getState().goBack(PANEL);
      expect(useBibleStore.getState().canGoForward(PANEL)).toBe(true);
    });
  });

  describe('_addToHistory + getHistory', () => {
    it('appends entries to the panel navigation history', () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(43004001, 43, 4));
      const history = useBibleStore.getState().getHistory(PANEL);
      expect(history).toHaveLength(2);
      expect(history[0].verseId).toBe(43003016);
      expect(history[1].verseId).toBe(43004001);
    });

    it('deduplicates same book+chapter entries', () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(43003017, 43, 3));
      // Only one entry for book 43 chapter 3 should remain; the newer one wins.
      const history = useBibleStore.getState().getHistory(PANEL);
      expect(history).toHaveLength(1);
      expect(history[0].verseId).toBe(43003017);
    });

    it('syncs navigationHistory and historyIndex into Zustand panel state', () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(43004001, 43, 4));
      const ps = useBibleStore.getState().getPanelState(PANEL);
      expect(ps.navigationHistory).toHaveLength(2);
      expect(ps.historyIndex).toBe(1);
    });
  });

  describe('goBack / goForward', () => {
    it('goBack moves the cursor and navigates the panel', async () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(44001001, 44, 1, 'Acts'));
      await useBibleStore.getState().goBack(PANEL);
      const ps = useBibleStore.getState().getPanelState(PANEL);
      expect(ps.currentBook).toBe(43);
      expect(ps.currentChapter).toBe(3);
      expect(ps.selectedVerseId).toBe(43003016);
      expect(ps.historyIndex).toBe(0);
    });

    it('goForward returns to the later entry', async () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(44001001, 44, 1, 'Acts'));
      await useBibleStore.getState().goBack(PANEL);
      await useBibleStore.getState().goForward(PANEL);
      const ps = useBibleStore.getState().getPanelState(PANEL);
      expect(ps.selectedVerseId).toBe(44001001);
      expect(ps.historyIndex).toBe(1);
    });

    it('goBack is a no-op when already at the start', async () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      const before = useBibleStore.getState().getPanelState(PANEL).historyIndex;
      await useBibleStore.getState().goBack(PANEL);
      const after = useBibleStore.getState().getPanelState(PANEL).historyIndex;
      // Only one entry; there is no previous entry to go to.
      expect(after).toBe(before);
    });
  });

  describe('navigateToHistoryEntry', () => {
    it('jumps to an arbitrary history index', async () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(PANEL, entry(44001001, 44, 1, 'Acts'));
      s._addToHistory(PANEL, entry(45001001, 45, 1, 'Romans'));
      await useBibleStore.getState().navigateToHistoryEntry(PANEL, 0);
      const ps = useBibleStore.getState().getPanelState(PANEL);
      expect(ps.currentBook).toBe(43);
      expect(ps.historyIndex).toBe(0);
    });
  });

  describe('saveScrollPosition', () => {
    it('saves scrollTop onto the current history entry', () => {
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      useBibleStore.getState().saveScrollPosition(PANEL, 1234);
      const history = useBibleStore.getState().getHistory(PANEL);
      expect(history[0].scrollTop).toBe(1234);
    });
  });

  describe('panel isolation', () => {
    it('history is independent across panels', () => {
      const OTHER = 'test_panel_nav_other';
      useBibleStore.getState().initPanel(OTHER);
      const s = useBibleStore.getState();
      s._addToHistory(PANEL, entry(43003016, 43, 3));
      s._addToHistory(OTHER, entry(44001001, 44, 1));
      expect(useBibleStore.getState().getHistory(PANEL)).toHaveLength(1);
      expect(useBibleStore.getState().getHistory(OTHER)).toHaveLength(1);
      expect(useBibleStore.getState().getHistory(PANEL)[0].verseId).toBe(43003016);
      expect(useBibleStore.getState().getHistory(OTHER)[0].verseId).toBe(44001001);
    });
  });

  describe('restoreFromSession (sessionSlice)', () => {
    it('restores open tabs and active tab index from session data', async () => {
      const sessionData = {
        openTabs: [
          {
            tabId: 'kjv-1',
            abbreviation: 'KJV',
            name: 'KJV',
            displayMode: 'reading',
            book: 45,
            chapter: 8,
            bookName: 'Romans',
            selectedVerseId: 45008001,
            history: [],
            historyIndex: -1,
          },
          {
            tabId: 'esv-1',
            abbreviation: 'ESV',
            name: 'ESV',
            displayMode: 'reading',
            book: 43,
            chapter: 3,
            bookName: 'John',
            selectedVerseId: 43003016,
            history: [],
            historyIndex: -1,
          },
        ],
        activeTabIndex: 1,
        currentBook: 43,
        currentChapter: 3,
        selectedVerseId: 43003016,
      };
      await useBibleStore.getState().restoreFromSession(PANEL, sessionData);
      const ps = useBibleStore.getState().getPanelState(PANEL);
      // A panel holds exactly one passage now, so a legacy two-sub-tab blob
      // restores the passage that was in front - the user lands where they left
      // off. (The workbench path, `loadSessionData`, additionally expands the
      // other sub-tabs into their own panels; this single-panel entry point is
      // used by detached windows, which show one passage by definition.)
      expect(ps.openTabs).toHaveLength(1);
      expect(ps.openTabs[0].tabId).toBe('esv-1');
      expect(ps.activeTabIndex).toBe(0);
      expect(ps.currentBook).toBe(43);
      expect(ps.currentChapter).toBe(3);
    });

    it('is tolerant of session data with empty openTabs', async () => {
      await useBibleStore.getState().restoreFromSession(PANEL, { openTabs: [] });
      const ps = useBibleStore.getState().getPanelState(PANEL);
      // The seeded single tab should remain since empty openTabs is a no-op.
      expect(ps.openTabs).toHaveLength(1);
    });

    it('fills missing per-tab nav state with defaults (backward compat)', async () => {
      const sessionData = {
        // Pre-slicing sessions had no per-tab book/chapter/history fields.
        openTabs: [
          { tabId: 'kjv-1', abbreviation: 'KJV', name: 'KJV', displayMode: 'reading' },
        ],
        activeTabIndex: 0,
        currentBook: 43,
        currentChapter: 3,
      };
      await useBibleStore.getState().restoreFromSession(PANEL, sessionData);
      const ps = useBibleStore.getState().getPanelState(PANEL);
      const tab = ps.openTabs[0];
      expect(tab.book).toBe(43);
      expect(tab.chapter).toBe(3);
      expect(tab.history).toEqual([]);
      expect(tab.historyIndex).toBe(-1);
    });
  });
});
