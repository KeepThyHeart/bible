/**
 * The web port of the speech engine (task 0151): model files over the shared asset manager, the
 * ONNX runtime wasm the app already self-hosts, and `createSpeechService` on top.
 *
 * Nothing in the entry chunk imports this file (see FORBIDDEN in scripts/check-entry-chunk.mjs); the
 * Memory module loads it when recitation is first used. Mic access needs a secure context.
 */

import type { AssetManifest, IAssetManager } from '@bible/core/browser';
import type { LoadProgress } from '@bible/core/speech';
import { createSpeechService, whisperManifests } from '@bible/speech';
import type { IModelFileSource, SpeechService } from '@bible/speech';
import { getReadyAssetManager, registerCatalogSource } from '../assets/webAssets';

const baseUrl = (): string => {
  try {
    return import.meta.env.BASE_URL || '/';
  } catch {
    return '/';
  }
};

/** Where the ONNX wasm files are served from (`ortWasmPlugin` in vite.config.ts), as an absolute URL ending in `/`. */
export function webOrtBase(): string {
  const href = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  return new URL(`${baseUrl().replace(/\/?$/, '/')}ort/`, href).href;
}

/** The model host: branding key `speechModelBaseUrl`, empty meaning the default (Hugging Face). */
export function brandedModelBase(): string {
  try {
    const brand = (globalThis as { __BRAND__?: Record<string, unknown> }).__BRAND__;
    const v = brand?.speechModelBaseUrl;
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

/** `IModelFileSource` over the shared asset manager. Installs are pinned: a user asked for them. */
export function webModelFiles(manager: IAssetManager, manifests: readonly AssetManifest[] = whisperManifests()): IModelFileSource {
  const manifestFor = (id: string): AssetManifest | string => manifests.find((m) => m.id === id) ?? id;
  return {
    async isInstalled(assetId) {
      return manager.installed(assetId) !== undefined;
    },
    async install(assetId, onProgress: (p: LoadProgress) => void, signal) {
      await manager.install(manifestFor(assetId), {
        pinned: true,
        signal,
        onProgress: (p) => onProgress({ phase: 'manifest', loaded: p.loaded, total: p.total }),
      });
    },
    read: (assetId, path) => manager.readFile(assetId, path),
    remove: (assetId) => manager.remove(assetId),
  };
}

export interface WebSpeechOptions {
  /** Model host override; default is the branding value, then Hugging Face. */
  modelBase?: string;
  ortBase?: string;
}

/** The speech service for the web app. Registers the model manifests in the asset catalog. */
export async function createWebSpeech(o: WebSpeechOptions = {}): Promise<SpeechService> {
  const modelBase = o.modelBase ?? brandedModelBase();
  const manifests = whisperManifests(modelBase || undefined);
  registerCatalogSource(async () => manifests);
  const manager = await getReadyAssetManager();
  return createSpeechService({
    files: webModelFiles(manager, manifests),
    ortBase: o.ortBase ?? webOrtBase(),
    modelBase: modelBase || undefined,
  });
}
