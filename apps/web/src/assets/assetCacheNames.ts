/**
 * Names of the Cache API caches the asset store uses. They are the names the
 * service-worker cache rules resolve to (`sw/rules/assets.ts`: `<cacheName>-v<version>`);
 * a unit test keeps the two in step. In their own file so the
 * service worker (`sw.ts`, PWA builds only) can name the same caches the page
 * writes to, without importing any page code: entries the page stored then
 * satisfy the worker's routes.
 */
export const ASSET_CACHE_NAMES = {
  /** Asset files served from /assets/v1/ (sounds, fonts, data). */
  assets: 'assets-v1',
  /** TTS runtimes and voice models. Never expired automatically. */
  models: 'tts-models-v1',
} as const;

/**
 * Map an asset kind to its cache name.
 * TTS runtimes and voices are stored in the models cache (historically
 * `tts-models-v1`, adopted from the audio system). Everything else uses
 * the asset cache.
 */
export function cacheNameForKind(kind: string): string {
  return kind === 'tts-runtime' || kind === 'tts-voice'
    ? ASSET_CACHE_NAMES.models
    : ASSET_CACHE_NAMES.assets;
}
