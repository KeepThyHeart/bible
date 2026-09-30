/**
 * Where Piper's files live, shared by the page side (`PiperEngine`) and the
 * worker (`piperHandlers`). `scripts/fetch-piper-assets.mjs` lays the files out
 * to match; change one, change the other.
 *
 *   {assetBase}/runtime/ort.wasm.min.mjs                 ONNX Runtime (JS API)
 *   {assetBase}/runtime/ort-wasm-simd-threaded.mjs       ONNX Runtime (wasm loader)
 *   {assetBase}/runtime/ort-wasm-simd-threaded.wasm      ONNX Runtime (wasm)
 *   {assetBase}/runtime/piper_phonemize.js               espeak-ng phonemizer, as an ES module
 *   {assetBase}/runtime/piper_phonemize.wasm|.data       phonemizer wasm and espeak data
 *   {assetBase}/<voice files from the site config>       e.g. voices/en_US-amy-medium.onnx (+ .onnx.json)
 *
 * Everything is same-origin: the Content-Security-Policy blocks the CDNs the
 * upstream library would otherwise use (cdnjs, jsDelivr, huggingface.co).
 */

export const PIPER_RUNTIME_DIR = 'runtime';

export const PIPER_RUNTIME_FILES = {
  ortModule: `${PIPER_RUNTIME_DIR}/ort.wasm.min.mjs`,
  ortWasm: `${PIPER_RUNTIME_DIR}/ort-wasm-simd-threaded.wasm`,
  phonemizerModule: `${PIPER_RUNTIME_DIR}/piper_phonemize.js`,
  phonemizerWasm: `${PIPER_RUNTIME_DIR}/piper_phonemize.wasm`,
  phonemizerData: `${PIPER_RUNTIME_DIR}/piper_phonemize.data`,
} as const;

/** Language subtags Piper publishes voices for (the site config decides which are actually installed). */
export const PIPER_LANGUAGES = [
  'ar', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'hu', 'is', 'it', 'ka', 'kk',
  'lb', 'ne', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'tr', 'uk', 'vi', 'zh',
];

/** Runtime download plus one medium voice: what the download gate tells the reader about. */
export const PIPER_RUNTIME_BYTES = 29_000_000;

/** `assetBase` + a relative path, with exactly one slash between. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** `assetBase` made absolute against a page or worker location, so both sides key the cache alike. */
export function absoluteUrl(url: string, base: string | undefined = typeof location !== 'undefined' ? location.href : undefined): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
