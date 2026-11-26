/**
 * `PiperAssetPort` over the desktop asset IPC (`window.electron.assets`): the main-process
 * AssetManager downloads and verifies the Piper runtime and voices; the worker then reads them
 * from the `kth-audio` scheme. `install` resolves when the job ends, so it polls `assets:list`
 * (the same approach as speech's `desktopModelFiles`).
 *
 * The pronunciation overlay ships with the runtime on desktop: installing `piper-runtime`
 * also installs `piper-pronunciation`, with progress summed over both.
 */
import type { AssetListSnapshot, AssetManifest, InstallOptions } from '@bible/core/browser';
import type { PiperAssetPort } from '@bible/audio';
import { unwrap, type Result } from '../../services/ipcResult';
import { PIPER_PRONUNCIATION_ASSET_ID, PIPER_RUNTIME_ASSET_ID } from '../../../../electron/modules/audio/types';

export interface AssetsBridgeLike {
  list(): Promise<Result<AssetListSnapshot>>;
  install(id: string): Promise<Result<{ started: true }>>;
  cancel(id: string): Promise<Result<{ cancelled: boolean }>>;
  remove(id: string): Promise<Result<{ removed: boolean }>>;
}

export const PIPER_POLL_MS = 250;

function defaultBridge(): AssetsBridgeLike {
  const assets = (window as unknown as { electron?: { assets?: AssetsBridgeLike } }).electron?.assets;
  if (!assets) throw new Error('Asset store is not available in this build.');
  return assets;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const abortError = () => new DOMException('aborted', 'AbortError');
const isInstalled = (status: string | undefined) => status === 'installed' || status === 'update-available';

/** What installing an id installs. */
export function piperAssetGroup(id: string): string[] {
  return id === PIPER_RUNTIME_ASSET_ID ? [PIPER_RUNTIME_ASSET_ID, PIPER_PRONUNCIATION_ASSET_ID] : [id];
}

export function createDesktopPiperAssets(getBridge: () => AssetsBridgeLike = defaultBridge, pollMs = PIPER_POLL_MS): PiperAssetPort {
  const snapshot = async () => (await unwrap(getBridge().list())).entries;

  return {
    async installed(id) {
      const entries = await snapshot();
      return piperAssetGroup(id).every(i => isInstalled(entries.find(e => e.id === i)?.status));
    },

    async install(target: AssetManifest | string, opts: InstallOptions) {
      const id = typeof target === 'string' ? target : target.id;
      const ids = piperAssetGroup(id);
      const bridge = getBridge();
      const { signal, onProgress } = opts;
      if (signal?.aborted) throw abortError();
      const cancelAll = () => { for (const i of ids) void bridge.cancel(i).catch(() => undefined); };
      for (const i of ids) await unwrap(bridge.install(i));
      const onAbort = () => cancelAll();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        for (;;) {
          const entries = await snapshot();
          if (signal?.aborted) throw abortError();
          let loaded = 0;
          let total = 0;
          let done = true;
          for (const i of ids) {
            const e = entries.find(x => x.id === i);
            if (!e) throw new Error(`Unknown audio asset: ${i}`);
            if (e.status === 'error' || e.status === 'available') {
              if (e.error?.code === 'aborted' || signal?.aborted) throw abortError();
              cancelAll();
              throw new Error(e.error?.message ?? 'Download failed');
            }
            const size = e.progress?.total || e.size || 0;
            total += size;
            if (isInstalled(e.status)) loaded += size;
            else { done = false; loaded += e.progress?.loaded ?? 0; }
          }
          onProgress?.({ id, version: '', phase: 'downloading', loaded, total, file: 1, files: 1, attempt: 0 });
          if (done) return;
          await sleep(pollMs);
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },

    // Nothing from before the asset manager existed on desktop.
    async adopt() { return false; },

    async remove(id) {
      for (const i of piperAssetGroup(id)) await unwrap(getBridge().remove(i));
    },
  };
}

export const desktopPiperAssets: PiperAssetPort = createDesktopPiperAssets();
