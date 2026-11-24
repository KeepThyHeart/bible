/**
 * The Piper worker entry point: real dependencies for `createPiperHandlers`.
 * Everything of substance is in `piperHandlers.ts`, which is what the tests run.
 */

import type { CachedResponse, IAssetCache } from '@bible/core/browser';
import { AUDIO_CACHE_NAMES, createAssetCache } from '../../AssetCache';
import { serveTtsWorker, type WorkerScopeLike } from '../serveTtsWorker';
import { createPiperHandlers, type CreatePhonemizer, type OrtLike, type PiperStorage } from './piperHandlers';

const scope = self as unknown as WorkerScopeLike & { crossOriginIsolated?: boolean };

let storage: PiperStorage = 'cache';
let cacheApi: IAssetCache | null = null;
const models = (): IAssetCache => (cacheApi ??= createAssetCache(AUDIO_CACHE_NAMES.models));

/** 'direct': the app serves installed files at their URLs, so a read is a fetch and a write is not needed. */
const fetchHit = async (url: string): Promise<CachedResponse | undefined> => {
  try {
    const res = await fetch(url);
    return res.ok ? res : undefined;
  } catch {
    return undefined;
  }
};

const cache: IAssetCache = {
  get: url => (storage === 'direct' ? fetchHit(url) : models().get(url)),
  has: async url => (storage === 'direct' ? (await fetchHit(url)) !== undefined : models().has(url)),
  put: (url, res) => (storage === 'direct' ? Promise.resolve() : models().put(url, res)),
  delete: prefix => (storage === 'direct' ? Promise.resolve(0) : models().delete(prefix)),
  keys: prefix => (storage === 'direct' ? Promise.resolve([]) : models().keys(prefix)),
  usage: prefix => (storage === 'direct' ? Promise.resolve(0) : models().usage(prefix)),
  touch: url => (storage === 'direct' ? Promise.resolve() : models().touch(url)),
};

serveTtsWorker(scope, createPiperHandlers({
  cache,
  configure: s => { storage = s; },
  fetchFn: (url, init) => fetch(url, init),
  // Loaded by URL from the site's own files; `@vite-ignore` because the address is only known at run time.
  importOrt: async url => await import(/* @vite-ignore */ url) as OrtLike,
  importPhonemizer: async url => (await import(/* @vite-ignore */ url) as { default: CreatePhonemizer }).default,
  // More than one thread needs SharedArrayBuffer, i.e. cross-origin isolation.
  threads: scope.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)) : 1,
}));
