import type { StateCreator } from 'zustand';
import { commentaryAPI } from '../../../services/electronAPI';
import {
  STORAGE_KEY_COMMENTARY_MUTED,
  STORAGE_KEY_COMMENTARY_PROMOTED,
  readLocalStorageArray,
} from '../../../constants';
import { CommentaryState, CommentaryModule } from '../types';

export interface SharedSlice {
  availableCommentaries: CommentaryModule[];
  loadingCommentaries: boolean;
  mutedModules: Set<string>;
  promotedModules: Set<string>;

  loadAvailableCommentaries: () => Promise<void>;
  toggleMuted: (abbreviation: string) => void;
  togglePromoted: (abbreviation: string) => void;

  /** Sync ALL commentary panels with a verse change (called by BiblePane) */
  syncAllPanelsWithVerse: (verseId: number) => void;
}

export const createSharedSlice: StateCreator<CommentaryState, [], [], SharedSlice> = (set, get) => ({
  availableCommentaries: [],
  loadingCommentaries: false,
  mutedModules: new Set<string>(readLocalStorageArray<string>(STORAGE_KEY_COMMENTARY_MUTED)),
  promotedModules: new Set<string>(readLocalStorageArray<string>(STORAGE_KEY_COMMENTARY_PROMOTED)),

  loadAvailableCommentaries: async () => {
    set({ loadingCommentaries: true });
    try {
      const commentaries = await commentaryAPI.getAvailableCommentaries();
      set({ availableCommentaries: commentaries, loadingCommentaries: false });
    } catch (error) {
      console.error('Error loading available commentaries:', error);
      set({ loadingCommentaries: false });
    }
  },

  toggleMuted: (abbreviation: string) => {
    const { mutedModules, promotedModules } = get();
    const next = new Set(mutedModules);
    const nextPromoted = new Set(promotedModules);
    if (next.has(abbreviation)) {
      next.delete(abbreviation);
    } else {
      next.add(abbreviation);
      nextPromoted.delete(abbreviation);
    }
    set({ mutedModules: next, promotedModules: nextPromoted });
    try {
      localStorage.setItem(STORAGE_KEY_COMMENTARY_MUTED, JSON.stringify([...next]));
      localStorage.setItem(STORAGE_KEY_COMMENTARY_PROMOTED, JSON.stringify([...nextPromoted]));
    } catch { /* ignore */ }
  },

  togglePromoted: (abbreviation: string) => {
    const { promotedModules, mutedModules } = get();
    const next = new Set(promotedModules);
    const nextMuted = new Set(mutedModules);
    if (next.has(abbreviation)) {
      next.delete(abbreviation);
    } else {
      next.add(abbreviation);
      nextMuted.delete(abbreviation);
    }
    set({ promotedModules: next, mutedModules: nextMuted });
    try {
      localStorage.setItem(STORAGE_KEY_COMMENTARY_PROMOTED, JSON.stringify([...next]));
      localStorage.setItem(STORAGE_KEY_COMMENTARY_MUTED, JSON.stringify([...nextMuted]));
    } catch { /* ignore */ }
  },

  syncAllPanelsWithVerse: (verseId: number) => {
    const { panels } = get();
    for (const panelId of panels.keys()) {
      get().syncWithBibleVerse(panelId, verseId);
    }
  },
});
