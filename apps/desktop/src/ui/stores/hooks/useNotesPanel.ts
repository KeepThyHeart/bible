import { useCallback, useMemo } from 'react';
import { useNotesStore } from '../useNotesStore';
import type { NotesPanelState } from '../useNotesStore';
import { DEFAULT_PANEL_ID } from '../helpers/panelStateHelpers';
import { SerializedNote, VerseId } from '../../services/notesAPI';

/**
 * Hook that returns per-instance notes state + actions bound to a specific panelId.
 *
 * Usage:
 *   const { currentNote, currentVerseNote, setCurrentNote, ... } = useNotesPanel(panelId);
 */
export function useNotesPanel(panelId: string = DEFAULT_PANEL_ID) {
  // Select shared/global state
  const verseNotes = useNotesStore(s => s.verseNotes);
  const documents = useNotesStore(s => s.documents);
  const journals = useNotesStore(s => s.journals);
  const allNotes = useNotesStore(s => s.allNotes);
  const allTags = useNotesStore(s => s.allTags);
  const noteChangeCounter = useNotesStore(s => s.noteChangeCounter);
  const noteSummaries = useNotesStore(s => s.noteSummaries);

  // Select per-instance state (re-renders only when this panel's state changes)
  const panelState = useNotesStore(s => s.panels.get(panelId));

  // Provide defaults for when panel isn't initialized yet
  const ps: NotesPanelState = useMemo(() => panelState ?? {
    currentNote: null,
    currentVerseNote: null,
    currentDocumentNote: null,
    currentJournalNote: null,
    syncWithBible: true,
    browseMode: false,
    loading: false,
    error: null,
    searchQuery: '',
    selectedTags: [],
    verseNoteEditing: false,
  }, [panelState]);

  // Shared actions (no panelId binding needed)
  const loadVerseNotes = useNotesStore(s => s.loadVerseNotes);
  const loadDocuments = useNotesStore(s => s.loadDocuments);
  const loadJournals = useNotesStore(s => s.loadJournals);
  const loadAllNotes = useNotesStore(s => s.loadAllNotes);
  const loadTags = useNotesStore(s => s.loadTags);
  const loadNoteSummaries = useNotesStore(s => s.loadNoteSummaries);
  const createNote = useNotesStore(s => s.createNote);
  const updateNote = useNotesStore(s => s.updateNote);
  const deleteNote = useNotesStore(s => s.deleteNote);
  const searchNotes = useNotesStore(s => s.searchNotes);
  const filterByTags = useNotesStore(s => s.filterByTags);
  const clearFilters = useNotesStore(s => s.clearFilters);

  // Bound per-panel actions
  const setCurrentNote = useCallback(
    (note: SerializedNote | null) => useNotesStore.getState().setCurrentNote(panelId, note),
    [panelId]
  );
  const saveCurrentNote = useCallback(
    () => useNotesStore.getState().saveCurrentNote(panelId),
    [panelId]
  );
  const toggleSync = useCallback(
    () => useNotesStore.getState().toggleSync(panelId),
    [panelId]
  );
  const syncToVerse = useCallback(
    (verseId: VerseId) => useNotesStore.getState().syncToVerse(panelId, verseId),
    [panelId]
  );
  const toggleBrowseMode = useCallback(
    () => useNotesStore.getState().toggleBrowseMode(panelId),
    [panelId]
  );
  const navigateToVerse = useCallback(
    (verseId: VerseId) => useNotesStore.getState().navigateToVerse(panelId, verseId),
    [panelId]
  );
  const navigateToNextVerse = useCallback(
    () => useNotesStore.getState().navigateToNextVerse(panelId),
    [panelId]
  );
  const navigateToPreviousVerse = useCallback(
    () => useNotesStore.getState().navigateToPreviousVerse(panelId),
    [panelId]
  );
  const setVerseNoteEditing = useCallback(
    (editing: boolean) => useNotesStore.getState().setVerseNoteEditing(panelId, editing),
    [panelId]
  );
  const setError = useCallback(
    (error: string | null) => useNotesStore.getState().setError(panelId, error),
    [panelId]
  );
  const restoreFromSession = useCallback(
    (sessionData: { selectedNoteId?: number | null; expandedNodeIds?: number[] }) =>
      useNotesStore.getState().restoreFromSession(panelId, sessionData),
    [panelId]
  );

  return {
    // Shared
    verseNotes,
    documents,
    journals,
    allNotes,
    allTags,
    noteChangeCounter,
    noteSummaries,
    loadVerseNotes,
    loadDocuments,
    loadJournals,
    loadAllNotes,
    loadTags,
    loadNoteSummaries,
    createNote,
    updateNote,
    deleteNote,
    searchNotes,
    filterByTags,
    clearFilters,

    // Per-instance state (flat)
    currentNote: ps.currentNote,
    currentVerseNote: ps.currentVerseNote,
    currentDocumentNote: ps.currentDocumentNote,
    currentJournalNote: ps.currentJournalNote,
    syncWithBible: ps.syncWithBible,
    currentVerseId: ps.currentVerseId,
    browseMode: ps.browseMode,
    loading: ps.loading,
    error: ps.error,
    searchQuery: ps.searchQuery,
    selectedTags: ps.selectedTags,
    verseNoteEditing: ps.verseNoteEditing,

    // Bound actions
    setCurrentNote,
    saveCurrentNote,
    toggleSync,
    syncToVerse,
    toggleBrowseMode,
    navigateToVerse,
    navigateToNextVerse,
    navigateToPreviousVerse,
    setVerseNoteEditing,
    setError,
    restoreFromSession,
  };
}
