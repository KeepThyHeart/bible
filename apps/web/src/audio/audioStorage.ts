/**
 * What the audio feature keeps on the device, for the Storage section of the
 * settings screen: downloaded speech voices and engines (the models cache) and
 * recently played chapters (the chapters cache and its manifests).
 *
 * The caches are taken as a parameter so a test can hand in in-memory ones.
 */

import type { IAssetCache } from '@bible/core/browser';
import { AUDIO_CACHE_NAMES, createAssetCache } from './AssetCache';

export interface AudioCaches {
  models: IAssetCache;
  chapters: IAssetCache;
  manifests: IAssetCache;
}

export function openAudioCaches(): AudioCaches {
  return {
    models: createAssetCache(AUDIO_CACHE_NAMES.models),
    chapters: createAssetCache(AUDIO_CACHE_NAMES.chapters),
    manifests: createAssetCache(AUDIO_CACHE_NAMES.manifests),
  };
}

export interface AudioStorageUsage {
  /** Bytes of engine runtimes and voices. */
  modelBytes: number;
  /** Bytes of recorded chapters (manifests are small and not counted). */
  chapterBytes: number;
  /** How many chapter files are stored. */
  chapterCount: number;
}

export async function audioStorageUsage(caches: AudioCaches = openAudioCaches()): Promise<AudioStorageUsage> {
  const [modelBytes, chapterBytes, chapterKeys] = await Promise.all([
    caches.models.usage(''),
    caches.chapters.usage(''),
    caches.chapters.keys(''),
  ]);
  return { modelBytes, chapterBytes, chapterCount: chapterKeys.length };
}

/** Delete every downloaded engine runtime and voice. Voices are downloaded again on next use. */
export async function clearModels(caches: AudioCaches = openAudioCaches()): Promise<void> {
  await caches.models.delete('');
}

/** Delete stored chapters and their manifests. */
export async function clearChapters(caches: AudioCaches = openAudioCaches()): Promise<void> {
  await Promise.all([caches.chapters.delete(''), caches.manifests.delete('')]);
}

/** "63 MB", "1.3 MB", "820 KB": for sizes in the audio UI. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** "2:18" for 138 seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
