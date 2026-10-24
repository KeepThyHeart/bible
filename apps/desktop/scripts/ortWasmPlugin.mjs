// Vite plugin: self-hosts the ONNX Runtime wasm backend that @huggingface/transformers loads for the speech
// engine (task 0151). Ported from apps/web/vite.config.ts `ortWasmPlugin`. transformers.js would otherwise
// fetch `ort-wasm-simd-threaded.jsep.{mjs,wasm}` from jsDelivr, which the renderer CSP refuses (and the app
// must work offline). Served at `<base>ort/` in dev, emitted as `ort/<file>` in the renderer build; the
// engine's `ortBase` is `new URL('ort/', document.baseURI)`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ORT_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];

/**
 * @param {string} appDir absolute path of apps/desktop (the config passes its own __dirname)
 * @returns {import('vite').Plugin}
 */
export function ortWasmPlugin(appDir) {
  const dirs = [
    resolve(appDir, 'node_modules/@huggingface/transformers/dist'),
    resolve(appDir, '../../node_modules/@huggingface/transformers/dist'),
  ];
  const readOrt = (name) => {
    for (const dir of dirs) {
      try {
        return readFileSync(resolve(dir, name));
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  };
  return {
    name: 'bible-ort-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].split('/').pop();
        if (!req.url?.includes('/ort/') || !name || !ORT_FILES.includes(name)) return next();
        const data = readOrt(name);
        if (!data) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(data);
      });
    },
    generateBundle() {
      for (const name of ORT_FILES) {
        const data = readOrt(name);
        if (!data) {
          this.warn(`ONNX Runtime asset ${name} not found; the speech engine cannot start without it.`);
          continue;
        }
        this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: data });
      }
    },
  };
}
