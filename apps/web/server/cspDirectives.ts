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
 */

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

export function contentSecurityPolicyDirectives(
  audio: CspAudioOptions = { enabled: false, externalOrigins: [] },
  speech: CspSpeechOptions = { enabled: false, externalOrigins: [] },
  /** Origin of bibsearch when the browser calls it directly (`search.remote.via: 'browser'`), else null. */
  remoteSearchOrigin: string | null = null,
) {
  const external = audio.enabled ? audio.externalOrigins : [];
  const speechOrigins = speech.enabled ? speech.externalOrigins : [];
  const directives: Record<string, Iterable<string> | null> = {
    defaultSrc: ["'self'"],
    // 'unsafe-inline' is required for the error-fallback inline script in index.html.
    // The hash alternative would require rebuilding the client on every change.
    // 'wasm-unsafe-eval' lets WebAssembly compile. Without it the browser
    // refuses to instantiate any wasm module, which kills the wa-sqlite
    // worker behind offline module storage and the in-browser search index
    // ("Refused to compile or instantiate WebAssembly module"). It is the
    // narrow directive for exactly this — it does NOT re-enable eval() for
    // JavaScript, unlike 'unsafe-eval'.
    scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
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
