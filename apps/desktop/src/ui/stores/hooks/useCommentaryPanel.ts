import { useCallback, useMemo } from 'react';
import { useCommentaryStore } from '../useCommentaryStore';
import type { CommentaryPanelState } from '../useCommentaryStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';

/**
 * Hook that returns per-instance commentary state + actions bound to a specific panelId.
 *
 * Usage:
 *   const { openTabs, activeTabIndex, openCommentary, ... } = useCommentaryPanel(panelId);
 */
export function useCommentaryPanel(panelId: string = DEFAULT_PANEL_ID) {
  // Select shared/global state
  const availableCommentaries = useCommentaryStore(s => s.availableCommentaries);
  const loadingCommentaries = useCommentaryStore(s => s.loadingCommentaries);
  const mutedModules = useCommentaryStore(s => s.mutedModules);
  const promotedModules = useCommentaryStore(s => s.promotedModules);

  // Select per-instance state (re-renders only when this panel's state changes)
  const panelState = useCommentaryStore(s => s.panels.get(panelId));

  // Provide defaults for when panel isn't initialized yet
  const ps: CommentaryPanelState = useMemo(() => panelState ?? {
    openTabs: [],
    activeTabIndex: 0,
    currentVerseId: null,
    pinned: false,
    pinnedVerseId: null,
    liveBibleVerseId: null,
    homeData: [],
    homeLoading: false,
    homeDataVerseId: null,
    isRestoringSession: false,
    entriesByTab: new Map(),
    loadingByTab: new Map(),
    errorByTab: new Map(),
    browseModeByTab: new Map(),
    entrySummariesByTab: new Map(),
    tabActivationSeq: 0,
    loadingSummariesByTab: new Map(),
  }, [panelState]);

  // Shared actions (no panelId binding needed)
  const loadAvailableCommentaries = useCommentaryStore(s => s.loadAvailableCommentaries);
  const toggleMuted = useCommentaryStore(s => s.toggleMuted);
  const togglePromoted = useCommentaryStore(s => s.togglePromoted);

  // Bound per-panel actions
  const openCommentary = useCallback(
    (abbreviation: string, name: string) => useCommentaryStore.getState().openCommentary(panelId, abbreviation, name),
    [panelId]
  );
  const closeCommentary = useCallback(
    (abbreviation: string) => useCommentaryStore.getState().closeCommentary(panelId, abbreviation),
    [panelId]
  );
  const setActiveTab = useCallback(
    (index: number) => useCommentaryStore.getState().setActiveTab(panelId, index),
    [panelId]
  );
  const reorderTabs = useCallback(
    (sourceIndex: number, destinationIndex: number) => useCommentaryStore.getState().reorderTabs(panelId, sourceIndex, destinationIndex),
    [panelId]
  );
  const loadCommentaryForVerse = useCallback(
    (abbreviation: string, verseId: number) => useCommentaryStore.getState().loadCommentaryForVerse(panelId, abbreviation, verseId),
    [panelId]
  );
  const syncWithBibleVerse = useCallback(
    (verseId: number) => useCommentaryStore.getState().syncWithBibleVerse(panelId, verseId),
    [panelId]
  );
  const clearError = useCallback(
    (abbreviation: string) => useCommentaryStore.getState().clearError(panelId, abbreviation),
    [panelId]
  );
  const togglePin = useCallback(
    () => useCommentaryStore.getState().togglePin(panelId),
    [panelId]
  );
  const unpin = useCallback(
    () => useCommentaryStore.getState().unpin(panelId),
    [panelId]
  );
  const loadHomeData = useCallback(
    (verseId: number) => useCommentaryStore.getState().loadHomeData(panelId, verseId),
    [panelId]
  );
  const navigateToNextVerse = useCallback(
    (abbreviation: string) => useCommentaryStore.getState().navigateToNextVerse(panelId, abbreviation),
    [panelId]
  );
  const navigateToPreviousVerse = useCallback(
    (abbreviation: string) => useCommentaryStore.getState().navigateToPreviousVerse(panelId, abbreviation),
    [panelId]
  );
  const navigateToVerse = useCallback(
    (abbreviation: string, verseId: number) => useCommentaryStore.getState().navigateToVerse(panelId, abbreviation, verseId),
    [panelId]
  );
  const loadEntrySummaries = useCallback(
    (abbreviation: string) => useCommentaryStore.getState().loadEntrySummaries(panelId, abbreviation),
    [panelId]
  );
  const initializeFromState = useCallback(
    (state: Parameters<ReturnType<typeof useCommentaryStore.getState>['initializeFromState']>[1]) =>
      useCommentaryStore.getState().initializeFromState(panelId, state),
    [panelId]
  );

  return {
    // Shared
    availableCommentaries,
    loadingCommentaries,
    mutedModules,
    promotedModules,
    loadAvailableCommentaries,
    toggleMuted,
    togglePromoted,

    // Per-instance state
    openTabs: ps.openTabs,
    activeTabIndex: ps.activeTabIndex,
    currentVerseId: ps.currentVerseId,
    pinned: ps.pinned,
    pinnedVerseId: ps.pinnedVerseId,
    liveBibleVerseId: ps.liveBibleVerseId,
    homeData: ps.homeData,
    homeLoading: ps.homeLoading,
    homeDataVerseId: ps.homeDataVerseId,
    isRestoringSession: ps.isRestoringSession,
    entriesByTab: ps.entriesByTab,
    loadingByTab: ps.loadingByTab,
    errorByTab: ps.errorByTab,
    browseModeByTab: ps.browseModeByTab,
    entrySummariesByTab: ps.entrySummariesByTab,
    loadingSummariesByTab: ps.loadingSummariesByTab,
    tabActivationSeq: ps.tabActivationSeq,

    // Bound actions
    openCommentary,
    closeCommentary,
    setActiveTab,
    reorderTabs,
    loadCommentaryForVerse,
    syncWithBibleVerse,
    clearError,
    togglePin,
    unpin,
    loadHomeData,
    navigateToNextVerse,
    navigateToPreviousVerse,
    navigateToVerse,
    loadEntrySummaries,
    initializeFromState,
  };
}
