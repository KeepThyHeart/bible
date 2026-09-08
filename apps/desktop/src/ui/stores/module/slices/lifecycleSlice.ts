import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, ModuleViewMode } from '../types';

export interface LifecycleSlice {
  // Initialization
  isInitialized: boolean;
  initError: string | null;

  // View state
  viewMode: ModuleViewMode;

  // Errors
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  setViewMode: (mode: ModuleViewMode) => void;
  clearError: () => void;
}

export const createLifecycleSlice: StateCreator<ModuleState, [], [], LifecycleSlice> = (set, get) => ({
  isInitialized: false,
  initError: null,
  viewMode: 'available',
  error: null,

  // Initialize module manager
  initialize: async () => {
    try {
      await moduleAPI.init();
      set({ isInitialized: true, initError: null });
      // Load initial data
      await Promise.all([
        get().loadAvailableModules(),
        get().loadInstalledModules(),
        get().loadRepositories()
      ]);
    } catch (error) {
      console.error('[ModuleStore] Initialization error:', error);
      set({
        isInitialized: false,
        initError: error instanceof Error ? error.message : 'Initialization failed'
      });
    }
  },

  // Set view mode
  setViewMode: (mode: ModuleViewMode) => {
    set({ viewMode: mode });
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },
});
