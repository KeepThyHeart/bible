import { create } from 'zustand';
import { UserTextMarkup, IUserTextMarkupRepository, HighlightColor, VerseId } from '@bible/core';
import { useToastStore } from './useToastStore';
import {
  clearStoredRecentMarkupStyles,
  loadRecentMarkupStyles,
  persistRecentMarkupStyles,
  withRecentMarkupStyle,
  type MarkupStyle,
} from '../services/recentMarkupStyles';

/**
 * Report a write failure to the user.
 *
 * If every caller of these actions were to `catch` and `console.error`, then
 * clear the selection and dismiss the toolbar exactly as on success, a
 * highlight that failed to save would be indistinguishable from one that
 * saved. Raising the toast here means all entry points (floating toolbar,
 * context menu, keyboard shortcut) surface the failure without each having
 * to remember to.
 */
function reportWriteFailure(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  useToastStore.getState().addToast(`Could not ${action}: ${message}`, 'error');
  return message;
}

interface HighlightState {
  // Highlights indexed by module ID
  highlightsByModule: Map<number, UserTextMarkup[]>;

  // Last-used highlight color (for keyboard shortcut Ctrl+Shift+H)
  lastUsedColor: HighlightColor;

  /**
   * The last few *whole* styles applied, most recent first, surfaced as the
   * floating toolbar's "Recent" row and persisted to localStorage.
   *
   * Distinct from `lastUsedColor`, which the keyboard shortcuts read and which
   * is only ever a colour. A remembered style also carries the markup type and
   * underline style, so a wavy red underline can be offered back as such.
   */
  recentMarkupStyles: MarkupStyle[];

  // Loading state
  loading: boolean;
  error: string | null;

  // Actions
  setLastUsedColor: (color: HighlightColor) => void;
  recordMarkupStyle: (style: MarkupStyle) => void;
  clearRecentMarkupStyles: () => void;
  loadHighlightsForModule: (moduleId: number, repository: IUserTextMarkupRepository) => Promise<void>;
  loadHighlightsForVerseRange: (
    moduleId: number,
    startVerseId: VerseId,
    endVerseId: VerseId,
    repository: IUserTextMarkupRepository
  ) => Promise<void>;

  createHighlight: (
    highlight: Omit<UserTextMarkup, 'markupId'>,
    repository: IUserTextMarkupRepository
  ) => Promise<UserTextMarkup>;

  updateHighlight: (
    highlight: UserTextMarkup,
    repository: IUserTextMarkupRepository
  ) => Promise<void>;

  deleteHighlight: (
    markupId: number,
    moduleId: number,
    repository: IUserTextMarkupRepository
  ) => Promise<void>;

  // Selectors
  getHighlightsForVerse: (verseId: VerseId, moduleId: number) => UserTextMarkup[];
  getHighlightById: (markupId: number, moduleId: number) => UserTextMarkup | undefined;

  // Clear state
  clearModule: (moduleId: number) => void;
  clearAll: () => void;
}

export const useHighlightStore = create<HighlightState>((set, get) => ({
  highlightsByModule: new Map(),
  lastUsedColor: 'yellow',
  // Read once at store creation: the row has to be populated before the first
  // selection, and a re-read per render would be a localStorage hit per keystroke.
  recentMarkupStyles: loadRecentMarkupStyles(),
  loading: false,
  error: null,

  setLastUsedColor: (color) => {
    set({ lastUsedColor: color });
  },

  recordMarkupStyle: (style) => {
    const next = withRecentMarkupStyle(get().recentMarkupStyles, style);
    persistRecentMarkupStyles(next);
    set({ recentMarkupStyles: next });
  },

  clearRecentMarkupStyles: () => {
    clearStoredRecentMarkupStyles();
    set({ recentMarkupStyles: [] });
  },

  loadHighlightsForModule: async (moduleId, repository) => {
    set({ loading: true, error: null });
    try {
      const highlights = await repository.getForModule(moduleId);
      set(state => {
        const newMap = new Map(state.highlightsByModule);
        newMap.set(moduleId, highlights);
        return { highlightsByModule: newMap, loading: false };
      });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  loadHighlightsForVerseRange: async (moduleId, startVerseId, endVerseId, repository) => {
    set({ loading: true, error: null });
    try {
      const highlights = await repository.getForVerseRange(startVerseId, endVerseId, moduleId);

      set(state => {
        const newMap = new Map(state.highlightsByModule);
        const existing = newMap.get(moduleId) || [];

        // Merge: remove highlights in range, add new ones
        const filtered = existing.filter(h => {
          const start = h.verseIdStart;
          const end = h.verseIdEnd || start;
          return end < startVerseId || start > endVerseId;
        });

        newMap.set(moduleId, [...filtered, ...highlights]);
        return { highlightsByModule: newMap, loading: false };
      });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  },

  createHighlight: async (highlight, repository) => {
    set({ loading: true, error: null });
    try {
      const created = await repository.create(new UserTextMarkup(highlight as any));

      set(state => {
        const newMap = new Map(state.highlightsByModule);
        const moduleHighlights = newMap.get(created.moduleId) || [];
        newMap.set(created.moduleId, [...moduleHighlights, created]);
        return { highlightsByModule: newMap, loading: false };
      });

      return created;
    } catch (error) {
      set({ error: reportWriteFailure('save that highlight', error), loading: false });
      throw error;
    }
  },

  updateHighlight: async (highlight, repository) => {
    set({ loading: true, error: null });
    try {
      await repository.update(highlight);

      set(state => {
        const newMap = new Map(state.highlightsByModule);
        const moduleHighlights = newMap.get(highlight.moduleId) || [];
        const updated = moduleHighlights.map(h =>
          h.markupId === highlight.markupId ? highlight : h
        );
        newMap.set(highlight.moduleId, updated);
        return { highlightsByModule: newMap, loading: false };
      });
    } catch (error) {
      set({ error: reportWriteFailure('update that highlight', error), loading: false });
      throw error;
    }
  },

  deleteHighlight: async (markupId, moduleId, repository) => {
    set({ loading: true, error: null });
    try {
      await repository.delete(markupId);

      set(state => {
        const newMap = new Map(state.highlightsByModule);
        const moduleHighlights = newMap.get(moduleId) || [];
        const filtered = moduleHighlights.filter(h => h.markupId !== markupId);
        newMap.set(moduleId, filtered);
        return { highlightsByModule: newMap, loading: false };
      });
    } catch (error) {
      set({ error: reportWriteFailure('remove that highlight', error), loading: false });
      throw error;
    }
  },

  getHighlightsForVerse: (verseId, moduleId) => {
    const highlights = get().highlightsByModule.get(moduleId) || [];
    return highlights.filter(h => h.coversVerse(verseId));
  },

  getHighlightById: (markupId, moduleId) => {
    const highlights = get().highlightsByModule.get(moduleId) || [];
    return highlights.find(h => h.markupId === markupId);
  },

  clearModule: (moduleId) => {
    set(state => {
      const newMap = new Map(state.highlightsByModule);
      newMap.delete(moduleId);
      return { highlightsByModule: newMap };
    });
  },

  clearAll: () => {
    set({ highlightsByModule: new Map(), error: null });
  }
}));

// Cross-store when-context publishing (selectedVerseHasHighlight) lives in
// `storeSync.ts` so this store stays free of imports from other stores.
