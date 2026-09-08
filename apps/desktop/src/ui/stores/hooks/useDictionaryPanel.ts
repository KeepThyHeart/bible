import { useCallback, useMemo } from 'react';
import { useDictionaryStore, createDefaultDictionaryPanelState } from '../useDictionaryStore';
import type { DictionaryPanelState } from '../useDictionaryStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';

/**
 * Hook that returns per-instance dictionary state + actions bound to a specific panelId.
 *
 * Usage:
 *   const { openTabs, activeTabIndex, openDictionary, ... } = useDictionaryPanel(panelId);
 */
export function useDictionaryPanel(panelId: string = DEFAULT_PANEL_ID) {
  // Select shared/global state
  const availableDictionaries = useDictionaryStore(s => s.availableDictionaries);
  const loadingDictionaries = useDictionaryStore(s => s.loadingDictionaries);
  const studyPaneActiveTab = useDictionaryStore(s => s.studyPaneActiveTab);
  const recentLookups = useDictionaryStore(s => s.recentLookups);

  // Select per-instance state (re-renders only when this panel's state changes)
  const panelState = useDictionaryStore(s => s.panels.get(panelId));

  // Provide defaults for when panel isn't initialized yet.
  //
  // Through the exported factory, not a literal copied from it: an inlined
  // default silently drifts as fields are added to `DictionaryPanelState`, and
  // a missing Map here reaches the pane as `undefined` rather than as empty.
  // `useBookPanel` has always called its factory; this one had not.
  const ps: DictionaryPanelState = useMemo(
    () => panelState ?? createDefaultDictionaryPanelState(),
    [panelState],
  );

  // Shared actions (no panelId binding needed)
  const loadAvailableDictionaries = useDictionaryStore(s => s.loadAvailableDictionaries);
  const setStudyPaneActiveTab = useDictionaryStore(s => s.setStudyPaneActiveTab);
  const addToHistory = useDictionaryStore(s => s.addToHistory);
  const clearHistory = useDictionaryStore(s => s.clearHistory);
  const lookupStrongsNumber = useDictionaryStore(s => s.lookupStrongsNumber);

  // Bound per-panel actions
  const openDictionary = useCallback(
    (abbreviation: string, name: string) => useDictionaryStore.getState().openDictionary(panelId, abbreviation, name),
    [panelId]
  );
  const closeDictionary = useCallback(
    (abbreviation: string) => useDictionaryStore.getState().closeDictionary(panelId, abbreviation),
    [panelId]
  );
  const setActiveTab = useCallback(
    (index: number) => useDictionaryStore.getState().setActiveTab(panelId, index),
    [panelId]
  );
  const reorderTabs = useCallback(
    (sourceIndex: number, destinationIndex: number) => useDictionaryStore.getState().reorderTabs(panelId, sourceIndex, destinationIndex),
    [panelId]
  );
  const lookupEntry = useCallback(
    (abbreviation: string, entryKey: string) => useDictionaryStore.getState().lookupEntry(panelId, abbreviation, entryKey),
    [panelId]
  );
  const lookupEntryById = useCallback(
    (abbreviation: string, entryId: number) => useDictionaryStore.getState().lookupEntryById(panelId, abbreviation, entryId),
    [panelId]
  );
  const searchDictionary = useCallback(
    (abbreviation: string, query: string, limit?: number) => useDictionaryStore.getState().searchDictionary(panelId, abbreviation, query, limit),
    [panelId]
  );
  const loadAllEntries = useCallback(
    (abbreviation: string, limit?: number, offset?: number, append?: boolean) => useDictionaryStore.getState().loadAllEntries(panelId, abbreviation, limit, offset, append),
    [panelId]
  );
  const toggleBrowseMode = useCallback(
    (abbreviation: string) => useDictionaryStore.getState().toggleBrowseMode(panelId, abbreviation),
    [panelId]
  );
  const clearError = useCallback(
    (abbreviation: string) => useDictionaryStore.getState().clearError(panelId, abbreviation),
    [panelId]
  );
  const goBack = useCallback(
    () => useDictionaryStore.getState().goBack(panelId),
    [panelId]
  );
  const goForward = useCallback(
    () => useDictionaryStore.getState().goForward(panelId),
    [panelId]
  );

  return {
    // Shared
    availableDictionaries,
    loadingDictionaries,
    studyPaneActiveTab,
    recentLookups,
    loadAvailableDictionaries,
    setStudyPaneActiveTab,
    addToHistory,
    clearHistory,
    lookupStrongsNumber,

    // Per-instance state
    openTabs: ps.openTabs,
    activeTabIndex: ps.activeTabIndex,
    entriesByTab: ps.entriesByTab,
    loadingByTab: ps.loadingByTab,
    errorByTab: ps.errorByTab,
    browseModeByTab: ps.browseModeByTab,
    allEntriesByTab: ps.allEntriesByTab,
    loadingAllEntriesByTab: ps.loadingAllEntriesByTab,
    allEntriesCompleteByTab: ps.allEntriesCompleteByTab,
    searchResultsByTab: ps.searchResultsByTab,
    searchingByTab: ps.searchingByTab,
    navHistory: ps.navHistory,
    navIndex: ps.navIndex,

    // Bound actions
    openDictionary,
    closeDictionary,
    setActiveTab,
    reorderTabs,
    lookupEntry,
    lookupEntryById,
    searchDictionary,
    loadAllEntries,
    toggleBrowseMode,
    clearError,
    goBack,
    goForward,
  };
}
