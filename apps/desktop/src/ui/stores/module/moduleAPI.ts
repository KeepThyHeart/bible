// Module Manager API - single chokepoint that unwraps `Result<T>` envelopes.
//
// The main-process handlers in `electron/ipc/moduleHandlers.ts` have been
// migrated to `ipcHandler` (cleanup item 2.3a) and now return
// `{ ok, value } | { ok: false, error }` via the preload bridge.
// `moduleManagerAPI` calls `unwrap()` on every method so downstream slices
// receive plain values and errors throw as `IpcResultError`.
import { requireElectronAPI } from '../../services/electronAPI';
import { unwrap } from '../../services/ipcResult';

export const moduleAPI = {
  async init() {
    return unwrap(requireElectronAPI().moduleManager.init());
  },
  async getAvailableModules(filter?: any) {
    return unwrap(requireElectronAPI().moduleManager.getAvailableModules(filter));
  },
  async getInstalledModules() {
    return unwrap(requireElectronAPI().moduleManager.getInstalledModules());
  },
  async searchModules(filter: any) {
    return unwrap(requireElectronAPI().moduleManager.searchModules(filter));
  },
  async installModule(moduleId: string) {
    return unwrap(requireElectronAPI().moduleManager.installModule(moduleId));
  },
  async installFromFile() {
    return unwrap(requireElectronAPI().moduleManager.installFromFile());
  },
  async installFromPath(filePath: string, allowOverwrite?: boolean) {
    return unwrap(requireElectronAPI().moduleManager.installFromPath(filePath, allowOverwrite));
  },
  async installPackFromPath(archivePath: string, allowOverwrite?: boolean) {
    return unwrap(requireElectronAPI().moduleManager.installPackFromPath(archivePath, allowOverwrite));
  },
  async uninstallModule(moduleId: number, removeUserData?: boolean) {
    return unwrap(requireElectronAPI().moduleManager.uninstallModule(moduleId, removeUserData));
  },
  async updateModule(moduleId: number) {
    return unwrap(requireElectronAPI().moduleManager.updateModule(moduleId));
  },
  async checkForUpdates(moduleId: number) {
    return unwrap(requireElectronAPI().moduleManager.checkForUpdates(moduleId));
  },
  async getModuleDetails(moduleId: number) {
    return unwrap(requireElectronAPI().moduleManager.getModuleDetails(moduleId));
  },
  async getDownloadProgress(queueId: number) {
    return unwrap(requireElectronAPI().moduleManager.getDownloadProgress(queueId));
  },
  async getActiveDownloads() {
    return unwrap(requireElectronAPI().moduleManager.getActiveDownloads());
  },
  async pauseDownload(queueId: number) {
    return unwrap(requireElectronAPI().moduleManager.pauseDownload(queueId));
  },
  async resumeDownload(queueId: number) {
    return unwrap(requireElectronAPI().moduleManager.resumeDownload(queueId));
  },
  async cancelDownload(queueId: number) {
    return unwrap(requireElectronAPI().moduleManager.cancelDownload(queueId));
  },
  async getAllRepositories() {
    return unwrap(requireElectronAPI().moduleManager.getAllRepositories());
  },
  async refreshCatalog(repositoryId: number) {
    return unwrap(requireElectronAPI().moduleManager.refreshCatalog(repositoryId));
  },
  async refreshAllCatalogs() {
    return unwrap(requireElectronAPI().moduleManager.refreshAllCatalogs());
  },
  async getCatalog(repositoryId: number) {
    return unwrap(requireElectronAPI().moduleManager.getCatalog(repositoryId));
  },
  async addRepository(name: string, url: string, type: string, abbreviation?: string) {
    return unwrap(requireElectronAPI().moduleManager.addRepository(name, url, type, abbreviation));
  },
  async removeRepository(repositoryId: number) {
    return unwrap(requireElectronAPI().moduleManager.removeRepository(repositoryId));
  },
  async updateRepositoryUrl(repositoryId: number, newUrl: string) {
    return unwrap(requireElectronAPI().moduleManager.updateRepositoryUrl(repositoryId, newUrl));
  },
  async setRepositoryEnabled(repositoryId: number, enabled: boolean) {
    return unwrap(requireElectronAPI().moduleManager.setRepositoryEnabled(repositoryId, enabled));
  }
};
