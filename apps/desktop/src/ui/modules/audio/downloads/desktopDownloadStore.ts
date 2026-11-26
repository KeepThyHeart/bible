/**
 * `IAudioDownloadStore` for the desktop app: files on disk under the user-data
 * `audio-downloads/` folder, written by the main process through NetworkGateway
 * (`electron/modules/audio/downloadStore.ts`). The `kth-audio:` scheme serves them
 * before the network, so a downloaded book plays (and seeks) offline.
 */
import type { AudioDownloadFile, IAudioDownloadStore } from '@bible/audio';
import type { AudioModuleApi } from '../../../../../electron/modules/audio/types';

type DownloadsApi = Pick<AudioModuleApi,
  'downloadsPresent' | 'downloadsFetch' | 'downloadsProgress' | 'downloadsCancel' | 'downloadsRemove' | 'downloadsFreeBytes'>;

const POLL_MS = 250;

const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function createDesktopDownloadStore(api: DownloadsApi, pollMs = POLL_MS): IAudioDownloadStore {
  return {
    async present(urls) {
      if (urls.length === 0) return new Set();
      return new Set(await api.downloadsPresent([...urls]));
    },

    async fetch(files: readonly AudioDownloadFile[], { signal, onBytes }) {
      if (files.length === 0) return;
      const { jobId } = await api.downloadsFetch(files.map(f => ({ url: f.url, bytes: f.bytes, ...(f.sha256 ? { sha256: f.sha256 } : {}) })));
      let cancelled = false;
      const onAbort = () => { cancelled = true; void api.downloadsCancel(jobId).catch(() => {}); };
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      try {
        for (;;) {
          const p = await api.downloadsProgress(jobId);
          onBytes(p.loaded);
          if (p.state === 'done') return;
          if (p.state === 'cancelled' || cancelled) throw Object.assign(new Error('aborted'), { code: 'aborted', name: 'AbortError' });
          if (p.state === 'failed') throw Object.assign(new Error(p.error ?? 'Download failed'), { code: p.code ?? 'network' });
          await wait(pollMs, signal);
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },

    async remove(urls) {
      if (urls.length) await api.downloadsRemove([...urls]);
    },

    freeBytes: () => api.downloadsFreeBytes(),
  };
}
