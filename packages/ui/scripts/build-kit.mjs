#!/usr/bin/env node
// Builds the extension UI kit: kit/1/kth-kit.js (classic-script IIFE on preact/compat) and kit/1/kth.css.
//
// One set of esbuild options, three consumers:
//   - `npm run build:kit -w @bible/ui` writes dist-kit/ (gitignored) for inspection and extension testing;
//   - the desktop Vite plugin (apps/desktop/scripts/kthKitPlugin.mjs) calls buildKit({ write: false }) so the
//     bundle is inlined into the main process, with no prebuild step;
//   - packages/ui kitBundle.test.ts checks size, contents and inputs.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = resolve(UI_ROOT, '../core/src');
/** The one core module imported for its side effect: it registers the es and zh-Hans book-name tables. */
const CORE_SIDE_EFFECT_FILES = new Set([resolve(CORE_SRC, 'Data/Locales/registerBuiltinLocalizers.ts')]);

/**
 * `@bible/core/browser` is a barrel over modules that core's package.json does not mark side-effect free, so
 * esbuild would keep unused backup, zip, crypto (hash-wasm, fflate) and copy-service code in the kit. Marking
 * core sources side-effect free lets unused modules drop; the locale registration file stays. Scoped to this
 * build: editing core's `sideEffects` would also change the web and desktop bundles.
 */
const coreTreeShake = {
  name: 'kth-core-tree-shake',
  setup(b) {
    b.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData === 'kth-skip' || args.kind === 'entry-point') return undefined;
      const r = await b.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        namespace: args.namespace,
        resolveDir: args.resolveDir,
        pluginData: 'kth-skip',
      });
      if (r.errors.length || r.warnings.length) return r;
      if (r.path.startsWith(CORE_SRC + '/') && !CORE_SIDE_EFFECT_FILES.has(r.path)) return { ...r, sideEffects: false };
      return r;
    });
  },
};

/**
 * @param {{ outdir?: string, write?: boolean, minify?: boolean }} [options]
 * @returns {Promise<{ js: string, css: string, metafile: import('esbuild').Metafile }>}
 */
export async function buildKit({ outdir = resolve(UI_ROOT, 'dist-kit'), write = true, minify = true } = {}) {
  const result = await build({
    absWorkingDir: UI_ROOT,
    entryPoints: { 'kth-kit': 'src/kit/index.ts', kth: 'src/kit/kit.css' },
    outdir,
    write,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    // Electron 44 is Chromium 13x: es2020 caps the JS syntax, chrome130 stops needless CSS lowering.
    target: ['es2020', 'chrome130'],
    minify,
    sourcemap: false,
    legalComments: 'eof',
    charset: 'utf8',
    tsconfig: resolve(UI_ROOT, 'tsconfig.json'), // its `paths` resolves @bible/core/browser to core source
    jsx: 'automatic',
    jsxImportSource: 'react',
    alias: { react: 'preact/compat', 'react-dom': 'preact/compat' }, // also rewrites react/jsx-runtime, react-dom/client
    define: { 'process.env.NODE_ENV': '"production"' }, // the ONLY define: no host config reaches the kit
    plugins: [coreTreeShake],
    metafile: true,
    logLevel: 'silent',
  });
  const text = (name) =>
    write
      ? readFileSync(resolve(outdir, name), 'utf8')
      : result.outputFiles.find((f) => f.path.endsWith(name))?.text;
  const js = text('kth-kit.js');
  const css = text('kth.css');
  if (!js || !css) throw new Error('buildKit: missing kth-kit.js or kth.css output');
  return { js, css, metafile: result.metafile };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { js, css } = await buildKit();
  console.log(`kth kit: kth-kit.js ${js.length} B, kth.css ${css.length} B -> dist-kit/`);
}
