import { create } from 'zustand';
import { SerializedNote, VerseId, NoteSummary } from '../services/notesAPI';
import * as notesAPI from '../services/notesAPI';
import { useNoteEditorStore } from './useNoteEditorStore';
import { DEFAULT_PANEL_ID, updatePanelState } from './helpers/panelStateHelpers';
import { createPanelSlice } from './helpers/createPanelSlice';

// Helper to check if HTML content is effectively empty (whitespace-only)
const isContentEmpty = (content: string | undefined | null): boolean => {
  if (!content) return true;
  // Strip HTML tags and check if only whitespace remains
  const textOnly = content.replace(/<[^>]*>/g, '').trim();
  return textOnly.length === 0;
};

import { markSessionDirty } from './helpers/sessionNotifier';
import { registerSessionSerializer } from './helpers/sessionRegistry';

/**
 * Per-panel-instance state for a Notes panel.
 * Each dockview panel gets its own independent copy of this state.
 */
export interface NotesPanelState {
  // Current note being edited
  currentNote: SerializedNote | null;

  // Current notes per tab (for context isolation when switching tabs)
  currentVerseNote: SerializedNote | null;
  currentDocumentNote: SerializedNote | null;
  currentJournalNote: SerializedNote | null;

  // Sync with Bible pane
  syncWithBible: boolean;
  currentVerseId?: VerseId;

  // Navigation
  browseMode: boolean;

  // UI state
  loading: boolean;
  error: string | null;

  // Filters
  searchQuery: string;
  selectedTags: string[];

  // Editing state (for verse notes - prevents sync from replacing note being edited)
  verseNoteEditing: boolean;
}

function createDefaultNotesPanelState(): NotesPanelState {
  return {
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
  };
}

interface NotesState {
  // === SHARED (global across all panels) ===
  verseNotes: SerializedNote[];
  documents: SerializedNote[];
  journals: SerializedNote[];
  allNotes: SerializedNote[];
  allTags: string[];
  noteChangeCounter: number;
  noteSummaries: NoteSummary[];

  // === PER-INSTANCE state keyed by panelId ===
  panels: Map<string, NotesPanelState>;

  // === PANEL LIFECYCLE ===
  initPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => NotesPanelState;

  // === SHARED ACTIONS (no panelId) ===
  loadVerseNotes: () => Promise<void>;
  loadDocuments: () => Promise<void>;
  loadJournals: () => Promise<void>;
  loadAllNotes: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadNoteSummaries: () => Promise<void>;
  createNote: (noteData: Partial<SerializedNote>) => Promise<SerializedNote>;
  updateNote: (note: SerializedNote) => Promise<void>;
  deleteNote: (noteId: number, options?: { skipConfirm?: boolean }) => Promise<void>;
  searchNotes: (query: string) => Promise<void>;
  filterByTags: (tags: string[]) => void;
  clearFilters: () => void;

  /** Sync ALL notes panels with a verse change (called by BiblePane) */
  syncAllPanelsWithVerse: (verseId: VerseId) => void;

  // === PER-PANEL ACTIONS (panelId first param) ===
  setCurrentNote: (panelId: string, note: SerializedNote | null) => void;
  saveCurrentNote: (panelId: string) => Promise<void>;
  toggleSync: (panelId: string) => void;
  syncToVerse: (panelId: string, verseId: VerseId) => Promise<void>;
  toggleBrowseMode: (panelId: string) => void;
  navigateToVerse: (panelId: string, verseId: VerseId) => Promise<void>;
  navigateToNextVerse: (panelId: string) => Promise<void>;
  navigateToPreviousVerse: (panelId: string) => Promise<void>;
  setVerseNoteEditing: (panelId: string, editing: boolean) => void;
  setError: (panelId: string, error: string | null) => void;

  // === SESSION MANAGEMENT ===
  restoreFromSession: (panelId: string, sessionData: {
    selectedNoteId?: number | null;
    expandedNodeIds?: number[];
  }) => Promise<void>;
}

const notesPanelSlice = createPanelSlice(createDefaultNotesPanelState);

