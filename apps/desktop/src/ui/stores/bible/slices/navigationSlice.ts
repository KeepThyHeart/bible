import type { StateCreator } from 'zustand';
import { bibleAPI } from '../../../services/electronAPI';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { BibleState, ChapterVisit, HistoryEntry, createDefaultPanelState } from '../types';
import {
  addHistoryEntry,
  goBack as goBackSlot,
  goForward as goForwardSlot,
  navigateToIndex as navigateToIndexSlot,
  saveScrollPositionAt,
  canGoBack as canGoBackSlot,
  canGoForward as canGoForwardSlot,
  NavigationSlot,
} from '../internals/navigationHistory';
import {
  canGoBackVisit as canGoBackVisitStack,
  popVisit,
  pushVisit,
  saveVisitScrollTop,
} from '../internals/visitStack';

export interface NavigationSlice {
  // Navigation history actions (KAN-29)
  canGoBack: (panelId: string) => boolean;
  canGoForward: (panelId: string) => boolean;
  goBack: (panelId: string) => Promise<void>;
  goForward: (panelId: string) => Promise<void>;
  getHistory: (panelId: string) => HistoryEntry[];
  navigateToHistoryEntry: (panelId: string, index: number) => Promise<void>;

  // -- Back button (visit stack) - a separate feature from the history above.
  /** True when the panel has a previously viewed chapter to return to. */
  canGoBackVisit: (panelId: string) => boolean;
  /** Undo the last view change: return to the chapter viewed before this one. */
  goBackVisit: (panelId: string) => Promise<void>;
  /** The Back button's stack, oldest first. Exposed for tests and the toolbar. */
  getVisitStack: (panelId: string) => ChapterVisit[];
  /** Record a chapter view. Called by every path that changes the chapter. */
  _pushVisit: (panelId: string, visit: ChapterVisit) => void;

  _navigateWithoutHistory: (
    panelId: string,
    bookNumber: number,
    chapter: number,
    verseId: number,
    options?: { recordVisit?: boolean },
  ) => Promise<void>;
  /** `replace` records a sequential step (chapter paging) over the current entry. */
  _addToHistory: (panelId: string, entry: HistoryEntry, options?: { replace?: boolean }) => void;
  /** Save current scroll position to the current history entry */
  saveScrollPosition: (panelId: string, scrollTop: number) => void;
}

/** Extract the navigation slot from the current panel state. */
function slotFor(state: BibleState, panelId: string): NavigationSlot {
  const ps = state.getPanelState(panelId);
  return {
    history: ps.navigationHistory,
    historyIndex: ps.historyIndex,
    maxHistorySize: ps.maxHistorySize,
  };
}

/**
 * Persist a navigation slot back into the store, updating both the panel-level
 * fields and the active tab's mirrored history/historyIndex.
 */
function writeSlot(
  state: BibleState,
  set: (partial: Partial<BibleState>) => void,
  panelId: string,
  slot: NavigationSlot
): void {
  const ps = state.getPanelState(panelId);
  const updatedTabs = [...ps.openTabs];
  if (updatedTabs[ps.activeTabIndex]) {
    updatedTabs[ps.activeTabIndex] = {
      ...updatedTabs[ps.activeTabIndex],
      history: slot.history,
      historyIndex: slot.historyIndex,
    };
  }
  set({
    panels: updatePanelState(state.panels, panelId, {
      navigationHistory: slot.history,
      historyIndex: slot.historyIndex,
      maxHistorySize: slot.maxHistorySize,
      openTabs: updatedTabs,
    }, createDefaultPanelState),
  });
}

/**
 * After the Back button moves the panel, point the history cursor at the
 * chapter now on screen.
 *
 * This is the *only* place the two features touch. The dropdown marks one row
 * as "you are here"; leaving that marker on a chapter the reader has just left
 * would be a lie. When the chapter is already in the history the cursor simply
 * moves to it - which is what makes the user's headline case work: jump
 * backwards from the menu, press Back, and you land on the entry you came from
 * with the rest of the menu intact.
 *
 * When it is *not* in the history it is almost certainly a chapter that was
 * paged through (paging replaces rather than appends), so it is recorded the
 * same way paging records one - over the current entry - rather than growing
 * the menu by a row per Back press.
 */
function syncHistoryCursorToChapter(
  state: BibleState,
  set: (partial: Partial<BibleState>) => void,
  panelId: string,
  target: ChapterVisit,
): void {
  const slot = slotFor(state, panelId);
  const index = slot.history.findIndex(
    h => h.bookNumber === target.bookNumber && h.chapter === target.chapter
  );

  if (index >= 0) {
    const history = slot.history.slice();
    const entry = history[index];
    // The visit remembers where the reader had scrolled to; the scroll-restore
    // effect reads the history entry, so hand it over when the entry has none.
    if (entry && entry.scrollTop === undefined && target.scrollTop !== undefined) {
      history[index] = { ...entry, scrollTop: target.scrollTop };
    }
    writeSlot(state, set, panelId, { ...slot, history, historyIndex: index });
    return;
  }

  writeSlot(state, set, panelId, addHistoryEntry(slot, {
    verseId: target.verseId,
    bookNumber: target.bookNumber,
    chapter: target.chapter,
    bookName: target.bookName,
    ...(target.scrollTop !== undefined ? { scrollTop: target.scrollTop } : {}),
  }, { replace: true }));
}

