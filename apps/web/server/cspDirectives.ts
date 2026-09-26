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
 */

export interface CspAudioOptions {
  enabled: boolean;
  /** Remote origins named in the audio configuration, e.g. `https://audio.example.com`. */
  externalOrigins: string[];
}

export function contentSecurityPolicyDirectives(audio: CspAudioOptions = { enabled: false, externalOrigins: [] }) {
  const external = audio.enabled ? audio.externalOrigins : [];
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
    connectSrc: ["'self'", ...external],
    // Do NOT include upgrade-insecure-requests: it causes browsers to upgrade HTTP
    // requests to HTTPS, breaking local dev servers that serve over plain HTTP.
    upgradeInsecureRequests: null,
  };
  if (audio.enabled) {
    directives.mediaSrc = ["'self'", 'blob:', ...external];
  }
  return directives;
}
