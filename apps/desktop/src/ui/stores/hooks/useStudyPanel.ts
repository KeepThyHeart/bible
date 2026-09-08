import { useCallback, useMemo } from 'react';
import { useStudyStore, StudyPanelState } from '../useStudyStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';

const defaultPanelState: StudyPanelState = {
  currentVerseId: null,
  pinned: false,
  suggestionVerseId: null,
  navStack: [],
  navIndex: -1,
  sectionsCollapsed: {},
};

/**
 * Hook that binds a panelId to the Study Store, providing
 * per-instance state and bound actions for a specific Study Pane.
 */
export function useStudyPanel(panelId: string = DEFAULT_PANEL_ID) {
  const panelState = useStudyStore(s => s.panels.get(panelId));
  const ps: StudyPanelState = useMemo(() => panelState ?? defaultPanelState, [panelState]);

  // Get current nav entry
  const currentNavEntry = useMemo(() => {
    if (ps.navIndex >= 0 && ps.navIndex < ps.navStack.length) {
      return ps.navStack[ps.navIndex];
    }
    return null;
  }, [ps.navStack, ps.navIndex]);

  const canGoBack = ps.navIndex > 0;
  const canGoForward = ps.navIndex < ps.navStack.length - 1;

  // Bound actions
  const navigateToVerse = useCallback(
    (verseId: number) => useStudyStore.getState().navigateToVerse(panelId, verseId),
    [panelId]
  );
  const clearVerse = useCallback(
    () => useStudyStore.getState().clearVerse(panelId),
    [panelId]
  );
  const seedInitialVerse = useCallback(
    (fallbackVerseId: number | null) =>
      useStudyStore.getState().seedInitialVerse(panelId, fallbackVerseId),
    [panelId]
  );
  const dismissSuggestion = useCallback(
    () => useStudyStore.getState().dismissSuggestion(panelId),
    [panelId]
  );
  const acceptSuggestion = useCallback(
    () => useStudyStore.getState().acceptSuggestion(panelId),
    [panelId]
  );
  const goBack = useCallback(
    () => useStudyStore.getState().goBack(panelId),
    [panelId]
  );
  const goForward = useCallback(
    () => useStudyStore.getState().goForward(panelId),
    [panelId]
  );
  const togglePin = useCallback(
    () => useStudyStore.getState().togglePin(panelId),
    [panelId]
  );
  const openCommentaryDetail = useCallback(
    (verseId: number, abbreviation: string, entryId: number) =>
      useStudyStore.getState().openCommentaryDetail(panelId, verseId, abbreviation, entryId),
    [panelId]
  );
  const toggleSection = useCallback(
    (sectionKey: string) => useStudyStore.getState().toggleSection(panelId, sectionKey),
    [panelId]
  );

  return {
    // Per-instance state
    currentVerseId: ps.currentVerseId,
    pinned: ps.pinned,
    suggestionVerseId: ps.suggestionVerseId,
    navStack: ps.navStack,
    navIndex: ps.navIndex,
    sectionsCollapsed: ps.sectionsCollapsed,

    // Derived
    currentNavEntry,
    canGoBack,
    canGoForward,

    // Bound actions
    navigateToVerse,
    clearVerse,
    seedInitialVerse,
    dismissSuggestion,
    acceptSuggestion,
    goBack,
    goForward,
    togglePin,
    openCommentaryDetail,
    toggleSection,
  };
}
