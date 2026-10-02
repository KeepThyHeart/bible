/**
 * Manifest parsing (task 0090, design 4.8). Pure TypeScript, fail-closed per asset.
 * Used for network input (`/assets/v1/index.json`) and for app-synthesised manifests.
 */

import { ASSET_INDEX_SCHEMA } from './types';
import type { AssetFile, AssetIndex, AssetManifest } from './types';
import { isSha256Hex } from './sha256';

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const KIND_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,40}$/;
const MAX_FILES = 1000;

export interface ParseManifestOptions {
  /** Resolves relative file urls (the index URL for index.json). */
  baseUrl?: string;
  /** Reject a file url that is not already absolute. */
  requireAbsolute?: boolean;
}

export type ParseManifestResult =
  | { ok: true; manifest: AssetManifest }
  | { ok: false; errors: string[] };

export interface ParseIndexResult {
  assets: AssetManifest[];
  rejected: Array<{ index: number; errors: string[] }>;
}

/** Relative POSIX path: no `..`, no leading `/`, no `\`, no empty/`.`/dotfile segments, <= 512 chars. */
export function isSafeAssetPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(path)) return false;
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.' || seg === '..' || seg.startsWith('.')) return false;
  }
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseFile(raw: unknown, i: number, opts: ParseManifestOptions, seen: Set<string>, errors: string[]): AssetFile | null {
  const at = `files[${i}]`;
  if (!isRecord(raw)) { errors.push(`${at}: not an object`); return null; }
  const before = errors.length;
  const path = raw.path;
  if (!isSafeAssetPath(path)) errors.push(`${at}.path: unsafe or invalid path`);
  else if (seen.has(path)) errors.push(`${at}.path: duplicate "${path}"`);
  else seen.add(path);

  const size = raw.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) errors.push(`${at}.size: must be an integer > 0`);

  if (!isSha256Hex(raw.sha256)) errors.push(`${at}.sha256: must be 64 lowercase hex chars`);

  let url = '';
  if (typeof raw.url !== 'string' || raw.url === '') {
    errors.push(`${at}.url: missing`);
  } else {
    let absolute = false;
    try { new URL(raw.url); absolute = true; } catch { /* relative */ }
    if (!absolute && opts.requireAbsolute) {
      errors.push(`${at}.url: must be absolute`);
    } else {
      try {
        const u = opts.baseUrl !== undefined ? new URL(raw.url, opts.baseUrl) : new URL(raw.url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') errors.push(`${at}.url: must be http(s)`);
        else url = u.href;
      } catch {
        errors.push(`${at}.url: invalid`);
      }
    }
  }

  if (raw.contentType !== undefined && typeof raw.contentType !== 'string') errors.push(`${at}.contentType: must be a string`);
  if (errors.length > before) return null;

  const file: AssetFile = { path: path as string, url, size: size as number, sha256: raw.sha256 as string };
  if (typeof raw.contentType === 'string') file.contentType = raw.contentType;
  return file;
}

export function parseAssetManifest(raw: unknown, opts: ParseManifestOptions = {}): ParseManifestResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['manifest: not an object'] };

  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) errors.push('id: invalid');
  if (typeof raw.kind !== 'string' || !KIND_RE.test(raw.kind)) errors.push('kind: invalid');
  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) errors.push('version: invalid');
  if (!nonEmpty(raw.title)) errors.push('title: must be a non-empty string');
  if (!nonEmpty(raw.license)) errors.push('license: must be a non-empty string');
  if (raw.description !== undefined && typeof raw.description !== 'string') errors.push('description: must be a string');
  if (raw.licenseUrl !== undefined && typeof raw.licenseUrl !== 'string') errors.push('licenseUrl: must be a string');
  if (raw.languages !== undefined && !(Array.isArray(raw.languages) && raw.languages.every((l) => typeof l === 'string'))) {
    errors.push('languages: must be an array of strings');
  }
  if (raw.meta !== undefined && !isRecord(raw.meta)) errors.push('meta: must be an object');

  const files: AssetFile[] = [];
  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    errors.push('files: must be a non-empty array');
  } else if (raw.files.length > MAX_FILES) {
    errors.push(`files: more than ${MAX_FILES}`);
  } else {
    const seen = new Set<string>();
    raw.files.forEach((f, i) => {
      const parsed = parseFile(f, i, opts, seen, errors);
      if (parsed) files.push(parsed);
    });
  }

  if (typeof raw.size !== 'number' || !Number.isInteger(raw.size) || raw.size <= 0) {
    errors.push('size: must be an integer > 0');
  } else if (errors.length === 0) {
    const sum = files.reduce((n, f) => n + f.size, 0);
    if (sum !== raw.size) errors.push(`size: ${raw.size} does not equal the sum of files (${sum})`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest: AssetManifest = {
    id: raw.id as string,
    kind: raw.kind as string,
    version: raw.version as string,
    title: raw.title as string,
    license: raw.license as string,
    size: raw.size as number,
    files,
  };
  if (typeof raw.description === 'string') manifest.description = raw.description;
  if (typeof raw.licenseUrl === 'string') manifest.licenseUrl = raw.licenseUrl;
  if (Array.isArray(raw.languages)) manifest.languages = raw.languages.slice() as string[];
  if (isRecord(raw.meta)) manifest.meta = raw.meta;
  // allowUnverified is deliberately never copied from input.
  return { ok: true, manifest };
}

/**
 * Parse `/assets/v1/index.json`. A wrong schema (or a non-object) yields no assets and one
 * rejection with `index: -1`. Each bad asset is rejected alone.
 */
export function parseAssetIndex(json: unknown, indexUrl: string): ParseIndexResult {
  if (!isRecord(json) || json.schema !== ASSET_INDEX_SCHEMA) {
    return { assets: [], rejected: [{ index: -1, errors: [`schema: expected ${ASSET_INDEX_SCHEMA}`] }] };
  }
  if (!Array.isArray(json.assets)) {
    return { assets: [], rejected: [{ index: -1, errors: ['assets: must be an array'] }] };
  }
  const assets: AssetManifest[] = [];
  const rejected: ParseIndexResult['rejected'] = [];
  json.assets.forEach((a, index) => {
    const r = parseAssetManifest(a, { baseUrl: indexUrl });
    if (r.ok) assets.push(r.manifest);
    else rejected.push({ index, errors: r.errors });
  });
  return { assets, rejected };
}

/** Split on `.`/`-`; numeric parts compare numerically, others by string; shorter first on tie. */
export function compareAssetVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    let c: number;
    if (nx && ny) c = Number(x) - Number(y);
    else c = x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return pa.length === pb.length ? 0 : pa.length < pb.length ? -1 : 1;
}

/** sha256sum format (`<hex>  <name>`) or a bare digest: first token, lower-cased, 64-hex, else null. */
export function parseSidecar(text: string): string | null {
  const token = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return isSha256Hex(token) ? token : null;
}

export type { AssetIndex };
