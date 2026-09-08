import { create } from 'zustand';
import { whenContextService } from '../services/WhenContextService';

export interface FindMatch {
  verseId: number;
  wordIndex: number;
}

interface FindState {
  // State
  isVisible: boolean;
  query: string;
  matches: FindMatch[];
  currentMatchIndex: number;
  isCaseSensitive: boolean;

  // Actions
  setVisible: (visible: boolean) => void;
  setQuery: (query: string) => void;
  setMatches: (matches: FindMatch[]) => void;
  nextMatch: () => void;
  previousMatch: () => void;
  clear: () => void;
  toggleCaseSensitive: () => void;
}

export const useFindStore = create<FindState>((set, get) => ({
  // Initial state
  isVisible: false,
  query: '',
  matches: [],
  currentMatchIndex: 0,
  isCaseSensitive: false,

  // Actions
  setVisible: (visible: boolean) => {
    set({ isVisible: visible });
    if (!visible) {
      // Clear matches when hiding (but keep query for re-opening)
      set({ matches: [], currentMatchIndex: 0 });
    }
  },

  setQuery: (query: string) => {
    set({ query, currentMatchIndex: 0 });
  },

  setMatches: (matches: FindMatch[]) => {
    const { currentMatchIndex } = get();
    // Keep current index if still valid, otherwise reset to 0
    const newIndex = currentMatchIndex < matches.length ? currentMatchIndex : 0;
    set({ matches, currentMatchIndex: newIndex });
  },

  nextMatch: () => {
    const { matches, currentMatchIndex } = get();
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    set({ currentMatchIndex: nextIndex });
  },

  previousMatch: () => {
    const { matches, currentMatchIndex } = get();
    if (matches.length === 0) return;
    const prevIndex = currentMatchIndex === 0 ? matches.length - 1 : currentMatchIndex - 1;
    set({ currentMatchIndex: prevIndex });
  },

  clear: () => {
    set({
      isVisible: false,
      query: '',
      matches: [],
      currentMatchIndex: 0
    });
  },

  toggleCaseSensitive: () => {
    const { isCaseSensitive } = get();
    set({ isCaseSensitive: !isCaseSensitive, currentMatchIndex: 0 });
  }
}));

// Publish findBarOpen into WhenContextService whenever visibility changes.
function publishFindWhenContext(state: { isVisible: boolean }): void {
  whenContextService.set('findBarOpen', state.isVisible === true);
}

publishFindWhenContext(useFindStore.getState());
useFindStore.subscribe(publishFindWhenContext);
