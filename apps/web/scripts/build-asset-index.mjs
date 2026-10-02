#!/usr/bin/env node
/**
 * Build `v1/index.json` (and `<file>.sha256` sidecars) for the asset store (task 0090).
 *
 *   node scripts/build-asset-index.mjs [--dir=<data>/assets] [--check]
 *
 * Layout under `<dir>/v1/`:
 *   <kind>/<id>/<version>/asset.json      optional {title, description, license, licenseUrl, languages, meta}
 *   <kind>/<id>/<version>/<path...>       the asset's files (any depth)
 *   <kind>/<id>/<version>/<path...>.sha256  written here as `<hex>  <basename>\n`
 *
 * `license` is required: an asset without one is skipped with an error (exit 1).
 * Only the newest version of each id goes into the index. `--check` writes nothing
 * and exits 1 when the index or a sidecar is stale.
 *
 * Pure Node. The name/version rules below DUPLICATE packages/core/src/assets/manifest.ts
 * (ID_RE, KIND_RE, VERSION_RE, isSafeAssetPath, compareAssetVersions): keep them in sync.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INDEX_SCHEMA = 'kth-asset-index/1';

// --- duplicated from core (manifest.ts) ---
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const KIND_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,40}$/;

export function compareAssetVersions(a, b) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    let c;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) c = Number(x) - Number(y);
    else c = x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return pa.length === pb.length ? 0 : pa.length < pb.length ? -1 : 1;
}
// --- end duplicated rules ---

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
};

/** Streamed SHA-256 and size of a file. */
export async function hashFile(path) {
  const hash = createHash('sha256');
  let size = 0;
  await new Promise((res, rej) => {
    const s = createReadStream(path);
    s.on('data', chunk => { hash.update(chunk); size += chunk.length; });
    s.on('error', rej);
    s.on('end', res);
  });
  return { sha256: hash.digest('hex'), size };
}

function sidecarText(sha256, file) {
  return `${sha256}  ${basename(file)}\n`;
}

/** Write `<file>.sha256` when missing or stale. Returns true when it wrote (or, with `dryRun`, would have). */
export function writeSidecar(file, sha256, { dryRun = false } = {}) {
  const side = `${file}.sha256`;
  const want = sidecarText(sha256, file);
  if (existsSync(side) && readFileSync(side, 'utf8').trim().split(/\s+/)[0]?.toLowerCase() === sha256) return false;
  if (!dryRun) {
    const tmp = `${side}.tmp`;
    writeFileSync(tmp, want);
    renameSync(tmp, side);
  }
  return true;
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function subdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
}

/** Asset files of a version dir, relative POSIX paths, sorted. */
function listFiles(root, rel = '') {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(root, r));
    else if (e.isFile() && !e.name.endsWith('.sha256') && !e.name.endsWith('.tmp') && !(rel === '' && e.name === 'asset.json')) out.push(r);
  }
  return out.sort();
}

const enc = path => path.split('/').map(encodeURIComponent).join('/');

/**
 * Scan `<dir>/v1` and write the index and sidecars (or only report with `check`).
 * @returns {{index: object, warnings: string[], errors: string[], stale: string[]}}
 */
export async function buildAssetIndex({ dir, check = false } = {}) {
  const v1 = join(resolve(dir), 'v1');
  const warnings = [];
  const errors = [];
  const stale = [];
  /** id -> newest candidate */
  const best = new Map();

  for (const kind of subdirs(v1)) {
    if (!KIND_RE.test(kind)) { warnings.push(`skipped kind "${kind}": invalid name`); continue; }
    for (const id of subdirs(join(v1, kind))) {
      if (!ID_RE.test(id)) { warnings.push(`skipped ${kind}/${id}: invalid id`); continue; }
      for (const version of subdirs(join(v1, kind, id))) {
        if (!VERSION_RE.test(version)) { warnings.push(`skipped ${kind}/${id}/${version}: invalid version`); continue; }
        const cur = best.get(id);
        if (!cur || compareAssetVersions(version, cur.version) > 0) best.set(id, { kind, id, version });
      }
    }
  }

  const assets = [];
  for (const { kind, id, version } of best.values()) {
    const root = join(v1, kind, id, version);
    let meta = {};
    const metaPath = join(root, 'asset.json');
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch (e) { errors.push(`${kind}/${id}/${version}/asset.json: ${e.message}`); continue; }
    }
    if (typeof meta.license !== 'string' || !meta.license.trim()) {
      errors.push(`${kind}/${id}/${version}: asset.json needs a "license" (nothing is published without one)`);
      continue;
    }
    const files = [];
    for (const path of listFiles(root)) {
      if (path.split('/').some(s => s.includes('\\') || s.includes('\u0000'))) { warnings.push(`skipped file ${kind}/${id}/${version}/${path}: unsafe name`); continue; }
      const full = join(root, path);
      const { sha256, size } = await hashFile(full);
      if (size === 0) { warnings.push(`skipped empty file ${kind}/${id}/${version}/${path}`); continue; }
      if (writeSidecar(full, sha256, { dryRun: check })) stale.push(`${kind}/${id}/${version}/${path}.sha256`);
      const f = { path, url: `${enc(kind)}/${enc(id)}/${enc(version)}/${enc(path)}`, size, sha256 };
      const ct = CONTENT_TYPES[path.slice(path.lastIndexOf('.')).toLowerCase()];
      if (ct) f.contentType = ct;
      files.push(f);
    }
    if (files.length === 0) { warnings.push(`skipped ${kind}/${id}/${version}: no files`); continue; }
    const m = { id, kind, version, title: typeof meta.title === 'string' && meta.title ? meta.title : id };
    if (meta.description) m.description = meta.description;
    m.license = meta.license;
    if (meta.licenseUrl) m.licenseUrl = meta.licenseUrl;
    if (Array.isArray(meta.languages) && meta.languages.length) m.languages = meta.languages;
    m.size = files.reduce((n, f) => n + f.size, 0);
    m.files = files;
    if (meta.meta && typeof meta.meta === 'object') m.meta = meta.meta;
    assets.push(m);
  }
  assets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const indexPath = join(v1, 'index.json');
  let previous = null;
  try { previous = JSON.parse(readFileSync(indexPath, 'utf8')); } catch { /* none or unreadable */ }
  const same = previous && previous.schema === INDEX_SCHEMA && JSON.stringify(previous.assets) === JSON.stringify(assets);
  const index = { schema: INDEX_SCHEMA, generatedAt: same && previous.generatedAt ? previous.generatedAt : new Date().toISOString(), assets };
  if (!same) {
    stale.push('index.json');
    if (!check) writeAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
  return { index, warnings, errors, stale };
}

async function main() {
  let dir = null;
  let check = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--dir=')) dir = a.slice(6);
    else if (a === '--check') check = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  if (!dir) {
    const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    dir = join(process.env.BIBLE_DATA_DIR || resolve(webRoot, '../../data'), 'assets');
  }
  const { index, warnings, errors, stale } = await buildAssetIndex({ dir, check });
  for (const w of warnings) console.warn(`[asset-index] warning: ${w}`);
  for (const e of errors) console.error(`[asset-index] error: ${e}`);
  if (check) {
    for (const s of stale) console.error(`[asset-index] stale: ${s}`);
    process.exit(stale.length || errors.length ? 1 : 0);
  }
  console.log(`[asset-index] ${index.assets.length} asset(s) in ${join(dir, 'v1', 'index.json')}`);
  if (errors.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(`[asset-index] ERROR: ${err.message}`); process.exit(1); });
}