export const createNavigationSlice: StateCreator<BibleState, [], [], NavigationSlice> = (set, get) => ({
  // Navigation history actions (KAN-29) - operate directly on Zustand state.
  canGoBack: (panelId: string) => canGoBackSlot(slotFor(get(), panelId)),

  canGoForward: (panelId: string) => canGoForwardSlot(slotFor(get(), panelId)),

  goBack: async (panelId: string) => {
    const result = goBackSlot(slotFor(get(), panelId));
    if (!result) return;

    set({ panels: updatePanelState(get().panels, panelId, { historyIndex: result.slot.historyIndex }, createDefaultPanelState) });

    await get()._navigateWithoutHistory(panelId, result.entry.bookNumber, result.entry.chapter, result.entry.verseId);
  },

  goForward: async (panelId: string) => {
    const result = goForwardSlot(slotFor(get(), panelId));
    if (!result) return;

    set({ panels: updatePanelState(get().panels, panelId, { historyIndex: result.slot.historyIndex }, createDefaultPanelState) });

    await get()._navigateWithoutHistory(panelId, result.entry.bookNumber, result.entry.chapter, result.entry.verseId);
  },

  getHistory: (panelId: string) => slotFor(get(), panelId).history.slice(),

  navigateToHistoryEntry: async (panelId: string, index: number) => {
    const result = navigateToIndexSlot(slotFor(get(), panelId), index);
    if (!result) return;

    set({ panels: updatePanelState(get().panels, panelId, { historyIndex: result.slot.historyIndex }, createDefaultPanelState) });

    await get()._navigateWithoutHistory(panelId, result.entry.bookNumber, result.entry.chapter, result.entry.verseId);
  },

  // -- Back button (visit stack) -----------------------------------------
  canGoBackVisit: (panelId: string) => canGoBackVisitStack(get().getPanelState(panelId).visitStack),

  getVisitStack: (panelId: string) => get().getPanelState(panelId).visitStack.slice(),

  _pushVisit: (panelId: string, visit: ChapterVisit) => {
    const ps = get().getPanelState(panelId);
    set({
      panels: updatePanelState(get().panels, panelId, {
        visitStack: pushVisit(ps.visitStack, visit),
      }, createDefaultPanelState),
    });
  },

  goBackVisit: async (panelId: string) => {
    const popped = popVisit(get().getPanelState(panelId).visitStack);
    if (!popped) return;

    set({
      panels: updatePanelState(get().panels, panelId, { visitStack: popped.stack }, createDefaultPanelState),
    });

    syncHistoryCursorToChapter(get(), set as (partial: Partial<BibleState>) => void, panelId, popped.target);

    // `recordVisit: false` is what keeps Back from pushing the chapter it just
    // navigated to back onto the stack - without it, Back would toggle between
    // two chapters forever.
    await get()._navigateWithoutHistory(
      panelId,
      popped.target.bookNumber,
      popped.target.chapter,
      popped.target.verseId,
      { recordVisit: false },
    );
  },

  // Internal: Navigate without adding to history (used by back/forward and the
  // history menu) - active tab only. It still records a *visit* by default: a
  // jump from the history menu is a view change like any other, so Back
  // afterwards returns the reader to where they were.
  _navigateWithoutHistory: async (
    panelId: string,
    bookNumber: number,
    chapter: number,
    verseId: number,
    options?: { recordVisit?: boolean },
  ) => {
    const ps = get().getPanelState(panelId);
    const activeTab = ps.openTabs[ps.activeTabIndex];
    if (!activeTab) return;

    try {
      const bookName = await bibleAPI.getBookName(bookNumber);
      if (options?.recordVisit !== false) {
        get()._pushVisit(panelId, {
          bookNumber, chapter, bookName, verseId,
          abbreviation: activeTab.abbreviation,
        });
      }
      set({
        panels: updatePanelState(get().panels, panelId, {
          currentBook: bookNumber,
          currentChapter: chapter,
          currentBookName: bookName,
          selectedVerseId: verseId,
          // History navigation lands on a remembered single verse; a range
          // from before the jump has nothing to do with where we arrived.
          selectionEndVerseId: null,
          scrollTrigger: ps.scrollTrigger + 1,
          scrollMode: 'center'
        }, createDefaultPanelState)
      });

      // Load chapter for active tab only
      await get().loadChapterForTab(panelId, activeTab.tabId, activeTab.abbreviation, bookNumber, chapter);

      // Update active tab's navigation state
      const currentPs = get().getPanelState(panelId);
      const updatedTabs = [...currentPs.openTabs];
      const idx = currentPs.activeTabIndex;
      if (updatedTabs[idx]) {
        updatedTabs[idx] = {
          ...updatedTabs[idx],
          book: bookNumber,
          chapter,
          bookName,
          selectedVerseId: verseId
        };
        set({ panels: updatePanelState(get().panels, panelId, { openTabs: updatedTabs }, createDefaultPanelState) });
      }
    } catch (error) {
      console.error('[useBibleStore] Error in _navigateWithoutHistory:', error);
    }
  },

  // Internal: Add entry to history (pure update - no side-channel controller)
  _addToHistory: (panelId: string, entry: HistoryEntry, options?: { replace?: boolean }) => {
    const nextSlot = addHistoryEntry(slotFor(get(), panelId), entry, options);
    writeSlot(get(), set as (partial: Partial<BibleState>) => void, panelId, nextSlot);
  },

  saveScrollPosition: (panelId: string, scrollTop: number) => {
    const nextSlot = saveScrollPositionAt(slotFor(get(), panelId), scrollTop);
    // Both records get the offset: the history entry for the existing
    // restore path, and the current visit so a later Back to this chapter
    // lands where the reader left it even if the history entry has aged out.
    const visitStack = saveVisitScrollTop(get().getPanelState(panelId).visitStack, scrollTop);
    set({
      panels: updatePanelState(get().panels, panelId, {
        navigationHistory: nextSlot.history,
        visitStack,
      }, createDefaultPanelState),
    });
  },
});
