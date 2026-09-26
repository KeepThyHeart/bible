import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, CatalogModule, ModuleMetadata } from '../types';

export interface DetailsSlice {
  selectedModule: CatalogModule | ModuleMetadata | null;
  /**
   * Full metadata of the installed module currently being inspected. Always
   * belongs to the most recent `loadModuleDetails` call - it is cleared as soon
   * as a different module is requested so the panel can never show module A's
   * details under module B's name.
   */
  selectedModuleDetails: ModuleMetadata | null;
  loadingDetails: boolean;

  selectModule: (module: CatalogModule | ModuleMetadata) => void;
  loadModuleDetails: (moduleId: number) => Promise<void>;
  /** Drop the loaded details (and cancel any in-flight load) without touching `selectedModule`. */
  clearDetails: () => void;
  clearSelection: () => void;
}

/**
 * Monotonic token identifying the latest details request. A response is applied
 * only if its token is still current, so an older, slower request cannot
 * overwrite a newer one (rapid row switching) or resurrect details after
 * `clearDetails`.
 */
let latestDetailsRequest = 0;

export const createDetailsSlice: StateCreator<ModuleState, [], [], DetailsSlice> = (set, get) => ({
  selectedModule: null,
  selectedModuleDetails: null,
  loadingDetails: false,

  // Select module for details view
  selectModule: (module: CatalogModule | ModuleMetadata) => {
    set({ selectedModule: module });

    // If it's an installed module, load full details; otherwise make sure no
    // details from a previous selection linger.
    if ('module_id' in module && typeof module.module_id === 'number') {
      void get().loadModuleDetails(module.module_id);
    } else {
      get().clearDetails();
    }
  },

  // Load module details
  loadModuleDetails: async (moduleId: number) => {
    const request = ++latestDetailsRequest;
    const current = get().selectedModuleDetails;
    set({
      // Keep the current details only when refreshing the same module.
      selectedModuleDetails: current && current.module_id === moduleId ? current : null,
      loadingDetails: true,
      error: null,
    });
    try {
      const details = (await moduleAPI.getModuleDetails(moduleId)) as ModuleMetadata;
      if (request !== latestDetailsRequest) return; // superseded
      set({
        selectedModuleDetails: details,
        loadingDetails: false
      });
    } catch (error) {
      if (request !== latestDetailsRequest) return; // superseded
      console.error('[ModuleStore] Error loading module details:', error);
      set({
        selectedModuleDetails: null,
        error: error instanceof Error ? error.message : 'Failed to load module details',
        loadingDetails: false
      });
    }
  },

  clearDetails: () => {
    latestDetailsRequest++;
    set({ selectedModuleDetails: null, loadingDetails: false });
  },

  // Clear selection
  clearSelection: () => {
    latestDetailsRequest++;
    set({
      selectedModule: null,
      selectedModuleDetails: null,
      loadingDetails: false
    });
  },
});
