import type { StateCreator } from 'zustand';
import { VerseIdHelper } from '@bible/core';
import { bibleAPI } from '../../../services/electronAPI';
import { updatePanelState } from '../../helpers/panelStateHelpers';
import { BibleState, createDefaultPanelState } from '../types';
import { computeSelectedRange, VerseRange } from '../internals/verseRange';

export interface LoadChapterOptions {
  /**
   * Modify the current history entry instead of adding one.
   *
   * Set by the sequential paths only - the prev/next chapter buttons and the
   * Alt+Up/Down shortcuts - so that reading straight through a book leaves one
   * "recent passage", not one per chapter. A jump (search result, reference,
   * distribution graph) leaves this off and appends.
   */
  replaceHistory?: boolean;
}

export interface VerseSlice {
  loadChapterForTab: (panelId: string, tabId: string, abbreviation: string, bookNumber: number, chapter: number) => Promise<void>;
  loadChapter: (panelId: string, bookNumber: number, chapter: number, options?: LoadChapterOptions) => Promise<void>;
  loadVerse: (panelId: string, verseId: number) => Promise<void>;
  navigateToVerse: (panelId: string, verseId: number) => Promise<void>;
  setSelectedVerse: (panelId: string, verseId: number | null) => void;
  /**
   * Shift-click: widen the selection out to `verseId` without moving the
   * anchor. See `internals/verseRange.ts` for the anchor/end model.
   */
  extendSelectionTo: (panelId: string, verseId: number) => void;
  /**
   * The selected passage as an inclusive, low-to-high `[start, end]` pair, or
   * null when nothing is selected. A single selected verse yields a one-verse
   * range, so callers (copy, context menu) need no special case.
   */
  getSelectedRange: (panelId: string) => VerseRange | null;
  clearError: (panelId: string, tabId: string) => void;
}

let startupVerseAnnounced = false;

/**
 * Announce the verse the reader starts on, once. Clicks broadcast through
 * `setSelectedVerse`, but the verse restored from the session (or the default
 * first load) is selected without a click, so extensions activated at startup
 * would not know it - or which translation is open - until the reader clicked.
 */
function announceStartupVerse(verseId: number | null, moduleAbbr: string): void {
  if (startupVerseAnnounced || !verseId) return;
  if (!window.electron?.window?.broadcastVerseChange) return;
  startupVerseAnnounced = true;
  window.electron.window.broadcastVerseChange(verseId, moduleAbbr).catch(err => {
    console.error('[useBibleStore] Error announcing startup verse:', err);
  });
}

