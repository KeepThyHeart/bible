/**
 * The Piper worker entry point: real dependencies for `createPiperHandlers`.
 * Everything of substance is in `piperHandlers.ts`, which is what the tests run.
 */

import { AUDIO_CACHE_NAMES, createAssetCache } from '../../AssetCache';
import { serveTtsWorker, type WorkerScopeLike } from '../serveTtsWorker';
import { createPiperHandlers, type CreatePhonemizer, type OrtLike } from './piperHandlers';

const scope = self as unknown as WorkerScopeLike & { crossOriginIsolated?: boolean };

serveTtsWorker(scope, createPiperHandlers({
  cache: createAssetCache(AUDIO_CACHE_NAMES.models),
  fetchFn: (url, init) => fetch(url, init),
  // Loaded by URL from the site's own files; `@vite-ignore` because the address is only known at run time.
  importOrt: async url => await import(/* @vite-ignore */ url) as OrtLike,
  importPhonemizer: async url => (await import(/* @vite-ignore */ url) as { default: CreatePhonemizer }).default,
  // More than one thread needs SharedArrayBuffer, i.e. cross-origin isolation.
  threads: scope.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)) : 1,
}));
