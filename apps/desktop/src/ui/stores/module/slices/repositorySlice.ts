import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, ModuleCatalog } from '../types';

export interface RepositorySlice {
  repositories: ModuleCatalog[];
  loadingRepositories: boolean;

  loadRepositories: () => Promise<void>;
  refreshCatalog: (repositoryId: number) => Promise<void>;
  refreshAllCatalogs: () => Promise<void>;
  addRepository: (name: string, url: string, type: string, abbreviation?: string) => Promise<boolean>;
  removeRepository: (repositoryId: number) => Promise<boolean>;
  updateRepositoryUrl: (repositoryId: number, newUrl: string) => Promise<boolean>;
  setRepositoryEnabled: (repositoryId: number, enabled: boolean) => Promise<boolean>;
}

export const createRepositorySlice: StateCreator<ModuleState, [], [], RepositorySlice> = (set, get) => ({
  repositories: [],
  loadingRepositories: false,

  // Load repositories
  loadRepositories: async () => {
    set({ loadingRepositories: true, error: null });
    try {
      const repositories = await moduleAPI.getAllRepositories();
      set({
        repositories: (repositories as ModuleCatalog[]) || [],
        loadingRepositories: false
      });
    } catch (error) {
      console.error('[ModuleStore] Error loading repositories:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to load repositories',
        loadingRepositories: false
      });
    }
  },

  // Refresh single repository catalog
  refreshCatalog: async (repositoryId: number) => {
    set({ loadingRepositories: true, error: null });
    try {
      await moduleAPI.refreshCatalog(repositoryId);
      // Reload repositories and available modules
      await Promise.all([
        get().loadRepositories(),
        get().loadAvailableModules()
      ]);
    } catch (error) {
      console.error('[ModuleStore] Error refreshing catalog:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to refresh catalog',
        loadingRepositories: false
      });
    }
  },

  // Refresh all repository catalogs
  refreshAllCatalogs: async () => {
    set({ loadingRepositories: true, error: null });
    try {
      await moduleAPI.refreshAllCatalogs();
      // Reload repositories and available modules
      await Promise.all([
        get().loadRepositories(),
        get().loadAvailableModules()
      ]);
    } catch (error) {
      console.error('[ModuleStore] Error refreshing catalogs:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to refresh catalogs',
        loadingRepositories: false
      });
    }
  },

  // Add repository
  addRepository: async (name: string, url: string, type: string, abbreviation?: string) => {
    set({ error: null });
    try {
      await moduleAPI.addRepository(name, url, type, abbreviation);
      await get().loadRepositories();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error adding repository:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to add repository' });
      return false;
    }
  },

  // Remove repository
  removeRepository: async (repositoryId: number) => {
    set({ error: null });
    try {
      await moduleAPI.removeRepository(repositoryId);
      await get().loadRepositories();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error removing repository:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to remove repository' });
      return false;
    }
  },

  // Update repository URL
  updateRepositoryUrl: async (repositoryId: number, newUrl: string) => {
    set({ error: null });
    try {
      await moduleAPI.updateRepositoryUrl(repositoryId, newUrl);
      await get().loadRepositories();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error updating repository URL:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to update repository URL' });
      return false;
    }
  },

  // Enable/disable repository
  setRepositoryEnabled: async (repositoryId: number, enabled: boolean) => {
    set({ error: null });
    try {
      await moduleAPI.setRepositoryEnabled(repositoryId, enabled);
      await get().loadRepositories();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error updating repository:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to update repository' });
      return false;
    }
  },
});