export const createVerseSlice: StateCreator<BibleState, [], [], VerseSlice> = (set, get) => ({
  // Helper: Load chapter for a specific tab within a specific panel
  loadChapterForTab: async (panelId: string, tabId: string, abbreviation: string, bookNumber: number, chapter: number) => {
    // Set loading state
    {
      const ps = get().getPanelState(panelId);
      const newLoadingMap = new Map(ps.loadingByTab);
      newLoadingMap.set(tabId, true);
      const newErrorMap = new Map(ps.errorByTab);
      newErrorMap.set(tabId, null);
      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: newLoadingMap, errorByTab: newErrorMap }, createDefaultPanelState) });
    }

    try {
      const chapterResult = await bibleAPI.getChapter(abbreviation, bookNumber, chapter);

      // Handle both old (array) and new (object with metadata) response shapes
      const verses = Array.isArray(chapterResult) ? chapterResult : chapterResult.verses;
      const hasInterlinear = Array.isArray(chapterResult) ? undefined : chapterResult.hasInterlinearData;

      // IMPORTANT: Get fresh state AFTER async operation to avoid stale closure bug
      const ps = get().getPanelState(panelId);
      const newVersesMap = new Map(ps.versesByTab);
      newVersesMap.set(tabId, verses);
      const newLoadingMap = new Map(ps.loadingByTab);
      newLoadingMap.set(tabId, false);

      // Cache interlinear data availability if provided (shared state)
      if (hasInterlinear !== undefined) {
        const newInterlinearMap = new Map(get().interlinearByModule);
        newInterlinearMap.set(abbreviation, hasInterlinear);
        set({ interlinearByModule: newInterlinearMap });
      }

      set({ panels: updatePanelState(get().panels, panelId, { versesByTab: newVersesMap, loadingByTab: newLoadingMap }, createDefaultPanelState) });
      announceStartupVerse(get().getPanelState(panelId).selectedVerseId, abbreviation);
    } catch (error) {
      const ps = get().getPanelState(panelId);
      const newLoadingMap = new Map(ps.loadingByTab);
      newLoadingMap.set(tabId, false);
      const newErrorMap = new Map(ps.errorByTab);
      newErrorMap.set(
        tabId,
        error instanceof Error ? error.message : 'Failed to load chapter'
      );

      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: newLoadingMap, errorByTab: newErrorMap }, createDefaultPanelState) });
    }
  },

  // Load a chapter (updates active tab only)
  loadChapter: async (panelId: string, bookNumber: number, chapter: number, options?: LoadChapterOptions) => {
    const ps = get().getPanelState(panelId);
    const activeTab = ps.openTabs[ps.activeTabIndex];
    if (!activeTab) return;

    // Get book name
    try {
      const bookName = await bibleAPI.getBookName(bookNumber);
      // Selection resets to verse 1 of the new chapter. Without this the
      // panel-level selectedVerseId - the one the pane actually renders from -
      // kept pointing at the verse selected in the *previous* chapter, so
      // paging back/forward left a stray highlight on an arbitrary verse.
      // History navigation does not come through here: _navigateWithoutHistory
      // restores the remembered verse itself.
      const defaultVerseId = VerseIdHelper.calculate(bookNumber, chapter, 1);
      set({
        panels: updatePanelState(get().panels, panelId, {
          currentBook: bookNumber,
          currentChapter: chapter,
          currentBookName: bookName,
          selectedVerseId: defaultVerseId,
          // A new chapter is a new selection; a range left over from the
          // previous chapter would paint verses the reader never picked.
          selectionEndVerseId: null,
          // Land on verse 1 without re-centering, and - the reason this is set
          // at all - clear any 'center' left over from an earlier back/forward.
          // scrollMode is sticky, and a stale 'center' makes the scroll effect
          // take its history-restore branch on the *next* plain verse click,
          // yanking the reader back to a scroll position from another visit.
          scrollMode: 'nearest'
        }, createDefaultPanelState)
      });

      // Load chapter for active tab only
      await get().loadChapterForTab(panelId, activeTab.tabId, activeTab.abbreviation, bookNumber, chapter);

      // Add to navigation history (KAN-29)
      get()._addToHistory(panelId, {
        verseId: defaultVerseId,
        bookNumber,
        chapter,
        bookName
      }, { replace: options?.replaceHistory });

      // Record the view for the Back button. Unlike the history above there is
      // no `replace` here on purpose: paging through five chapters leaves one
      // history entry but five visits, so Back walks back a chapter at a time
      // instead of skipping everything the reader paged through.
      get()._pushVisit(panelId, {
        verseId: defaultVerseId,
        bookNumber,
        chapter,
        bookName,
        abbreviation: activeTab.abbreviation,
      });

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
          selectedVerseId: defaultVerseId,
          history: currentPs.navigationHistory,
          historyIndex: currentPs.historyIndex
        };
        set({ panels: updatePanelState(get().panels, panelId, { openTabs: updatedTabs }, createDefaultPanelState) });
      }
    } catch (error) {
      console.error('[useBibleStore] Error loading chapter:', error);
      set({
        panels: updatePanelState(get().panels, panelId, {
          currentBook: bookNumber,
          currentChapter: chapter,
          currentBookName: 'Unknown'
        }, createDefaultPanelState)
      });
    }
  },

  // Load a single verse (active tab only)
  loadVerse: async (panelId: string, verseId: number) => {
    const ps = get().getPanelState(panelId);
    const activeTab = ps.openTabs[ps.activeTabIndex];
    if (!activeTab) return;

    const { tabId, abbreviation } = activeTab;

    {
      const newLoadingMap = new Map(ps.loadingByTab);
      newLoadingMap.set(tabId, true);
      const newErrorMap = new Map(ps.errorByTab);
      newErrorMap.set(tabId, null);
      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: newLoadingMap, errorByTab: newErrorMap }, createDefaultPanelState) });
    }

    try {
      const verse = await bibleAPI.getVerse(abbreviation, verseId);
      if (verse) {
        const currentPs = get().getPanelState(panelId);
        const newVersesMap = new Map(currentPs.versesByTab);
        newVersesMap.set(tabId, [verse]);
        const newLoadingMap = new Map(currentPs.loadingByTab);
        newLoadingMap.set(tabId, false);

        set({
          panels: updatePanelState(get().panels, panelId, {
            versesByTab: newVersesMap,
            loadingByTab: newLoadingMap,
            currentBook: verse.book_number,
            currentChapter: verse.chapter,
            selectedVerseId: verseId,
            selectionEndVerseId: null
          }, createDefaultPanelState)
        });
      } else {
        const currentPs = get().getPanelState(panelId);
        const newLoadingMap = new Map(currentPs.loadingByTab);
        newLoadingMap.set(tabId, false);
        const newErrorMap = new Map(currentPs.errorByTab);
        newErrorMap.set(tabId, 'Verse not found');
        set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: newLoadingMap, errorByTab: newErrorMap }, createDefaultPanelState) });
      }
    } catch (error) {
      const currentPs = get().getPanelState(panelId);
      const newLoadingMap = new Map(currentPs.loadingByTab);
      newLoadingMap.set(tabId, false);
      const newErrorMap = new Map(currentPs.errorByTab);
      newErrorMap.set(tabId, error instanceof Error ? error.message : 'Failed to load verse');
      set({ panels: updatePanelState(get().panels, panelId, { loadingByTab: newLoadingMap, errorByTab: newErrorMap }, createDefaultPanelState) });
    }
  },

  // Navigate to a specific verse (parses verseId and loads the chapter) - active tab only
  navigateToVerse: async (panelId: string, verseId: number) => {
    try {
      const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
      const bookName = await bibleAPI.getBookName(bookNumber);

      const ps = get().getPanelState(panelId);
      const activeTab = ps.openTabs[ps.activeTabIndex];
      if (!activeTab) return;

      // If same chapter, just update selected verse and history
      if (bookNumber === ps.currentBook && chapter === ps.currentChapter) {
        set({
          panels: updatePanelState(get().panels, panelId, {
            selectedVerseId: verseId,
            selectionEndVerseId: null,
            // A deliberate navigation supersedes a preview - see previewSlice.
            previewVerseId: null,
            previewVerseEndId: null,
            backBarVerseId: null,
            scrollMode: 'center',
            scrollTrigger: ps.scrollTrigger + 1
          }, createDefaultPanelState)
        });
        get()._addToHistory(panelId, { verseId, bookNumber, chapter, bookName });
        // Same chapter: not a view change, so this refreshes the current visit
        // rather than stacking a duplicate - Back still leaves the chapter, but
        // returning to it later lands on the verse the reader was actually on.
        get()._pushVisit(panelId, {
          verseId, bookNumber, chapter, bookName,
          abbreviation: activeTab.abbreviation,
        });
        return;
      }

      // Different chapter - load it for active tab only
      set({
        panels: updatePanelState(get().panels, panelId, {
          currentBook: bookNumber,
          currentChapter: chapter,
          currentBookName: bookName,
          selectedVerseId: verseId,
          selectionEndVerseId: null,
          previewVerseId: null,
          previewVerseEndId: null,
          backBarVerseId: null,
          scrollMode: 'center',
          scrollTrigger: ps.scrollTrigger + 1
        }, createDefaultPanelState)
      });

      await get().loadChapterForTab(panelId, activeTab.tabId, activeTab.abbreviation, bookNumber, chapter);

      // Add to navigation history
      get()._addToHistory(panelId, { verseId, bookNumber, chapter, bookName });

      // ...and to the Back button's visit stack (search result, cross-reference,
      // topic click - every one of these is a view change).
      get()._pushVisit(panelId, {
        verseId, bookNumber, chapter, bookName,
        abbreviation: activeTab.abbreviation,
      });

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
          selectedVerseId: verseId,
          history: currentPs.navigationHistory,
          historyIndex: currentPs.historyIndex
        };
        set({ panels: updatePanelState(get().panels, panelId, { openTabs: updatedTabs }, createDefaultPanelState) });
      }
    } catch (error) {
      console.error('[useBibleStore] Error navigating to verse:', error);
    }
  },

  // Set selected verse (used for clicks - uses 'nearest' scroll mode)
  setSelectedVerse: (panelId: string, verseId: number | null) => {
    const ps = get().getPanelState(panelId);

    // Save to active tab
    const updatedTabs = [...ps.openTabs];
    if (updatedTabs[ps.activeTabIndex]) {
      updatedTabs[ps.activeTabIndex] = { ...updatedTabs[ps.activeTabIndex], selectedVerseId: verseId };
    }

    set({
      panels: updatePanelState(get().panels, panelId, {
        selectedVerseId: verseId,
        // A plain click starts a fresh selection, so any shift-click
        // extension goes with it.
        selectionEndVerseId: null,
        // ...and so does any preview. Choosing a verse is the decision a
        // preview was deliberately withholding; leaving the soft mark behind
        // would leave two verses claiming to be the current one.
        previewVerseId: null,
        previewVerseEndId: null,
        backBarVerseId: null,
        scrollMode: 'nearest',
        openTabs: updatedTabs
      }, createDefaultPanelState)
    });

    // Broadcast verse change to detached windows for syncing. The module goes
    // with it so extensions learn which translation the reader is in, rather
    // than being told the app default.
    if (verseId && window.electron?.window?.broadcastVerseChange) {
      const moduleAbbr = updatedTabs[ps.activeTabIndex]?.abbreviation;
      window.electron.window.broadcastVerseChange(verseId, moduleAbbr).catch(err => {
        console.error('[useBibleStore] Error broadcasting verse change:', err);
      });
    }
  },

  /**
   * Shift-click: extend the selection from the anchor out to `verseId`.
   *
   * With no anchor yet there is nothing to extend from, so this behaves as a
   * plain click and sets one - the same thing a shift-click does in a list
   * with no prior selection. Shift-clicking the anchor itself collapses back
   * to the single verse.
   *
   * The anchor deliberately does NOT move: the study/commentary/notes panes
   * follow `selectedVerseId`, and widening a passage is not a request to make
   * them all reload against a different verse. Nothing here is written to the
   * tab, so the range never reaches the session.
   */
  extendSelectionTo: (panelId: string, verseId: number) => {
    const ps = get().getPanelState(panelId);
    const anchor = ps.selectedVerseId;

    if (anchor === null) {
      get().setSelectedVerse(panelId, verseId);
      return;
    }

    set({
      panels: updatePanelState(get().panels, panelId, {
        selectionEndVerseId: anchor === verseId ? null : verseId,
        // Extending a passage is a selection gesture, so it ends any preview
        // for the same reason a plain click does.
        previewVerseId: null,
        previewVerseEndId: null,
        backBarVerseId: null,
      }, createDefaultPanelState)
    });
  },

  getSelectedRange: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    return computeSelectedRange(ps.selectedVerseId, ps.selectionEndVerseId);
  },

  // Clear error for a specific tab
  clearError: (panelId: string, tabId: string) => {
    const ps = get().getPanelState(panelId);
    const newErrorMap = new Map(ps.errorByTab);
    newErrorMap.set(tabId, null);
    set({ panels: updatePanelState(get().panels, panelId, { errorByTab: newErrorMap }, createDefaultPanelState) });
  },
});
