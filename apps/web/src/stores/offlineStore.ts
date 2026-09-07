import { Store } from './Store';

const OFFLINE_SETTINGS_KEY = 'bible-reader-offline';

export interface DownloadedModule {
  abbreviation: string;
  name: string;
  type: 'bible' | 'semantic';
  sizeBytes: number;
  downloadedAt: string;
  /** ISO timestamp of last use (chapter/verse read). Updated on every local read. */
  lastUsedAt?: string;
  /** True if auto-downloaded when the user selected this translation. False if explicitly downloaded via Settings. */
  autoDownloaded?: boolean;
}

export interface DownloadProgress {
  module: string;
  loaded: number;
  total: number;
  status: 'downloading' | 'complete' | 'error';
  error?: string;
}

class OfflineStore extends Store {
  enabled = false;
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  downloadedModules: DownloadedModule[] = [];
  activeDownloads: Map<string, DownloadProgress> = new Map();
  storageUsed = 0;
  storageQuota = 0;

  constructor() {
    super();
    this.load();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notify();
      });
      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notify();
      });
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.save();
    this.notify();
  }

  isModuleDownloaded(abbreviation: string): boolean {
    return this.downloadedModules.some(m => m.abbreviation === abbreviation);
  }

  addDownloadedModule(module: DownloadedModule): void {
    this.downloadedModules = this.downloadedModules.filter(
      m => m.abbreviation !== module.abbreviation
    );
    this.downloadedModules.push(module);
    this.save();
    this.notify();
  }

  removeDownloadedModule(abbreviation: string): void {
    this.downloadedModules = this.downloadedModules.filter(
      m => m.abbreviation !== abbreviation
    );
    this.save();
    this.notify();
  }

  setDownloadProgress(module: string, progress: DownloadProgress): void {
    if (progress.status === 'complete' || progress.status === 'error') {
      this.activeDownloads.delete(module);
    } else {
      this.activeDownloads.set(module, progress);
    }
    this.notify();
  }

  updateStorageInfo(used: number, quota: number): void {
    this.storageUsed = used;
    this.storageQuota = quota;
    this.notify();
  }

  /** Update lastUsedAt timestamp for a module (called on every local read) */
  touchModule(abbreviation: string): void {
    const mod = this.downloadedModules.find(m => m.abbreviation === abbreviation);
    if (mod) {
      mod.lastUsedAt = new Date().toISOString();
      this.save();
      // Don't notify — this is a background bookkeeping update
    }
  }

  /** Get auto-downloaded modules that haven't been used in the last maxAgeDays days */
  getStaleAutoModules(maxAgeDays: number): DownloadedModule[] {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return this.downloadedModules.filter(m => {
      if (!m.autoDownloaded) return false;
      const lastUsed = m.lastUsedAt ? new Date(m.lastUsedAt).getTime() : new Date(m.downloadedAt).getTime();
      return lastUsed < cutoff;
    });
  }

  private save(): void {
    try {
      localStorage.setItem(OFFLINE_SETTINGS_KEY, JSON.stringify({
        enabled: this.enabled,
        downloadedModules: this.downloadedModules,
      }));
    } catch { /* ignore */ }
  }

  private load(): void {
    try {
      const data = localStorage.getItem(OFFLINE_SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        this.enabled = parsed.enabled ?? false;
        this.downloadedModules = parsed.downloadedModules ?? [];
      }
    } catch { /* ignore */ }
  }
}

export const offlineStore = new OfflineStore();
