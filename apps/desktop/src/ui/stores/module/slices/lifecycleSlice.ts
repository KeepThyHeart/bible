import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import type { IpcErrorCode } from '../../../services/ipcResult';
import { ModuleState, ModuleManagerTab, ModuleInstallFilter } from '../types';

export interface LifecycleSlice {
  // Initialization
  isInitialized: boolean;
  initError: string | null;

  // View state
  /**
   * Active Module Manager tab: a module type (`openModuleManager('bible')`
   * maps straight onto it) or one of the `features` / `repositories` panels.
   */
  activeTypeTab: ModuleManagerTab;
  /** All / Installed / Updates filter applied inside a module-type tab. */
  installFilter: ModuleInstallFilter;

  // Errors
  error: string | null;
  /**
   * Classification of `error`, when it came from an IPC `Result<T>` envelope
   * (`IpcResultError#code`) - `null` for errors with no such classification.
   * Lets the UI tell an expected condition like `network_blocked` apart from
   * a genuine failure without parsing the message string. Only
   * `repositorySlice`'s catalog-refresh actions set this today; every other
   * action clears it alongside `error` so a stale code can never outlive the
   * error it described.
   */
  errorCode: IpcErrorCode | null;

  // Actions
  initialize: () => Promise<void>;
  setActiveTypeTab: (tab: ModuleManagerTab) => void;
  setInstallFilter: (filter: ModuleInstallFilter) => void;
  clearError: () => void;
}

export const createLifecycleSlice: StateCreator<ModuleState, [], [], LifecycleSlice> = (set, get) => ({
  isInitialized: false,
  initError: null,
  activeTypeTab: 'bible',
  installFilter: 'all',
  error: null,
  errorCode: null,

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

  setActiveTypeTab: (tab: ModuleManagerTab) => {
    set({ activeTypeTab: tab });
  },

  setInstallFilter: (filter: ModuleInstallFilter) => {
    set({ installFilter: filter });
  },

  // Clear error
  clearError: () => {
    set({ error: null, errorCode: null });
  },
});
