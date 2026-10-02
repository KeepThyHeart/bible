import type { CacheRule } from '../cacheRules';

/**
 * Asset store cache rules (task 0090). The page stores downloaded assets
 * (task data, models, etc.) in the asset cache keyed by absolute URL.
 * The `asset-store` rule caches immutable versioned files with Range support
 * for downloads. Index and manager requests go straight to the network;
 * `download=1` parameter bypasses the SW so the manager can resume from a
 * partial file without interference. The `asset-download-tts` rule overrides
 * the audio system's `tts-model-cache` rule to send TTS download requests
 * to the network as well (prior art: audio/piperHandlers.ts).
 */
export const ASSET_RULES: CacheRule[] = [
  {
    id: 'asset-index',
    owner: 'assets',
    strategy: 'network-only',
    pattern: /\/assets\/v1\/index\.json(\?|$)/,
  },
  {
    id: 'asset-download',
    owner: 'assets',
    strategy: 'network-only',
    pattern: /\/assets\/v1\/[^?]*\?(?:.*&)?download=1(&|$)/,
  },
  {
    id: 'asset-store',
    owner: 'assets',
    strategy: 'cache-first-range',
    pattern: /\/assets\/v1\/[^/?]+\/[^/?]+\/[^/?]+\/[^?]+(\?|$)/,
    cacheName: 'assets',
    keepOnReset: true,
  },
  {
    // Override the audio system's tts-model-cache rule (which broadly matches
    // /audio/tts/...) when the download parameter is present, so the asset
    // manager can resume from a partial file and control caching.
    id: 'asset-download-tts',
    owner: 'assets',
    strategy: 'network-only',
    pattern: /\/audio\/tts\/[^?]*\?(?:.*&)?download=1(&|$)/,
  },
];
