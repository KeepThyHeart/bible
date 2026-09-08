import { create } from 'zustand';
import { unwrap } from '../services/ipcResult';

/**
 * Available topical index module metadata
 */
export interface TopicalIndexModule {
  module_id?: number;
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
  database_path: string;
}

interface TopicalIndexStoreState {
  availableModules: TopicalIndexModule[];
  loading: boolean;
  loaded: boolean;
  loadAvailableModules: () => Promise<void>;
}

/**
 * Shared store for topical index module metadata (not per-panel).
 * Caches the list of available topical index modules.
 */
export const useTopicalIndexStore = create<TopicalIndexStoreState>((set, get) => ({
  availableModules: [],
  loading: false,
  loaded: false,

  loadAvailableModules: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });

    try {
      const modules = await unwrap(window.electron.topical.getAvailable());
      set({ availableModules: modules, loaded: true, loading: false });
    } catch (error) {
      console.error('Failed to load topical index modules:', error);
      set({ loading: false });
    }
  },
}));
