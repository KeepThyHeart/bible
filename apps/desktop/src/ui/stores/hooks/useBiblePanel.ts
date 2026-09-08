import { useMemo } from 'react';
import { useBibleStore } from '../useBibleStore';
import type { BiblePanelState, DisplayMode, StudyModeOptions } from '../useBibleStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';

/**
 * Hook that returns per-instance Bible state + actions bound to a specific panelId.
 *
 * Usage:
 *   const { openTabs, activeTabIndex, openBible, ... } = useBiblePanel(panelId);
 *
 * Actions are bound once via useMemo (not individual useCallbacks) since panelId
 * rarely changes. This reduces memory overhead from 25+ Function objects to one
 * memoized actions object.
 */
export function useBiblePanel(panelId: string = DEFAULT_PANEL_ID) {
  // Select shared/global state
  const availableBibles = useBibleStore(s => s.availableBibles);
  const loadingBibles = useBibleStore(s => s.loadingBibles);
  const initialLoadComplete = useBibleStore(s => s.initialLoadComplete);
  const interlinearByModule = useBibleStore(s => s.interlinearByModule);

  // Select per-instance state (re-renders only when this panel's state changes)
  const panelState = useBibleStore(s => s.panels.get(panelId));

  // Provide defaults for when panel isn't initialized yet
  const ps: BiblePanelState = useMemo(() => panelState ?? {
    openTabs: [],
    activeTabIndex: 0,
    isParallelViewMode: false,
    parallelVersions: [],
    currentBook: 43,
    currentChapter: 3,
    currentBookName: 'John',
    selectedVerseId: null,
    selectionEndVerseId: null,
    previewVerseId: null,
    previewVerseEndId: null,
    backBarVerseId: null,
    scrollTrigger: 0,
    scrollMode: 'nearest' as const,
    navigationHistory: [],
    historyIndex: -1,
    maxHistorySize: 10,
    visitStack: [],
    versesByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    studyOptionsByTab: new Map(),
  }, [panelState]);

  // Shared actions (no panelId binding needed - stable references from Zustand)
  const loadAvailableBibles = useBibleStore(s => s.loadAvailableBibles);
  const loadInitialData = useBibleStore(s => s.loadInitialData);
  const navigateToVerseInPrimary = useBibleStore(s => s.navigateToVerseInPrimary);
  const getTabFromAnyPanel = useBibleStore(s => s.getTabFromAnyPanel);

  // All per-panel actions bound to panelId in a single memoized object.
  // Uses getState() to avoid subscribing to every action reference -
  // these are fire-and-forget calls that don't need to trigger re-renders.
  const boundActions = useMemo(() => {
    const s = () => useBibleStore.getState();
    return {
      openBible: (abbreviation: string, name: string, displayMode?: DisplayMode) =>
        s().openBible(panelId, abbreviation, name, displayMode),
      closeBible: (tabId: string) =>
        s().closeBible(panelId, tabId),
      setDisplayMode: (tabId: string, mode: DisplayMode) =>
        s().setDisplayMode(panelId, tabId, mode),
      setStudyOptions: (tabId: string, options: Partial<StudyModeOptions>) =>
        s().setStudyOptions(panelId, tabId, options),
      getStudyOptions: (tabId: string) =>
        s().getStudyOptions(panelId, tabId),
      setTabShowInterlinear: (tabId: string, value: boolean) =>
        s().setTabShowInterlinear(panelId, tabId, value),
      setTabShowNotes: (tabId: string, value: boolean) =>
        s().setTabShowNotes(panelId, tabId, value),
      toggleParallelView: () =>
        s().toggleParallelView(panelId),
      setParallelVersions: (versions: string[]) =>
        s().setParallelVersions(panelId, versions),
      changeTabVersion: (tabId: string, abbreviation: string, name: string) =>
        s().changeTabVersion(panelId, tabId, abbreviation, name),
      openPassageInNewPanel: (book: number, chapter: number, verse?: number) =>
        s().openPassageInNewPanel(book, chapter, verse, panelId),
      loadChapterForTab: (tabId: string, abbreviation: string, bookNumber: number, chapter: number) =>
        s().loadChapterForTab(panelId, tabId, abbreviation, bookNumber, chapter),
      loadChapter: (bookNumber: number, chapter: number) =>
        s().loadChapter(panelId, bookNumber, chapter),
      loadVerse: (verseId: number) =>
        s().loadVerse(panelId, verseId),
      navigateToVerse: (verseId: number) =>
        s().navigateToVerse(panelId, verseId),
      setSelectedVerse: (verseId: number | null) =>
        s().setSelectedVerse(panelId, verseId),
      // Shift-click: widen the selection without moving the anchor.
      extendSelectionTo: (verseId: number) =>
        s().extendSelectionTo(panelId, verseId),
      getSelectedRange: () =>
        s().getSelectedRange(panelId),
      clearError: (tabId: string) =>
        s().clearError(panelId, tabId),
      canGoBack: () =>
        s().canGoBack(panelId),
      canGoForward: () =>
        s().canGoForward(panelId),
      goBack: () =>
        s().goBack(panelId),
      goForward: () =>
        s().goForward(panelId),
      // The Back *button* runs on the visit stack, not the history cursor -
      // "undo my last view change", including chapters paged through and
      // including a jump made from the history menu.
      canGoBackVisit: () =>
        s().canGoBackVisit(panelId),
      goBackVisit: () =>
        s().goBackVisit(panelId),
      getHistory: () =>
        s().getHistory(panelId),
      navigateToHistoryEntry: (index: number) =>
        s().navigateToHistoryEntry(panelId, index),
      saveScrollPosition: (scrollTop: number) =>
        s().saveScrollPosition(panelId, scrollTop),
      restoreFromSession: (sessionData: unknown) =>
        s().restoreFromSession(panelId, sessionData),
      restorePanelFromSession: () =>
        s().restorePanelFromSession(panelId),
      hasPendingSession: () =>
        s().hasPendingSession(panelId),
    };
  }, [panelId]);

  return {
    // Shared
    availableBibles,
    loadingBibles,
    initialLoadComplete,
    interlinearByModule,
    loadAvailableBibles,
    loadInitialData,
    navigateToVerseInPrimary,
    getTabFromAnyPanel,

    // Per-instance state (flat)
    openTabs: ps.openTabs,
    activeTabIndex: ps.activeTabIndex,
    isParallelViewMode: ps.isParallelViewMode,
    parallelVersions: ps.parallelVersions,
    currentBook: ps.currentBook,
    currentChapter: ps.currentChapter,
    currentBookName: ps.currentBookName,
    selectedVerseId: ps.selectedVerseId,
    selectionEndVerseId: ps.selectionEndVerseId,
    previewVerseId: ps.previewVerseId,
    previewVerseEndId: ps.previewVerseEndId,
    backBarVerseId: ps.backBarVerseId,
    scrollTrigger: ps.scrollTrigger,
    scrollMode: ps.scrollMode,
    navigationHistory: ps.navigationHistory,
    historyIndex: ps.historyIndex,
    visitStack: ps.visitStack,
    versesByTab: ps.versesByTab,
    loadingByTab: ps.loadingByTab,
    errorByTab: ps.errorByTab,
    studyOptionsByTab: ps.studyOptionsByTab,

    // Bound actions
    ...boundActions,
  };
}
