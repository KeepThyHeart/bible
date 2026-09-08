import { useCallback, useMemo } from 'react';
import { useBookStore, createDefaultBookPanelState } from '../useBookStore';
import type { BookPanelState, PaneTabRef } from '../useBookStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';

/**
 * Hook that returns per-instance book state + actions bound to a specific panelId.
 *
 * Usage:
 *   const { openTabs, activeTabIndex, openBook, ... } = useBookPanel(panelId);
 */
export function useBookPanel(panelId: string = DEFAULT_PANEL_ID) {
  // Select shared/global state
  const availableBooks = useBookStore(s => s.availableBooks);
  const loadingBooks = useBookStore(s => s.loadingBooks);

  // Select per-instance state (re-renders only when this panel's state changes)
  const panelState = useBookStore(s => s.panels.get(panelId));

  // Provide defaults for when panel isn't initialized yet
  const ps: BookPanelState = useMemo(() => panelState ?? createDefaultBookPanelState(), [panelState]);

  // Shared actions (no panelId binding needed)
  const loadAvailableBooks = useBookStore(s => s.loadAvailableBooks);

  // Bound per-panel actions
  const openBook = useCallback(
    (abbreviation: string, name: string, initialSectionId?: number) =>
      useBookStore.getState().openBook(panelId, abbreviation, name, initialSectionId),
    [panelId]
  );
  const closeBook = useCallback(
    (abbreviation: string) => useBookStore.getState().closeBook(panelId, abbreviation),
    [panelId]
  );
  const setActiveTab = useCallback(
    (index: number) => useBookStore.getState().setActiveTab(panelId, index),
    [panelId]
  );
  const reorderTabs = useCallback(
    (sourceIndex: number, destinationIndex: number) => useBookStore.getState().reorderTabs(panelId, sourceIndex, destinationIndex),
    [panelId]
  );
  const setTabOrder = useCallback(
    (order: PaneTabRef[]) => useBookStore.getState().setTabOrder(panelId, order),
    [panelId]
  );
  const loadSection = useCallback(
    (abbreviation: string, sectionId: number) => useBookStore.getState().loadSection(panelId, abbreviation, sectionId),
    [panelId]
  );
  const navigateToHome = useCallback(
    (abbreviation: string) => useBookStore.getState().navigateToHome(panelId, abbreviation),
    [panelId]
  );
  const clearError = useCallback(
    (abbreviation: string) => useBookStore.getState().clearError(panelId, abbreviation),
    [panelId]
  );
  const navigateToNextSection = useCallback(
    (abbreviation: string) => useBookStore.getState().navigateToNextSection(panelId, abbreviation),
    [panelId]
  );
  const navigateToPreviousSection = useCallback(
    (abbreviation: string) => useBookStore.getState().navigateToPreviousSection(panelId, abbreviation),
    [panelId]
  );
  const navigateToParentSection = useCallback(
    (abbreviation: string) => useBookStore.getState().navigateToParentSection(panelId, abbreviation),
    [panelId]
  );
  const navigateToSection = useCallback(
    (abbreviation: string, sectionId: number) => useBookStore.getState().navigateToSection(panelId, abbreviation, sectionId),
    [panelId]
  );
  const loadSectionSummaries = useCallback(
    (abbreviation: string) => useBookStore.getState().loadSectionSummaries(panelId, abbreviation),
    [panelId]
  );
  const loadChildSections = useCallback(
    (abbreviation: string, sectionId: number) => useBookStore.getState().loadChildSections(panelId, abbreviation, sectionId),
    [panelId]
  );
  const preloadBackgroundTabs = useCallback(
    () => useBookStore.getState().preloadBackgroundTabs(panelId),
    [panelId]
  );
  const restoreFromSession = useCallback(
    (sessionData: Parameters<ReturnType<typeof useBookStore.getState>['restoreFromSession']>[1]) =>
      useBookStore.getState().restoreFromSession(panelId, sessionData),
    [panelId]
  );

  return {
    // Shared
    availableBooks,
    loadingBooks,
    loadAvailableBooks,

    // Per-instance state (flat)
    openTabs: ps.openTabs,
    activeTabIndex: ps.activeTabIndex,
    tabOrder: ps.tabOrder,
    currentSectionByTab: ps.currentSectionByTab,
    sectionsByTab: ps.sectionsByTab,
    loadingByTab: ps.loadingByTab,
    errorByTab: ps.errorByTab,
    sectionSummariesByTab: ps.sectionSummariesByTab,
    loadingSummariesByTab: ps.loadingSummariesByTab,
    summariesErrorByTab: ps.summariesErrorByTab,
    childSectionsByTab: ps.childSectionsByTab,

    // Bound actions
    openBook,
    closeBook,
    setActiveTab,
    reorderTabs,
    setTabOrder,
    loadSection,
    navigateToHome,
    clearError,
    navigateToNextSection,
    navigateToPreviousSection,
    navigateToParentSection,
    navigateToSection,
    loadSectionSummaries,
    loadChildSections,
    preloadBackgroundTabs,
    restoreFromSession,
  };
}
