import { create } from 'zustand';
import { SerializedNote } from '../services/notesAPI';
import * as notesAPI from '../services/notesAPI';
import { SerializedPrayerList } from '../services/prayerListsAPI';
import * as prayerListsAPI from '../services/prayerListsAPI';

interface PrayerState {
  // Prayer lists
  prayerLists: SerializedPrayerList[];
  selectedPrayerListId: number | null;

  // Prayers in selected list
  prayers: SerializedNote[];
  currentPrayerNote: SerializedNote | null;

  // UI state
  loading: boolean;
  error: string | null;

  // Prayer list actions
  loadPrayerLists: () => Promise<void>;
  createPrayerList: (listData: Partial<SerializedPrayerList>) => Promise<SerializedPrayerList>;
  updatePrayerList: (list: SerializedPrayerList) => Promise<void>;
  deletePrayerList: (id: number) => Promise<void>;
  selectPrayerList: (id: number | null) => void;
  loadPrayers: () => Promise<void>;
  reorderPrayers: (listId: number, prayerIds: number[]) => Promise<void>;
  reorderPrayerLists: (listIds: number[]) => Promise<void>;

  // Prayer note actions
  setCurrentPrayerNote: (note: SerializedNote | null) => void;
  createPrayer: (noteData: Partial<SerializedNote>) => Promise<SerializedNote>;
  updatePrayer: (note: SerializedNote) => Promise<void>;
  deletePrayer: (noteId: number) => Promise<void>;
  updateCurrentPrayerNoteFields: (fields: Partial<SerializedNote>) => void;
}

export const usePrayerStore = create<PrayerState>((set, get) => ({
  prayerLists: [],
  selectedPrayerListId: null,
  prayers: [],
  currentPrayerNote: null,
  loading: false,
  error: null,

  loadPrayerLists: async () => {
    set({ loading: true, error: null });
    try {
      const lists = await prayerListsAPI.getAllPrayerLists();
      set({ prayerLists: lists, loading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  createPrayerList: async (listData) => {
    set({ loading: true, error: null });
    try {
      const list = await prayerListsAPI.createPrayerList(listData);
      set(state => ({
        prayerLists: [...state.prayerLists, list],
        loading: false
      }));
      return list;
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  updatePrayerList: async (list) => {
    set({ loading: true, error: null });
    try {
      const updated = await prayerListsAPI.updatePrayerList(list);
      set(state => ({
        prayerLists: state.prayerLists.map(l =>
          l.userCommentaryId === updated.userCommentaryId ? updated : l
        ),
        loading: false
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  deletePrayerList: async (id) => {
    set({ loading: true, error: null });
    try {
      await prayerListsAPI.deletePrayerList(id);
      set(state => ({
        prayerLists: state.prayerLists.filter(l => l.userCommentaryId !== id),
        selectedPrayerListId: state.selectedPrayerListId === id ? null : state.selectedPrayerListId,
        loading: false
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  selectPrayerList: (id) => {
    set({
      selectedPrayerListId: id,
      currentPrayerNote: null
    });
    if (id) {
      get().loadPrayers();
    }
  },

  loadPrayers: async () => {
    const { selectedPrayerListId } = get();
    if (!selectedPrayerListId) {
      set({ prayers: [] });
      return;
    }
    set({ loading: true, error: null });
    try {
      const notes = await prayerListsAPI.getPrayersForList(selectedPrayerListId);
      set({ prayers: notes, loading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  reorderPrayers: async (listId, prayerIds) => {
    // Optimistic update
    const { prayers } = get();
    const reorderedPrayers = prayerIds
      .map(id => prayers.find(p => p.noteId === id))
      .filter((p): p is SerializedNote => p !== undefined);
    set({ prayers: reorderedPrayers });

    try {
      await prayerListsAPI.reorderPrayers(listId, prayerIds);
    } catch (error: unknown) {
      // Rollback on error
      await get().loadPrayers();
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  reorderPrayerLists: async (listIds) => {
    // Optimistic update
    const { prayerLists } = get();
    const reorderedLists = listIds
      .map(id => prayerLists.find(l => l.userCommentaryId === id))
      .filter((l): l is SerializedPrayerList => l !== undefined);
    set({ prayerLists: reorderedLists });

    try {
      await prayerListsAPI.reorderPrayerLists(listIds);
    } catch (error: unknown) {
      // Rollback on error
      await get().loadPrayerLists();
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  setCurrentPrayerNote: (note) => {
    set({ currentPrayerNote: note });
  },

  createPrayer: async (noteData) => {
    set({ loading: true, error: null });
    try {
      const note = await notesAPI.createNote(noteData);
      set(state => ({
        prayers: [...state.prayers, note],
        loading: false
      }));
      return note;
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  updatePrayer: async (note) => {
    try {
      const updated = await notesAPI.updateNote(note);
      set(state => ({
        prayers: state.prayers.map(p => p.noteId === updated.noteId ? updated : p),
        currentPrayerNote: state.currentPrayerNote?.noteId === updated.noteId ? updated : state.currentPrayerNote,
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  deletePrayer: async (noteId) => {
    set({ loading: true, error: null });
    try {
      await notesAPI.deleteNote(noteId);
      set(state => ({
        prayers: state.prayers.filter(p => p.noteId !== noteId),
        currentPrayerNote: state.currentPrayerNote?.noteId === noteId ? null : state.currentPrayerNote,
        loading: false
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  updateCurrentPrayerNoteFields: (fields) => {
    set(state => {
      if (!state.currentPrayerNote) return state;
      return {
        currentPrayerNote: { ...state.currentPrayerNote, ...fields }
      };
    });
  }
}));
