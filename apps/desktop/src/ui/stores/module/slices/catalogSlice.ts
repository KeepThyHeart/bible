import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, CatalogModule, ModuleFilter } from '../types';

export interface CatalogSlice {
  availableModules: CatalogModule[];
  loadingAvailable: boolean;

  // Search/Filter
  searchQuery: string;
  activeFilter: ModuleFilter;
  filteredModules: CatalogModule[];

  loadAvailableModules: (filter?: ModuleFilter) => Promise<void>;
  searchModules: (query: string) => void;
  setFilter: (filter: Partial<ModuleFilter>) => void;
  clearFilter: () => void;
}

export const createCatalogSlice: StateCreator<ModuleState, [], [], CatalogSlice> = (set, get) => ({
  availableModules: [],
  loadingAvailable: false,
  searchQuery: '',
  activeFilter: {},
  filteredModules: [],

  // Load available modules from catalog
  loadAvailableModules: async (filter?: ModuleFilter) => {
    set({ loadingAvailable: true, error: null });
    try {
      const modules = await moduleAPI.getAvailableModules(filter);
      const catalogModules = (modules as CatalogModule[]) || [];
      set({
        availableModules: catalogModules,
        filteredModules: catalogModules,
        loadingAvailable: false
      });
    } catch (error) {
      console.error('[ModuleStore] Error loading available modules:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to load available modules',
        loadingAvailable: false
      });
    }
  },

  // Search modules
  searchModules: (query: string) => {
    set({ searchQuery: query });
    const { availableModules, activeFilter } = get();

    // Apply search and filter
    let filtered = availableModules;

    if (query.trim()) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(module =>
        module.name.toLowerCase().includes(lowerQuery) ||
        module.abbreviation.toLowerCase().includes(lowerQuery) ||
        module.description.toLowerCase().includes(lowerQuery)
      );
    }

    // Apply additional filters
    if (activeFilter.moduleType) {
      const types = Array.isArray(activeFilter.moduleType)
        ? activeFilter.moduleType
        : [activeFilter.moduleType];
      filtered = filtered.filter(m => types.includes(m.module_type));
    }

    if (activeFilter.languageCode) {
      const langs = Array.isArray(activeFilter.languageCode)
        ? activeFilter.languageCode
        : [activeFilter.languageCode];
      filtered = filtered.filter(m => langs.includes(m.language_code));
    }

    if (activeFilter.recommended !== undefined) {
      filtered = filtered.filter(m => m.recommended === activeFilter.recommended);
    }

    set({ filteredModules: filtered });
  },

  // Set filter
  setFilter: (filter: Partial<ModuleFilter>) => {
    const newFilter = { ...get().activeFilter, ...filter };
    set({ activeFilter: newFilter });
    get().searchModules(get().searchQuery);
  },

  // Clear filter
  clearFilter: () => {
    set({ activeFilter: {}, searchQuery: '' });
    set({ filteredModules: get().availableModules });
  },
});