export const useNotesStore = create<NotesState>((set, get) => ({
  // === SHARED initial state ===
  verseNotes: [],
  documents: [],
  journals: [],
  allNotes: [],
  allTags: [],
  noteChangeCounter: 0,
  noteSummaries: [],

  // === PER-INSTANCE initial state ===
  panels: new Map(),

  // === PANEL LIFECYCLE ===
  ...notesPanelSlice(set as any, get as any),

  // === SHARED ACTIONS ===
  loadVerseNotes: async () => {
    try {
      const notes = await notesAPI.getVerseNotes();
      set({ verseNotes: notes });
    } catch (error: unknown) {
      console.error('Failed to load verse notes:', error);
    }
  },

  loadDocuments: async () => {
    try {
      const notes = await notesAPI.getDocuments();
      set({ documents: notes });
    } catch (error: unknown) {
      console.error('Failed to load documents:', error);
    }
  },

  loadJournals: async () => {
    try {
      const notes = await notesAPI.getJournals();
      set({ journals: notes });
    } catch (error: unknown) {
      console.error('Failed to load journals:', error);
    }
  },

  loadAllNotes: async () => {
    try {
      const notes = await notesAPI.getAllNotes();
      set({ allNotes: notes });
    } catch (error: unknown) {
      console.error('Failed to load all notes:', error);
    }
  },

  loadTags: async () => {
    try {
      const tags = await notesAPI.getAllTags();
      set({ allTags: tags });
    } catch (error: unknown) {
      console.error('Failed to load tags:', error);
    }
  },

  loadNoteSummaries: async () => {
    try {
      const summaries = await notesAPI.getAllNoteSummaries();
      set({ noteSummaries: summaries });
    } catch (error: unknown) {
      console.error('Failed to load note summaries:', error);
    }
  },

  createNote: async (noteData) => {
    try {
      const note = await notesAPI.createNote(noteData);

      // Add to appropriate list
      const { noteType } = note;
      if (noteType === 'verse_note') {
        set(state => ({ verseNotes: [...state.verseNotes, note] }));
      } else if (noteType === 'document') {
        set(state => ({ documents: [...state.documents, note] }));
      } else if (noteType === 'journal') {
        set(state => ({ journals: [...state.journals, note] }));
      }

      set(state => ({ noteChangeCounter: state.noteChangeCounter + 1 }));
      return note;
    } catch (error: unknown) {
      throw error;
    }
  },

  updateNote: async (note) => {
    try {
      const updated = await notesAPI.updateNote(note);

      // Update in appropriate list
      const updateList = (notes: SerializedNote[]) =>
        notes.map(n => n.noteId === updated.noteId ? updated : n);

      set(state => ({
        verseNotes: updateList(state.verseNotes),
        documents: updateList(state.documents),
        journals: updateList(state.journals),
        allNotes: updateList(state.allNotes),
      }));

      // Also update per-panel state if any panel has this note as current
      const { panels } = get();
      let panelsUpdated = false;
      let newPanels = panels;
      for (const [panelId, ps] of panels) {
        const panelUpdates: Partial<NotesPanelState> = {};
        if (ps.currentNote?.noteId === updated.noteId) {
          panelUpdates.currentNote = updated;
        }
        if (ps.currentVerseNote?.noteId === updated.noteId) {
          panelUpdates.currentVerseNote = updated;
        }
        if (ps.currentDocumentNote?.noteId === updated.noteId) {
          panelUpdates.currentDocumentNote = updated;
        }
        if (ps.currentJournalNote?.noteId === updated.noteId) {
          panelUpdates.currentJournalNote = updated;
        }
        if (Object.keys(panelUpdates).length > 0) {
          newPanels = updatePanelState(newPanels, panelId, panelUpdates, createDefaultNotesPanelState);
          panelsUpdated = true;
        }
      }
      if (panelsUpdated) {
        set({ panels: newPanels });
      }
    } catch (error: unknown) {
      throw error;
    }
  },

  deleteNote: async (noteId, options) => {
    // A6: deleting a note cascades to its whole subtree (parent_note_id ON
    // DELETE CASCADE). Warn before silently removing child notes. The count
    // is 0 for leaf notes (verse notes, prayers), so this is a no-op for them.
    if (!options?.skipConfirm) {
      try {
        const descendants = await notesAPI.countDescendants(noteId);
        if (descendants > 0) {
          const plural = descendants === 1 ? 'sub-note' : 'sub-notes';
          const confirmed = window.confirm(
            `This will also delete ${descendants} ${plural}. Continue?`
          );
          if (!confirmed) return;
        }
      } catch (err) {
        // If the count check fails, don't block the delete - just proceed
        // without the extra confirmation.
        console.error('Failed to count sub-notes before delete:', err);
      }
    }

    try {
      await notesAPI.deleteNote(noteId);

      // Remove from all lists
      const filterNotes = (notes: SerializedNote[]) =>
        notes.filter(n => n.noteId !== noteId);

      set(state => ({
        verseNotes: filterNotes(state.verseNotes),
        documents: filterNotes(state.documents),
        journals: filterNotes(state.journals),
        allNotes: filterNotes(state.allNotes),
        noteChangeCounter: state.noteChangeCounter + 1,
      }));

      // Clear from any panel that has this note as current
      const { panels } = get();
      let newPanels = panels;
      let panelsUpdated = false;
      for (const [panelId, ps] of panels) {
        if (ps.currentNote?.noteId === noteId) {
          newPanels = updatePanelState(newPanels, panelId, { currentNote: null }, createDefaultNotesPanelState);
          panelsUpdated = true;
        }
      }
      if (panelsUpdated) {
        set({ panels: newPanels });
      }
    } catch (error: unknown) {
      throw error;
    }
  },

  searchNotes: async (query) => {
    try {
      const notes = query.trim() ? await notesAPI.searchNotes(query) : await notesAPI.getAllNotes();
      set({ allNotes: notes });
    } catch (error: unknown) {
      console.error('Failed to search notes:', error);
    }
  },

  filterByTags: (_tags) => {
    // filterByTags is conceptually shared since it affects allNotes display
    // Individual panels track selectedTags for their own filter state
    // For now this is a no-op at the shared level
  },

  clearFilters: () => {
    get().loadAllNotes();
  },

  syncAllPanelsWithVerse: (verseId: VerseId) => {
    const { panels } = get();
    for (const panelId of panels.keys()) {
      get().syncToVerse(panelId, verseId);
    }
  },

  // === PER-PANEL ACTIONS ===

  setCurrentNote: (panelId: string, note) => {
    const editorStore = useNoteEditorStore.getState();
    editorStore.stopAutoSave();

    // Determine which tab-specific note to update based on note type
    const panelUpdates: Partial<NotesPanelState> = {
      currentNote: note,
    };

    if (note) {
      switch (note.noteType) {
        case 'verse_note':
          panelUpdates.currentVerseNote = note;
          break;
        case 'document':
          panelUpdates.currentDocumentNote = note;
          break;
        case 'journal':
          panelUpdates.currentJournalNote = note;
          break;
      }
    } else {
      // When note is null, clear the verse note directly. Branching on
      // `selectedTab` would only ever take the 'verse-notes' arm: the
      // Documents and Journal tabs it could otherwise name are not part of
      // v1.
      panelUpdates.currentVerseNote = null;
    }

    set({ panels: updatePanelState(get().panels, panelId, panelUpdates, createDefaultNotesPanelState) });
    markSessionDirty();

    // Reset editor content and start auto-save for new note
    editorStore.resetContent(note?.content || '');
    if (note) {
      editorStore.startAutoSave(() => get().saveCurrentNote(panelId));
    }
  },

  saveCurrentNote: async (panelId: string) => {
    const ps = get().getPanelState(panelId);
    const editorStore = useNoteEditorStore.getState();
    if (!ps.currentNote || !editorStore.isDirty) return;

    try {
      // If content is whitespace-only, skip saving
      if (isContentEmpty(editorStore.content)) {
        editorStore.markSaved();
        return;
      }

      const noteToSave: SerializedNote = {
        ...ps.currentNote,
        content: editorStore.content
      };
      const updated = await notesAPI.updateNote(noteToSave);
      if (updated) {
        const panelUpdates: Partial<NotesPanelState> = {
          currentNote: updated,
        };

        switch (updated.noteType) {
          case 'verse_note':
            panelUpdates.currentVerseNote = updated;
            break;
          case 'document':
            panelUpdates.currentDocumentNote = updated;
            break;
          case 'journal':
            panelUpdates.currentJournalNote = updated;
            break;
        }

        set(state => ({
          panels: updatePanelState(state.panels, panelId, panelUpdates, createDefaultNotesPanelState),
          noteChangeCounter: state.noteChangeCounter + 1
        }));
        editorStore.markSaved();
      }
    } catch (error: unknown) {
      set({ panels: updatePanelState(get().panels, panelId, { error: error instanceof Error ? error.message : String(error) }, createDefaultNotesPanelState) });
      throw error;
    }
  },

  toggleSync: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    set({ panels: updatePanelState(get().panels, panelId, { syncWithBible: !ps.syncWithBible }, createDefaultNotesPanelState) });
  },

  syncToVerse: async (panelId: string, verseId) => {
    // Only update the tracked verse ID so that the Notes pane knows which
    // verse is currently selected (used by "Open Verse Note").
    // Do NOT call setCurrentNote here - the file-based Notes pane manages
    // its own editor state and calling setCurrentNote would reset the
    // shared useNoteEditorStore, wiping whatever the user is editing.
    set({ panels: updatePanelState(get().panels, panelId, { currentVerseId: verseId }, createDefaultNotesPanelState) });
  },

  toggleBrowseMode: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    set({ panels: updatePanelState(get().panels, panelId, { browseMode: !ps.browseMode }, createDefaultNotesPanelState) });

    // Load summaries when entering browse mode
    if (!ps.browseMode) {
      get().loadNoteSummaries();
    }
  },

  navigateToVerse: async (panelId: string, verseId) => {
    set({ panels: updatePanelState(get().panels, panelId, { currentVerseId: verseId }, createDefaultNotesPanelState) });
    try {
      const notes = await notesAPI.getNotesForVerse(verseId);
      if (notes.length > 0) {
        get().setCurrentNote(panelId, notes[0]);
      } else {
        get().setCurrentNote(panelId, null);
      }
    } catch (error: unknown) {
      console.error('Failed to navigate to verse:', error);
      set({ panels: updatePanelState(get().panels, panelId, { error: error instanceof Error ? error.message : String(error) }, createDefaultNotesPanelState) });
    }
  },

  navigateToNextVerse: async (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (!ps.currentVerseId) return;

    try {
      const nextVerseId = await notesAPI.getNextVerseWithContent(ps.currentVerseId);
      if (nextVerseId) {
        await get().navigateToVerse(panelId, nextVerseId);
      }
    } catch (error: unknown) {
      console.error('Failed to navigate to next verse:', error);
      set({ panels: updatePanelState(get().panels, panelId, { error: error instanceof Error ? error.message : String(error) }, createDefaultNotesPanelState) });
    }
  },

  navigateToPreviousVerse: async (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (!ps.currentVerseId) return;

    try {
      const prevVerseId = await notesAPI.getPreviousVerseWithContent(ps.currentVerseId);
      if (prevVerseId) {
        await get().navigateToVerse(panelId, prevVerseId);
      }
    } catch (error: unknown) {
      console.error('Failed to navigate to previous verse:', error);
      set({ panels: updatePanelState(get().panels, panelId, { error: error instanceof Error ? error.message : String(error) }, createDefaultNotesPanelState) });
    }
  },

  setVerseNoteEditing: (panelId: string, editing) => {
    set({ panels: updatePanelState(get().panels, panelId, { verseNoteEditing: editing }, createDefaultNotesPanelState) });
  },

  setError: (panelId: string, error) => {
    set({ panels: updatePanelState(get().panels, panelId, { error }, createDefaultNotesPanelState) });
  },

  // === SESSION MANAGEMENT ===

  restoreFromSession: async (panelId: string, sessionData: {
    selectedNoteId?: number | null;
    expandedNodeIds?: number[];
  }) => {
    // Restore selected note if provided
    if (sessionData.selectedNoteId) {
      try {
        // Load the note by ID
        const note = await notesAPI.getNoteById(sessionData.selectedNoteId);
        if (note) {
          get().setCurrentNote(panelId, note);
        }
      } catch (error) {
        console.error('Failed to restore selected note:', error);
      }
    }

  }
}));

// Cross-store when-context publishing (selectedVerseHasNote) lives in
// `storeSync.ts` so this store stays free of imports from the Bible store.

// Register session serializer so useSessionStore doesn't import us directly
registerSessionSerializer('notes', () => {
  const notesState = useNotesStore.getState();
  const firstPanel = notesState.panels.values().next().value;
  return {
    selectedNoteId: firstPanel?.currentNote?.noteId ?? null,
    expandedNodeIds: []
  };
});

export { DEFAULT_PANEL_ID };
