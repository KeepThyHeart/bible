import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, ModuleMetadata } from '../types';

export interface InstalledSlice {
  installedModules: ModuleMetadata[];
  loadingInstalled: boolean;

  loadInstalledModules: () => Promise<void>;
  installModule: (moduleId: string) => Promise<boolean>;
  uninstallModule: (moduleId: number, removeUserData?: boolean) => Promise<boolean>;
  updateModule: (moduleId: number) => Promise<boolean>;
  checkForUpdates: (moduleId: number) => Promise<any>;
}

export const createInstalledSlice: StateCreator<ModuleState, [], [], InstalledSlice> = (set, get) => ({
  installedModules: [],
  loadingInstalled: false,

  // Load installed modules
  loadInstalledModules: async () => {
    set({ loadingInstalled: true, error: null });
    try {
      const modules = await moduleAPI.getInstalledModules();
      set({
        installedModules: (modules as ModuleMetadata[]) || [],
        loadingInstalled: false
      });
    } catch (error) {
      console.error('[ModuleStore] Error loading installed modules:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to load installed modules',
        loadingInstalled: false
      });
    }
  },

  // Install module
  installModule: async (moduleId: string) => {
    set({ error: null });
    try {
      await moduleAPI.installModule(moduleId);
      // Reload installed modules
      await get().loadInstalledModules();
      // Start polling downloads
      get().startDownloadPolling();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error installing module:', error);
      set({ error: error instanceof Error ? error.message : 'Installation failed' });
      return false;
    }
  },

  // Uninstall module
  uninstallModule: async (moduleId: number, removeUserData = false) => {
    set({ error: null });
    try {
      await moduleAPI.uninstallModule(moduleId, removeUserData);
      // Reload installed modules
      await get().loadInstalledModules();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error uninstalling module:', error);
      set({ error: error instanceof Error ? error.message : 'Uninstallation failed' });
      return false;
    }
  },

  // Update module
  updateModule: async (moduleId: number) => {
    set({ error: null });
    try {
      await moduleAPI.updateModule(moduleId);
      // Reload installed modules
      await get().loadInstalledModules();
      // Start polling downloads
      get().startDownloadPolling();
      return true;
    } catch (error) {
      console.error('[ModuleStore] Error updating module:', error);
      set({ error: error instanceof Error ? error.message : 'Update failed' });
      return false;
    }
  },

  // Check for updates
  checkForUpdates: async (moduleId: number) => {
    try {
      return await moduleAPI.checkForUpdates(moduleId);
    } catch (error) {
      console.error('[ModuleStore] Error checking for updates:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to check for updates' });
      return null;
    }
  },
});
