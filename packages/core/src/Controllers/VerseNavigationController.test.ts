import { describe, it, expect, beforeEach } from 'vitest';
import { VerseNavigationController, HistoryEntry } from './VerseNavigationController';

function makeEntry(bookNumber: number, chapter: number, verseId?: number): HistoryEntry {
  const books: Record<number, string> = { 1: 'Genesis', 43: 'John', 45: 'Romans', 66: 'Revelation' };
  return {
    verseId: verseId ?? (bookNumber * 1000000 + chapter * 1000 + 1),
    bookNumber,
    chapter,
    bookName: books[bookNumber] ?? `Book${bookNumber}`,
  };
}

describe('VerseNavigationController', () => {
  let nav: VerseNavigationController;

  beforeEach(() => {
    nav = new VerseNavigationController();
  });

  // ==========================================================================
  // Constructor and Initial State
  // ==========================================================================

  describe('initial state', () => {
    it('should start with empty history', () => {
      expect(nav.getHistory()).toEqual([]);
      expect(nav.getHistoryIndex()).toBe(-1);
    });

    it('should not be able to go back or forward initially', () => {
      expect(nav.canGoBack()).toBe(false);
      expect(nav.canGoForward()).toBe(false);
    });

    it('should return null for current entry when empty', () => {
      expect(nav.getCurrentEntry()).toBeNull();
    });

    it('should accept custom max history size', () => {
      const custom = new VerseNavigationController(5);
      const state = custom.serializeState();
      expect(state.maxHistorySize).toBe(5);
    });
  });

  // ==========================================================================
  // addEntry
  // ==========================================================================

  describe('addEntry', () => {
    it('should add a single entry', () => {
      const entry = makeEntry(43, 3);
      nav.addEntry(entry);

      expect(nav.getHistory()).toHaveLength(1);
      expect(nav.getCurrentEntry()).toEqual(entry);
      expect(nav.getHistoryIndex()).toBe(0);
    });

    it('should add multiple entries', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));
      nav.addEntry(makeEntry(45, 8));

      expect(nav.getHistory()).toHaveLength(3);
      expect(nav.getHistoryIndex()).toBe(2);
    });

    it('should deduplicate by chapter (same book + chapter)', () => {
      nav.addEntry(makeEntry(43, 3, 43003016));
      nav.addEntry(makeEntry(45, 8));
      nav.addEntry(makeEntry(43, 3, 43003017)); // same book+chapter as first

      // The old John 3 entry should be removed, replaced by the new one
      expect(nav.getHistory()).toHaveLength(2);
      expect(nav.getCurrentEntry()!.bookNumber).toBe(43);
      expect(nav.getCurrentEntry()!.chapter).toBe(3);
      expect(nav.getCurrentEntry()!.verseId).toBe(43003017);
    });

    it('should truncate forward history when adding (browser behavior)', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));
      nav.addEntry(makeEntry(45, 8));

      // Go back twice
      nav.goBack();
      nav.goBack();
      expect(nav.getHistoryIndex()).toBe(0);

      // Add new entry - forward history should be lost
      nav.addEntry(makeEntry(66, 1));

      expect(nav.getHistory()).toHaveLength(2);
      expect(nav.getCurrentEntry()!.bookNumber).toBe(66);
      expect(nav.canGoForward()).toBe(false);
    });

    it('should cap at maxHistorySize', () => {
      const small = new VerseNavigationController(3);
      small.addEntry(makeEntry(43, 1));
      small.addEntry(makeEntry(43, 2));
      small.addEntry(makeEntry(43, 3));
      small.addEntry(makeEntry(43, 4));

      expect(small.getHistory()).toHaveLength(3);
      // Oldest entry (chapter 1) should be gone
      expect(small.getHistory()[0].chapter).toBe(2);
    });
  });

  // ==========================================================================
  // goBack / goForward
  // ==========================================================================

  describe('goBack', () => {
    it('should return null when no history', () => {
      expect(nav.goBack()).toBeNull();
    });

    it('should return null at the start of history', () => {
      nav.addEntry(makeEntry(43, 1));
      expect(nav.goBack()).toBeNull();
    });

    it('should navigate to previous entry', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));

      const result = nav.goBack();

      expect(result).not.toBeNull();
      expect(result!.chapter).toBe(1);
      expect(nav.getHistoryIndex()).toBe(0);
    });

    it('should support multiple back navigations', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));
      nav.addEntry(makeEntry(45, 8));

      nav.goBack();
      const result = nav.goBack();

      expect(result!.chapter).toBe(1);
      expect(nav.getHistoryIndex()).toBe(0);
    });
  });

  describe('goForward', () => {
    it('should return null when no forward history', () => {
      nav.addEntry(makeEntry(43, 1));
      expect(nav.goForward()).toBeNull();
    });

    it('should navigate forward after going back', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));

      nav.goBack();
      const result = nav.goForward();

      expect(result!.chapter).toBe(3);
      expect(nav.getHistoryIndex()).toBe(1);
    });
  });

  describe('canGoBack / canGoForward', () => {
    it('should correctly report navigation availability', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));

      expect(nav.canGoBack()).toBe(true);
      expect(nav.canGoForward()).toBe(false);

      nav.goBack();

      expect(nav.canGoBack()).toBe(false);
      expect(nav.canGoForward()).toBe(true);
    });
  });

  // ==========================================================================
  // navigateToIndex
  // ==========================================================================

  describe('navigateToIndex', () => {
    it('should jump to a specific index', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));
      nav.addEntry(makeEntry(45, 8));

      const result = nav.navigateToIndex(0);

      expect(result!.chapter).toBe(1);
      expect(nav.getHistoryIndex()).toBe(0);
    });

    it('should return null for negative index', () => {
      nav.addEntry(makeEntry(43, 1));
      expect(nav.navigateToIndex(-1)).toBeNull();
    });

    it('should return null for out-of-range index', () => {
      nav.addEntry(makeEntry(43, 1));
      expect(nav.navigateToIndex(5)).toBeNull();
    });
  });

  // ==========================================================================
  // saveScrollPosition
  // ==========================================================================

  describe('saveScrollPosition', () => {
    it('should save scroll position on current entry', () => {
      nav.addEntry(makeEntry(43, 3));
      nav.saveScrollPosition(250);

      expect(nav.getCurrentEntry()!.scrollTop).toBe(250);
    });

    it('should not throw when history is empty', () => {
      // Should be a no-op
      expect(() => nav.saveScrollPosition(100)).not.toThrow();
    });

    it('should preserve scroll on back/forward', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.saveScrollPosition(100);
      nav.addEntry(makeEntry(43, 3));
      nav.saveScrollPosition(200);

      nav.goBack();
      expect(nav.getCurrentEntry()!.scrollTop).toBe(100);

      nav.goForward();
      expect(nav.getCurrentEntry()!.scrollTop).toBe(200);
    });
  });

  // ==========================================================================
  // Serialization
  // ==========================================================================

  describe('serializeState / restoreState', () => {
    it('should round-trip state correctly', () => {
      nav.addEntry(makeEntry(43, 1));
      nav.addEntry(makeEntry(43, 3));
      nav.saveScrollPosition(150);
      nav.addEntry(makeEntry(45, 8));
      nav.goBack(); // index should be 1

      const serialized = nav.serializeState();

      const restored = new VerseNavigationController();
      restored.restoreState(serialized);

      expect(restored.getHistory()).toHaveLength(3);
      expect(restored.getHistoryIndex()).toBe(1);
      expect(restored.getCurrentEntry()!.chapter).toBe(3);
      expect(restored.getCurrentEntry()!.scrollTop).toBe(150);
      expect(restored.canGoBack()).toBe(true);
      expect(restored.canGoForward()).toBe(true);
    });

    it('should serialize empty state', () => {
      const state = nav.serializeState();
      expect(state.history).toEqual([]);
      expect(state.historyIndex).toBe(-1);
    });
  });

  // ==========================================================================
  // getHistory (returns copy)
  // ==========================================================================

  describe('getHistory', () => {
    it('should return a copy, not the internal array', () => {
      nav.addEntry(makeEntry(43, 1));
      const history = nav.getHistory();
      history.push(makeEntry(45, 1)); // mutate the copy

      expect(nav.getHistory()).toHaveLength(1); // internal unchanged
    });
  });
});
