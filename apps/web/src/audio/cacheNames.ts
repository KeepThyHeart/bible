/**
 * Names of the Cache API caches the audio feature uses. They are the names the
 * service-worker cache rules resolve to (`sw/rules/audio.ts`: `<cacheName>-v<version>`);
 * a unit test keeps the two in step. In their own file so the
 * service worker (`sw.ts`, PWA builds only) can name the same caches the page
 * writes to, without importing any page code: entries the page stored then
 * satisfy the worker's routes, which is what lets seeking inside a cached
 * chapter work offline.
 */
export const AUDIO_CACHE_NAMES = {
  /** Chapter manifests and translation indexes. */
  manifests: 'audio-manifests-v1',
  /** Recorded chapter audio files. */
  chapters: 'audio-chapters-v1',
  /** TTS runtimes and voice models. Never expired automatically. */
  models: 'tts-models-v1',
} as const;
