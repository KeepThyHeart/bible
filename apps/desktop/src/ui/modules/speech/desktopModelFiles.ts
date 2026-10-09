/**
 * `IModelFileSource` over the desktop asset IPC (`window.electron.assets`): the main-process
 * AssetManager downloads and verifies the Whisper files, this reads them back for the engine.
 * `install` resolves when the job ends, so it polls `assets:list` while the job runs.
 */
import type { LoadProgress } from '@bible/core/speech';
import type { AssetListSnapshot } from '@bible/core/browser';
import type { IModelFileSource } from '@bible/speech';
import { unwrap, type Result } from '../../services/ipcResult';

/** The asset bridge the source needs; `read` is the new `assets:read` channel (S10). */
export interface AssetsBridgeLike {
  list(): Promise<Result<AssetListSnapshot>>;
  install(id: string): Promise<Result<{ started: true }>>;
  cancel(id: string): Promise<Result<{ cancelled: boolean }>>;
  remove(id: string): Promise<Result<{ removed: boolean }>>;
  read(id: string, path: string): Promise<Result<Uint8Array | ArrayBuffer>>;
}

export const POLL_MS = 250;

function defaultBridge(): AssetsBridgeLike {
  const assets = (window as unknown as { electron?: { assets?: AssetsBridgeLike } }).electron?.assets;
  if (!assets) throw new Error('Asset store is not available in this build.');
  return assets;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createDesktopModelFiles(getBridge: () => AssetsBridgeLike = defaultBridge, pollMs = POLL_MS): IModelFileSource {
  const entryOf = async (id: string) => (await unwrap(getBridge().list())).entries.find((e) => e.id === id);
  return {
    async isInstalled(assetId) {
      const e = await entryOf(assetId);
      return e?.status === 'installed' || e?.status === 'update-available';
    },

    async install(assetId, onProgress: (p: LoadProgress) => void, signal) {
      const bridge = getBridge();
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      await unwrap(bridge.install(assetId));
      const onAbort = () => void bridge.cancel(assetId).catch(() => undefined);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        for (;;) {
          const e = await entryOf(assetId);
          if (signal.aborted) throw new DOMException('aborted', 'AbortError');
          if (!e) throw new Error(`Unknown speech model asset: ${assetId}`);
          if (e.progress) onProgress({ phase: 'engine', loaded: e.progress.loaded, total: e.progress.total });
          if (e.status === 'installed' || e.status === 'update-available') return;
          if (e.status === 'error' || e.status === 'available') {
            if (e.error?.code === 'aborted' || signal.aborted) throw new DOMException('aborted', 'AbortError');
            throw new Error(e.error?.message ?? 'Download failed');
          }
          await sleep(pollMs);
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },

    async read(assetId, path) {
      const data = await unwrap(getBridge().read(assetId, path));
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    },

    async remove(assetId) {
      await unwrap(getBridge().remove(assetId));
    },
  };
}
