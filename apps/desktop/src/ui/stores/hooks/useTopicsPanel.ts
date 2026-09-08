import { useCallback, useMemo } from 'react';
import { useTopicsStore, TopicsPanelState } from '../useTopicsStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';

const defaultPanelState: TopicsPanelState = {
  currentView: 'browse',
  currentTopicId: null,
  currentTopicAbbreviation: null,
  currentVerseId: null,
  currentEntityId: null,
  currentEntityCategory: null,
  pinned: false,
  suggestionVerseId: null,
  liveVerseId: null,
  navStack: [{ type: 'browse' }],
  navIndex: 0,
  sourceFilters: [],
  browseOffset: 0,
  browseFilter: '',
};

/**
 * Hook that binds a panelId to the Topics Store, providing
 * per-instance state and bound actions for a specific Topics Pane.
 */
export function useTopicsPanel(panelId: string = DEFAULT_PANEL_ID) {
  const panelState = useTopicsStore(s => s.panels.get(panelId));
  const ps: TopicsPanelState = useMemo(() => panelState ?? defaultPanelState, [panelState]);

  const canGoBack = ps.navIndex > 0;
  const canGoForward = ps.navIndex < ps.navStack.length - 1;

  // Bound actions
  const navigateToTopic = useCallback(
    (topicId: number, abbreviation: string) =>
      useTopicsStore.getState().navigateToTopic(panelId, topicId, abbreviation),
    [panelId]
  );
  const navigateToEntity = useCallback(
    (entityId: string, entityCategory: string) =>
      useTopicsStore.getState().navigateToEntity(panelId, entityId, entityCategory),
    [panelId]
  );
  const navigateToBrowse = useCallback(
    () => useTopicsStore.getState().navigateToBrowse(panelId),
    [panelId]
  );
  const navigateToVerseTopics = useCallback(
    (verseId: number) => useTopicsStore.getState().navigateToVerseTopics(panelId, verseId),
    [panelId]
  );
  const setSourceFilter = useCallback(
    (sources: string[]) => useTopicsStore.getState().setSourceFilter(panelId, sources),
    [panelId]
  );
  const setBrowseFilter = useCallback(
    (filter: string) => useTopicsStore.getState().setBrowseFilter(panelId, filter),
    [panelId]
  );
  const setBrowseOffset = useCallback(
    (offset: number) => useTopicsStore.getState().setBrowseOffset(panelId, offset),
    [panelId]
  );
  const goBack = useCallback(
    () => useTopicsStore.getState().goBack(panelId),
    [panelId]
  );
  const goForward = useCallback(
    () => useTopicsStore.getState().goForward(panelId),
    [panelId]
  );
  const togglePin = useCallback(
    () => useTopicsStore.getState().togglePin(panelId),
    [panelId]
  );
  const dismissSuggestion = useCallback(
    () => useTopicsStore.getState().dismissSuggestion(panelId),
    [panelId]
  );
  const acceptSuggestion = useCallback(
    () => useTopicsStore.getState().acceptSuggestion(panelId),
    [panelId]
  );
  const goHome = useCallback(
    () => useTopicsStore.getState().goHome(panelId),
    [panelId]
  );

  return {
    // Per-instance state
    currentView: ps.currentView,
    currentTopicId: ps.currentTopicId,
    currentTopicAbbreviation: ps.currentTopicAbbreviation,
    currentVerseId: ps.currentVerseId,
    currentEntityId: ps.currentEntityId,
    currentEntityCategory: ps.currentEntityCategory,
    pinned: ps.pinned,
    suggestionVerseId: ps.suggestionVerseId,
    liveVerseId: ps.liveVerseId,
    navStack: ps.navStack,
    navIndex: ps.navIndex,
    sourceFilters: ps.sourceFilters,
    browseOffset: ps.browseOffset,
    browseFilter: ps.browseFilter,

    // Derived
    canGoBack,
    canGoForward,

    // Bound actions
    navigateToTopic,
    navigateToEntity,
    navigateToBrowse,
    navigateToVerseTopics,
    setSourceFilter,
    setBrowseFilter,
    setBrowseOffset,
    goBack,
    goForward,
    togglePin,
    dismissSuggestion,
    acceptSuggestion,
    goHome,
  };
}
