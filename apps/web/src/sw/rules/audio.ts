import type { CacheRule } from '../cacheRules';
import {
  AUDIO_ENGINE_RUNTIME_CACHE_PATTERN,
  AUDIO_FILE_CACHE_PATTERN,
  AUDIO_MANIFEST_CACHE_PATTERN,
} from '../../utils/swCachePatterns';

/**
 * Audio Bible (task 0059). The page also stores these through the Cache API
 * (`src/modules/audio/lib/cacheNames.ts` derives the SAME names from these rules), so
 * recordings work offline with the PWA off, and what the page stored answers the
 * worker's requests, Range requests included. No `maxEntries`: the page trims
 * least-recently-played chapters itself. Manifests and audio are immutable (the
 * revision is in the URL); the mutable per-translation `index.json` is not matched
 * and always goes to the network.
 */
export const AUDIO_RULES: CacheRule[] = [
  {
    id: 'audio-manifests',
    owner: 'audio',
    strategy: 'cache-first',
    pattern: AUDIO_MANIFEST_CACHE_PATTERN,
    cacheName: 'audio-manifests',
    keepOnReset: true,
  },
  {
    id: 'audio-v1',
    owner: 'audio',
    strategy: 'cache-first-range',
    pattern: AUDIO_FILE_CACHE_PATTERN,
    cacheName: 'audio-chapters',
    keepOnReset: true,
  },
  {
    // A speech engine's runtime (ONNX Runtime, the phonemizer): the page stores the
    // binaries here when a voice is downloaded, and the worker's script imports are
    // then answered from it offline too.
    id: 'tts-model-cache',
    owner: 'audio',
    strategy: 'cache-first',
    pattern: AUDIO_ENGINE_RUNTIME_CACHE_PATTERN,
    cacheName: 'tts-models',
    keepOnReset: true,
  },
];
