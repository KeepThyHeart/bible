/**
 * The Content-Security-Policy directives, in one place so they can be tested.
 *
 * The default policy allows nothing outside this origin, which is what the
 * privacy posture relies on. It changes only when the Audio Bible is switched
 * on, and then by exactly this much:
 *
 *  - `media-src` gains `blob:`. On-device speech is synthesized into WAV blobs
 *    and cached recordings are replayed from blob URLs; without `blob:` the
 *    browser refuses to play either. (`default-src 'self'` would otherwise be
 *    the fallback for media.) A blob is created by our own page script, so this
 *    admits no third-party content.
 *  - `media-src` and `connect-src` gain the origins the operator explicitly
 *    configured for recordings or engine files (`audio.base`, an engine's
 *    `assetBase`), and no others.
 *
 * The on-device speech engine (feature `recite`, task 0151) downloads its models, once and on request,
 * from the model host. It changes the policy only when switched on, and then only `connect-src` gains
 * that host's origins (`speechModelOrigins`). Microphone access and the engine's worker and wasm
 * need no change: they are same-origin, and `'wasm-unsafe-eval'` is already allowed.
 *
 * Remote semantic search with `via: 'browser'` adds one more `connect-src`
 * origin: the bibsearch service itself. With `via: 'server'` nothing changes.
 *
 * Inline scripts are allowed by hash, not by `'unsafe-inline'`: the built HTML
 * pages carry a few small inline scripts (the brand JSON, the error fallback),
 * and `inlineScriptHashes` reads their hashes from the build at startup, so an
 * injected `<script>` cannot run. `'unsafe-inline'` comes back only when there
 * is no build to read (the Vite dev server serves the pages itself).
 */

import { readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

export interface CspAudioOptions {
  enabled: boolean;
  /** Remote origins named in the audio configuration, e.g. `https://audio.example.com`. */
  externalOrigins: string[];
}

export interface CspSpeechOptions {
  enabled: boolean;
  /** Origins the model files are fetched from; see `speechModelOrigins`. */
  externalOrigins: string[];
}

/** Hugging Face's download host, which redirects `huggingface.co/.../resolve/...` to its CDNs. */
export const HUGGING_FACE_ORIGINS = ['https://huggingface.co', 'https://cdn-lfs.hf.co', 'https://cas-bridge.xethub.hf.co'];

/**
 * The origins to allow for a model host (the branding key `speechModelBaseUrl`): empty means the
 * default (Hugging Face and its CDNs); a mirror needs only its own origin. An unparsable value allows nothing.
 */
export function speechModelOrigins(modelBase: string | undefined): string[] {
  const base = (modelBase ?? '').trim();
  if (!base) return [...HUGGING_FACE_ORIGINS];
  try {
    const u = new URL(base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? [u.origin] : [];
  } catch {
    return [];
  }
}

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * CSP source expressions (`'sha256-...'`) for every inline `<script>` in the
 * HTML files under `clientDir`, recursively. Scripts with `src` are skipped:
 * `'self'` covers them. Read once at startup, so a rebuilt client needs a
 * restart, which every deploy does anyway. Empty when `clientDir` is missing.
 */
export function inlineScriptHashes(clientDir: string | undefined): string[] {
  if (!clientDir) return [];
  const hashes = new Set<string>();
  const walk = (dir: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'assets') walk(path);
      } else if (entry.name.endsWith('.html')) {
        for (const [, attrs, body] of readFileSync(path, 'utf-8').matchAll(INLINE_SCRIPT)) {
          if (/\bsrc\s*=/i.test(attrs)) continue;
          hashes.add(`'sha256-${createHash('sha256').update(body, 'utf-8').digest('base64')}'`);
        }
      }
    }
  };
  walk(clientDir);
  return [...hashes].sort();
}

export function contentSecurityPolicyDirectives(
  audio: CspAudioOptions = { enabled: false, externalOrigins: [] },
  speech: CspSpeechOptions = { enabled: false, externalOrigins: [] },
  /** Origin of bibsearch when the browser calls it directly (`search.remote.via: 'browser'`), else null. */
  remoteSearchOrigin: string | null = null,
  /** From `inlineScriptHashes`; empty falls back to `'unsafe-inline'`. */
  scriptHashes: string[] = [],
) {
  const external = audio.enabled ? audio.externalOrigins : [];
  const speechOrigins = speech.enabled ? speech.externalOrigins : [];
  const directives: Record<string, Iterable<string> | null> = {
    defaultSrc: ["'self'"],
    // Inline scripts by hash (see the note at the top); 'unsafe-inline' only
    // when there are no built pages to hash.
    // 'wasm-unsafe-eval' lets WebAssembly compile. Without it the browser
    // refuses to instantiate any wasm module, which kills the wa-sqlite
    // worker behind offline module storage and the in-browser search index
    // ("Refused to compile or instantiate WebAssembly module"). It is the
    // narrow directive for exactly this — it does NOT re-enable eval() for
    // JavaScript, unlike 'unsafe-eval'.
    scriptSrc: ["'self'", ...(scriptHashes.length > 0 ? scriptHashes : ["'unsafe-inline'"]), "'wasm-unsafe-eval'"],
    // No external origins: reading fonts are self-hosted under /fonts (see
    // scripts/fetch-fonts.mjs) and Font Awesome is bundled from node_modules
    // (see the comment in src/main.tsx). The Google Fonts and cdnjs
    // allowances these directives used to carry are both dead.
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", ...new Set([...external, ...speechOrigins, ...(remoteSearchOrigin ? [remoteSearchOrigin] : [])])],
    // Do NOT include upgrade-insecure-requests: it causes browsers to upgrade HTTP
    // requests to HTTPS, breaking local dev servers that serve over plain HTTP.
    upgradeInsecureRequests: null,
  };
  if (audio.enabled) {
    directives.mediaSrc = ["'self'", 'blob:', ...external];
  }
  return directives;
}
