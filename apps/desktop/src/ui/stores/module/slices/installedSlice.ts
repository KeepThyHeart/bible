import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, ModuleMetadata } from '../types';
import { notifyLibraryChanged } from '../../crossStoreBridge';

export interface InstalledSlice {
  installedModules: ModuleMetadata[];
  loadingInstalled: boolean;

  loadInstalledModules: () => Promise<void>;
  /**
   * `catalogId`, when given, restricts resolution to that one catalog (see
   * `IModuleCatalogService.getModuleInfo`) - a starter pack's own
   * `source.catalogId`, so a third-party catalog can never satisfy an
   * install meant for the verified official one.
   */
  installModule: (moduleId: string, catalogId?: number) => Promise<boolean>;
  uninstallModule: (moduleId: number, removeUserData?: boolean) => Promise<boolean>;
  updateModule: (moduleId: number) => Promise<boolean>;
  checkForUpdates: (moduleId: number) => Promise<any>;
}

const moduleSignature = (m: ModuleMetadata): string =>
  `${m.module_id}@${m.version}${m.user_hidden ? '!hidden' : ''}`;

/**
 * Module types whose installed set differs between two snapshots - added,
 * removed, updated (version change) or hidden/unhidden modules.
 */
function changedModuleTypes(before: ModuleMetadata[], after: ModuleMetadata[]): string[] {
  const signaturesByType = (list: ModuleMetadata[]): Map<string, Set<string>> => {
    const byType = new Map<string, Set<string>>();
    for (const m of list) {
      const set = byType.get(m.module_type) ?? new Set<string>();
      set.add(moduleSignature(m));
      byType.set(m.module_type, set);
    }
    return byType;
  };
  const prev = signaturesByType(before);
  const next = signaturesByType(after);
  const changed: string[] = [];
  for (const type of new Set([...prev.keys(), ...next.keys()])) {
    const a = prev.get(type) ?? new Set<string>();
    const b = next.get(type) ?? new Set<string>();
    if (a.size !== b.size || [...a].some(sig => !b.has(sig))) changed.push(type);
  }
  return changed;
}

export const createInstalledSlice: StateCreator<ModuleState, [], [], InstalledSlice> = (set, get) => ({
  installedModules: [],
  loadingInstalled: false,

  // Load installed modules
  loadInstalledModules: async () => {
    set({ loadingInstalled: true, error: null });
    try {
      const before = get().installedModules;
      const modules = await moduleAPI.getInstalledModules();
      const after = (modules as ModuleMetadata[]) || [];
      set({
        installedModules: after,
        loadingInstalled: false
      });
      // Every install/uninstall/update path - including file and pack installs
      // made outside this slice - ends in a reload, and the reload happens only
      // once the work has actually finished (the IPC calls resolve after the
      // download and install complete; polling is progress display only). So
      // the reload is the one place that sees a finished change.
      const changedTypes = changedModuleTypes(before, after);
      if (changedTypes.length > 0) {
        await notifyLibraryChanged({ moduleTypes: changedTypes });
      }
    } catch (error) {
      console.error('[ModuleStore] Error loading installed modules:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to load installed modules',
        loadingInstalled: false
      });
    }
  },

  // Install module
  installModule: async (moduleId: string, catalogId?: number) => {
    set({ error: null });
    try {
      await moduleAPI.installModule(moduleId, catalogId);
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
