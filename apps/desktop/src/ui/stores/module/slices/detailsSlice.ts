import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, CatalogModule, ModuleMetadata } from '../types';

export interface DetailsSlice {
  selectedModule: CatalogModule | ModuleMetadata | null;
  selectedModuleDetails: any | null;
  loadingDetails: boolean;

  selectModule: (module: CatalogModule | ModuleMetadata) => void;
  loadModuleDetails: (moduleId: number) => Promise<void>;
  clearSelection: () => void;
}

export const createDetailsSlice: StateCreator<ModuleState, [], [], DetailsSlice> = (set, get) => ({
  selectedModule: null,
  selectedModuleDetails: null,
  loadingDetails: false,

  // Select module for details view
  selectModule: (module: CatalogModule | ModuleMetadata) => {
    set({ selectedModule: module });

    // If it's an installed module, load full details
    if ('module_id' in module && typeof module.module_id === 'number') {
      get().loadModuleDetails(module.module_id);
    }
  },

  // Load module details
  loadModuleDetails: async (moduleId: number) => {
    set({ loadingDetails: true, error: null });
    try {
      const details = await moduleAPI.getModuleDetails(moduleId);
      set({
        selectedModuleDetails: details,
        loadingDetails: false
      });
    } catch (error) {
      console.error('[ModuleStore] Error loading module details:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to load module details',
        loadingDetails: false
      });
    }
  },

  // Clear selection
  clearSelection: () => {
    set({
      selectedModule: null,
      selectedModuleDetails: null
    });
  },
});
