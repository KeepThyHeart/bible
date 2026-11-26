/**
 * Web wiring for per-book audio downloads (task 0223): the handle `initAudio` leaves for the view,
 * the model factory, and `ensureText` (the app's own offline Bible download).
 */
import { AudioDownloadsModel, Store, createCacheDownloadStore } from '@bible/audio';
import type { IAssetCache } from '@bible/core/browser';
import { AssetError } from '@bible/core/browser';
import type { AudioSystem } from '../audioStore';
import { moduleStore } from '../../../stores/moduleStore';
import { offlineStore } from '../../../stores/offlineStore';
import { findModuleManifest, installModuleAsset, refreshModuleCatalog } from '../../../offline/moduleAssets';

export interface AudioDownloadsHandle {
  recordings: NonNullable<AudioSystem['recordings']>;
  /** The pinned downloads cache (`audio-downloads-v1`). */
  cache: IAssetCache;
}

let handle: AudioDownloadsHandle | null = null;
export const setAudioDownloadsHandle = (h: AudioDownloadsHandle | null): void => {
  if (h !== handle) resetWebDownloadsModel();
  handle = h;
};
export const getAudioDownloadsHandle = (): AudioDownloadsHandle | null => handle;

/**
 * Make sure a translation's text is readable offline: a no-op when it is, else the app's module
 * download (pinned, as an explicit action). A site whose offline catalog lacks the module keeps
 * reading it online: that is not a failure of the audio download.
 */
export async function ensureModuleText(module: string, signal: AbortSignal): Promise<void> {
  if (offlineStore.isModuleDownloaded(module)) return;
  if (!findModuleManifest(module)) await refreshModuleCatalog(signal);
  try {
    await installModuleAsset(module, { pinned: true, signal });
  } catch (e) {
    if (e instanceof AssetError && e.code === 'not-found') return;
    throw e;
  }
}

/** A model over the live audio system, or null when audio is off or has no recordings. */
export function createWebDownloadsModel(): AudioDownloadsModel | null {
  const h = handle;
  if (!h) return null;
  const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
  return new AudioDownloadsModel({
    manifests: h.recordings.manifests,
    locator: h.recordings.locator,
    store: createCacheDownloadStore(h.cache),
    canPlay: mime => !!probe && probe.canPlayType(mime) !== '',
    chapterCount: book => moduleStore.getBookByNumber(book)?.chapter_count ?? 0,
    ensureText: ensureModuleText,
  });
}

let shared: { handle: AudioDownloadsHandle; model: AudioDownloadsModel } | null = null;

/**
 * The one model of the app, created lazily: a download keeps running when the dialog closes, and
 * reopening shows its progress. Rebuilt only when the audio system's handle changes.
 */
export function getWebDownloadsModel(): AudioDownloadsModel | null {
  if (!handle) return null;
  if (shared && shared.handle === handle) return shared.model;
  const model = createWebDownloadsModel();
  shared = model ? { handle, model } : null;
  return model;
}

/** Drop the shared model (cancelling any run): handle changes, and tests. */
export function resetWebDownloadsModel(): void {
  shared?.model.cancel();
  shared = null;
}

/** Which translation the downloads dialog shows (null: closed). */
class DownloadsDialogStore extends Store {
  module: string | null = null;
  open(module: string): void { this.module = module; this.notify(); }
  close(): void { this.module = null; this.notify(); }
}
export const downloadsDialog = new DownloadsDialogStore();
