import type { StateCreator } from 'zustand';
import { moduleAPI } from '../moduleAPI';
import { ModuleState, DownloadProgress } from '../types';

export interface DownloadSlice {
  activeDownloads: DownloadProgress[];
  downloadPollingInterval: number | null;

  loadActiveDownloads: () => Promise<void>;
  startDownloadPolling: () => void;
  stopDownloadPolling: () => void;
  pauseDownload: (queueId: number) => Promise<void>;
  resumeDownload: (queueId: number) => Promise<void>;
  cancelDownload: (queueId: number) => Promise<void>;
}

export const createDownloadSlice: StateCreator<ModuleState, [], [], DownloadSlice> = (set, get) => ({
  activeDownloads: [],
  downloadPollingInterval: null,

  // Load active downloads
  loadActiveDownloads: async () => {
    try {
      const downloads = await moduleAPI.getActiveDownloads();
      set({ activeDownloads: (downloads as DownloadProgress[]) || [] });

      // If there are active downloads, ensure polling is running
      if (downloads && (downloads as DownloadProgress[]).length > 0) {
        const hasActive = (downloads as DownloadProgress[]).some(
          (d: DownloadProgress) => d.status === 'downloading' || d.status === 'pending'
        );
        if (hasActive && !get().downloadPollingInterval) {
          get().startDownloadPolling();
        }
      }
    } catch (error) {
      console.error('[ModuleStore] Error loading active downloads:', error);
    }
  },

  // Start polling for download progress
  startDownloadPolling: () => {
    const { downloadPollingInterval } = get();

    // Don't start if already polling
    if (downloadPollingInterval) return;

    // Poll every 500ms
    const interval = window.setInterval(() => {
      get().loadActiveDownloads();
    }, 500);

    set({ downloadPollingInterval: interval });
  },

  // Stop polling for download progress
  stopDownloadPolling: () => {
    const { downloadPollingInterval } = get();
    if (downloadPollingInterval) {
      window.clearInterval(downloadPollingInterval);
      set({ downloadPollingInterval: null });
    }
  },

  // Pause download
  pauseDownload: async (queueId: number) => {
    try {
      await moduleAPI.pauseDownload(queueId);
      await get().loadActiveDownloads();
    } catch (error) {
      console.error('[ModuleStore] Error pausing download:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to pause download' });
    }
  },

  // Resume download
  resumeDownload: async (queueId: number) => {
    try {
      await moduleAPI.resumeDownload(queueId);
      await get().loadActiveDownloads();
      get().startDownloadPolling();
    } catch (error) {
      console.error('[ModuleStore] Error resuming download:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to resume download' });
    }
  },

  // Cancel download
  cancelDownload: async (queueId: number) => {
    try {
      await moduleAPI.cancelDownload(queueId);
      await get().loadActiveDownloads();
    } catch (error) {
      console.error('[ModuleStore] Error canceling download:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to cancel download' });
    }
  },
});
