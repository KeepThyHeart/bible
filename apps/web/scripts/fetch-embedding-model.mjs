#!/usr/bin/env node
/**
 * Fetch the ONNX embedding model for browser-side (client) semantic search and
 * store it in the served data directory so the app can load it from our own
 * server instead of the HuggingFace CDN (offline-capable, no external dependency).
 *
 * Files land in:  <dataDir>/models/nomic-ai/nomic-embed-text-v1.5/...
 * which the server exposes at:  /data/models/nomic-ai/nomic-embed-text-v1.5/...
 *
 * The worker (src/search/searchWorker.ts) points transformers.js at
 * `${origin}/data/models` via env.remoteHost, using dtype 'q8' → model_quantized.onnx.
 *
 * Only needed for `search.mode: "browser"` (the default). When `site-config.json`
 * sets `search.mode` to `"server"` or `"off"`, the browser worker never loads this
 * model, so the fetch is skipped. Set SKIP_MODEL_FETCH=1 to force-skip regardless
 * of config (e.g. offline setup, CI without network access).
 *
 * This is a best-effort download, not a hard build requirement: a missing or
 * failed model just means semantic ("Ideas") search degrades gracefully at
 * runtime (the worker reports an error and the app falls back to lexical
 * search) rather than blocking `npm run build`/`npm install` when offline.
 *
 * Idempotent: files already present (non-empty) are skipped, so re-running during
 * repeat builds is cheap. Set FORCE_MODEL_FETCH=1 to re-download everything.
 *
 * Usage:
 *   node scripts/fetch-embedding-model.mjs
 *   BIBLE_DATA_DIR=/srv/bible/data node scripts/fetch-embedding-model.mjs
 *   SKIP_MODEL_FETCH=1 node scripts/fetch-embedding-model.mjs
 */

import { createWriteStream, existsSync, mkdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';
const REVISION = 'main';
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}`;

// Files required by transformers.js feature-extraction at dtype 'q8'.
// `optional` files are skipped without failing the build if the repo lacks them.
const FILES = [
  { path: 'config.json' },
  { path: 'tokenizer.json' },
  { path: 'tokenizer_config.json' },
  { path: 'special_tokens_map.json' },
  { path: 'vocab.txt', optional: true },
  { path: 'onnx/model_quantized.onnx' }, // the q8 weights (~130 MB)
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, '..');
// The same default as the server (server/index.ts): the repo-root data/, which
// is what it serves at /data.
const dataDir = process.env.BIBLE_DATA_DIR || resolve(webRoot, '../../data');
const modelDir = join(dataDir, 'models', ...MODEL_ID.split('/'));
const force = process.env.FORCE_MODEL_FETCH === '1';
const skip = process.env.SKIP_MODEL_FETCH === '1';

function log(msg) { process.stdout.write(`[fetch-model] ${msg}\n`); }

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Minimal, read-only mirror of SiteConfig's `search.mode` resolution (see
 * server/SiteConfig.ts), just enough to decide whether the browser-side model
 * is needed. Checks `site-config.json` first, then the legacy standalone
 * `server-config.json` for backward compatibility. Defaults to 'browser',
 * matching the server.
 */
function resolveSearchMode() {
  const siteConfig = readJson(resolve(dataDir, 'site-config.json'));
  const rawMode = siteConfig?.search?.mode;
  if (rawMode === 'server' || rawMode === 'off') return rawMode;
  if (rawMode === 'browser') return 'browser';

  const legacy = readJson(resolve(dataDir, 'server-config.json'));
  const legacyMode = legacy?.searchMode;
  if (legacyMode === 'server' || legacyMode === 'off' || legacyMode === 'browser') {
    return legacyMode;
  }

  return 'browser';
}

async function download(file) {
  const dest = join(modelDir, file.path);
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    log(`skip (exists): ${file.path}`);
    return true;
  }

  const url = `${HF_BASE}/${file.path}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    if (file.optional && res.status === 404) {
      log(`skip (optional, not in repo): ${file.path}`);
      return true;
    }
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    await streamPipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    // Atomic-ish rename via copy: rmSync then rename to avoid partial files on crash
    rmSync(dest, { force: true });
    const { renameSync } = await import('node:fs');
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }

  const mb = (statSync(dest).size / 1024 / 1024).toFixed(1);
  log(`downloaded: ${file.path} (${mb} MB)`);
  return true;
}

async function main() {
  if (skip) {
    log('skipping: SKIP_MODEL_FETCH=1');
    return;
  }

  const mode = resolveSearchMode();
  if (mode !== 'browser') {
    log(`skipping: search.mode is '${mode}' (browser-side model only needed for 'browser' mode)`);
    return;
  }

  log(`model:   ${MODEL_ID}@${REVISION}`);
  log(`target:  ${modelDir}`);
  mkdirSync(modelDir, { recursive: true });

  for (const file of FILES) {
    await download(file);
  }

  log('done. Model available for self-hosted browser search.');
}

main().catch((err) => {
  // Best-effort only: don't fail `npm install`/`npm run build` just because the
  // model couldn't be fetched (offline, no network, HuggingFace unreachable,
  // etc.). Semantic search degrades gracefully at runtime instead; everything
  // else about the site still works.
  console.warn(`[fetch-model] WARNING: could not fetch embedding model: ${err.message}`);
  console.warn('[fetch-model] Semantic ("Ideas") search will be unavailable until this succeeds; the rest of the site is unaffected.');
});
