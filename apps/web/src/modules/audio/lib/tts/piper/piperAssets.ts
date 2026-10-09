/**
 * Piper's files as asset manifests, so the asset manager downloads and verifies them
 * (design 5.4). Files stay at `<assetBase>/...`, the URLs the Piper worker reads, so a
 * voice installed by the manager is a cache hit for the worker.
 *
 * `<assetBase>/index.json` (written by `scripts/fetch-piper-assets.mjs`) is preferred;
 * a deployment without one gets manifests synthesised from the site config, marked
 * `allowUnverified` and of unknown size.
 */

import { parseAssetIndex } from '@bible/core/browser';
import type { AssetManifest, TtsEngineConfig } from '@bible/core/browser';
import { PIPER_RUNTIME_FILES, absoluteUrl, joinUrl } from './piperConfig';

export const PIPER_RUNTIME_ID = 'piper-runtime';

/** The six runtime files the worker loads (the five in `PIPER_RUNTIME_FILES` plus the wasm loader module). */
export const PIPER_RUNTIME_PATHS: readonly string[] = [
  ...Object.values(PIPER_RUNTIME_FILES),
  `${PIPER_RUNTIME_FILES.ortWasm.replace(/[^/]+$/, '')}ort-wasm-simd-threaded.mjs`,
];

export function isPiperAssetId(id: string, config: TtsEngineConfig): boolean {
  return id === PIPER_RUNTIME_ID || config.voices.some((v) => v.id === id);
}

/** Manifests synthesised from the site config, for deployments without `index.json`. */
export function legacyPiperManifests(config: TtsEngineConfig): AssetManifest[] {
  const base = absoluteUrl(config.assetBase);
  const fileOf = (path: string) => ({ path, url: joinUrl(base, path), size: 0 });
  const manifests: AssetManifest[] = [{
    id: PIPER_RUNTIME_ID,
    kind: 'tts-runtime',
    version: '1',
    title: 'Piper speech engine',
    license: 'see project licences',
    size: 0,
    files: PIPER_RUNTIME_PATHS.map(fileOf),
    allowUnverified: true,
  }];
  for (const voice of config.voices) {
    manifests.push({
      id: voice.id,
      kind: 'tts-voice',
      version: '1',
      title: voice.label,
      license: voice.license ?? 'see voice card',
      languages: voice.language ? [voice.language] : undefined,
      size: 0,
      files: voice.files.map(fileOf),
      allowUnverified: true,
    });
  }
  return manifests;
}

export type TextFetcher = (url: string, signal: AbortSignal) => Promise<string | null>;

/** `index.json` next to the files, else the legacy manifests. Never throws on a missing or bad index. */
export async function loadPiperManifests(
  config: TtsEngineConfig,
  getText: TextFetcher,
  signal: AbortSignal = new AbortController().signal,
): Promise<AssetManifest[]> {
  const indexUrl = joinUrl(absoluteUrl(config.assetBase), 'index.json');
  let text: string | null = null;
  try {
    text = await getText(indexUrl, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    text = null;
  }
  if (text !== null) {
    try {
      const { assets } = parseAssetIndex(JSON.parse(text), indexUrl);
      if (assets.length > 0) {
        // Index entries win; configured ids the index does not list still get a legacy manifest.
        const have = new Set(assets.map((a) => a.id));
        return [...assets, ...legacyPiperManifests(config).filter((m) => !have.has(m.id))];
      }
    } catch { /* fall through to legacy */ }
  }
  return legacyPiperManifests(config);
}
