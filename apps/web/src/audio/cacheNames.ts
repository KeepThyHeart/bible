/**
 * Names of the Cache API caches the audio feature uses. In their own file so the
 * service worker (`sw.ts`, PWA builds only) can name the same caches the page
 * writes to, without importing any page code: entries the page stored then
 * satisfy the worker's routes, which is what lets seeking inside a cached
 * chapter work offline.
 */
export const AUDIO_CACHE_NAMES = {
  /** Chapter manifests and translation indexes. */
  manifests: 'kth-audio-manifests',
  /** Recorded chapter audio files. */
  chapters: 'kth-audio-chapters',
  /** TTS runtimes and voice models. Never expired automatically. */
  models: 'kth-tts-models',
} as const;
