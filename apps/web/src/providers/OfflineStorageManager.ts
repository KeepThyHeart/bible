/**
 * Manages offline storage using OPFS (Origin Private File System).
 * Handles downloading Bible modules and storing them for offline use.
 */
import { offlineStore } from '../stores/offlineStore';

export class OfflineStorageManager {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if OPFS is available in this browser
   */
  async isAvailable(): Promise<boolean> {
    try {
      await navigator.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Request persistent storage (prevents browser from evicting data)
   */
  async requestPersistence(): Promise<boolean> {
    if (navigator.storage?.persist) {
      return navigator.storage.persist();
    }
    return false;
  }

  /**
   * Get storage usage info
   */
  async getStorageInfo(): Promise<{ used: number; quota: number }> {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    }
    return { used: 0, quota: 0 };
  }

  /**
   * Download a Bible module for offline use
   */
  async downloadModule(abbreviation: string, name: string): Promise<void> {
    offlineStore.setDownloadProgress(abbreviation, {
      module: abbreviation,
      loaded: 0,
      total: 0,
      status: 'downloading',
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/modules/${abbreviation}/download`);
      if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;

        offlineStore.setDownloadProgress(abbreviation, {
          module: abbreviation,
          loaded,
          total,
          status: 'downloading',
        });
      }

      // Combine chunks
      const data = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }

      // Store in OPFS
      const root = await navigator.storage.getDirectory();
      const modulesDir = await root.getDirectoryHandle('modules', { create: true });
      const fileHandle = await modulesDir.getFileHandle(`${abbreviation}.db`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();

      offlineStore.addDownloadedModule({
        abbreviation,
        name,
        type: 'bible',
        sizeBytes: loaded,
        downloadedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        autoDownloaded: false, // Explicit download via Settings — never auto-cleaned
      });

      offlineStore.setDownloadProgress(abbreviation, {
        module: abbreviation,
        loaded,
        total: loaded,
        status: 'complete',
      });

      // Update storage info
      const info = await this.getStorageInfo();
      offlineStore.updateStorageInfo(info.used, info.quota);
    } catch (error) {
      offlineStore.setDownloadProgress(abbreviation, {
        module: abbreviation,
        loaded: 0,
        total: 0,
        status: 'error',
        error: error instanceof Error ? error.message : 'Download failed',
      });
      throw error;
    }
  }

  /**
   * Download the semantic search embeddings DB
   */
  async downloadSemanticIndex(): Promise<void> {
    const abbr = 'semantic-index';
    offlineStore.setDownloadProgress(abbr, {
      module: abbr,
      loaded: 0,
      total: 0,
      status: 'downloading',
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/modules/semantic-index/download`);
      if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;

        offlineStore.setDownloadProgress(abbr, {
          module: abbr,
          loaded,
          total,
          status: 'downloading',
        });
      }

      const data = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }

      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle('semantic_browser.db', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();

      offlineStore.addDownloadedModule({
        abbreviation: abbr,
        name: 'Semantic Search Index',
        type: 'semantic',
        sizeBytes: loaded,
        downloadedAt: new Date().toISOString(),
      });

      offlineStore.setDownloadProgress(abbr, {
        module: abbr,
        loaded,
        total: loaded,
        status: 'complete',
      });

      const info = await this.getStorageInfo();
      offlineStore.updateStorageInfo(info.used, info.quota);
    } catch (error) {
      offlineStore.setDownloadProgress(abbr, {
        module: abbr,
        loaded: 0,
        total: 0,
        status: 'error',
        error: error instanceof Error ? error.message : 'Download failed',
      });
      throw error;
    }
  }

  /**
   * Remove a downloaded module from OPFS
   */
  async removeModule(abbreviation: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();

      if (abbreviation === 'semantic-index') {
        await root.removeEntry('semantic_browser.db');
      } else {
        const modulesDir = await root.getDirectoryHandle('modules', { create: false });
        await modulesDir.removeEntry(`${abbreviation}.db`);
      }

      offlineStore.removeDownloadedModule(abbreviation);

      const info = await this.getStorageInfo();
      offlineStore.updateStorageInfo(info.used, info.quota);
    } catch (error) {
      console.error(`Failed to remove module ${abbreviation}:`, error);
    }
  }

  /**
   * Download a lite (reading-only) copy of a Bible module.
   * Strips FTS5 indexes and interlinear data, reducing size by ~85%.
   * Used for auto-downloads when the user selects a translation.
   */
  async downloadModuleLite(abbreviation: string, name: string): Promise<void> {
    // Don't show progress UI for lite/auto downloads
    try {
      const response = await fetch(`${this.baseUrl}/api/modules/${abbreviation}/download-lite`);
      if (!response.ok) throw new Error(`Lite download failed: ${response.statusText}`);

      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);

      // Store in OPFS
      const root = await navigator.storage.getDirectory();
      const modulesDir = await root.getDirectoryHandle('modules', { create: true });
      const fileHandle = await modulesDir.getFileHandle(`${abbreviation}.db`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();

      offlineStore.addDownloadedModule({
        abbreviation,
        name,
        type: 'bible',
        sizeBytes: data.length,
        downloadedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        autoDownloaded: true,
      });

      // Update storage info
      const info = await this.getStorageInfo();
      offlineStore.updateStorageInfo(info.used, info.quota);
    } catch (error) {
      console.warn(`[OfflineStorage] Lite download failed for ${abbreviation}:`, error);
      throw error;
    }
  }

  /**
   * Read a module file from OPFS (returns raw bytes)
   */
  async readModuleFile(abbreviation: string): Promise<Uint8Array | null> {
    try {
      const root = await navigator.storage.getDirectory();

      let fileHandle: FileSystemFileHandle;
      if (abbreviation === 'semantic-index') {
        fileHandle = await root.getFileHandle('semantic_browser.db');
      } else {
        const modulesDir = await root.getDirectoryHandle('modules');
        fileHandle = await modulesDir.getFileHandle(`${abbreviation}.db`);
      }

      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }
}
