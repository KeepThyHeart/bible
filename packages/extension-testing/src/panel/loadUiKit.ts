/**
 * Load the extension UI kit (`kth-*` custom elements) into the CURRENT realm,
 * for tests that render `<kth-reference-picker>` etc. under jsdom.
 *
 * This is test tooling that runs in Node, never shipped to a panel: it
 * evaluates the kit bundle with an indirect `eval`, which is exactly what a
 * classic `<script>` does. The real host serves the same bundle from
 * `ext-ui://host/kit/1/kth-kit.js`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** The kit bundle shipped in this package (`dist/kit/kth-kit.js`, built by `npm run build`). */
export function readBundledUiKit(): string {
  // dist/panel/loadUiKit.js -> dist/kit; src/panel/loadUiKit.ts (this repo's own tests) -> dist/kit.
  const candidates = [
    path.resolve(__dirname, '..', 'kit', 'kth-kit.js'),
    path.resolve(__dirname, '..', '..', 'dist', 'kit', 'kth-kit.js'),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) {
    throw new Error(
      `UI kit bundle not found (looked in ${candidates.join(', ')}). ` +
        'Run `npm run build -w @bible/extension-testing` (or pass your own bundle with loadUiKit({ code })).',
    );
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * Evaluate the kit and return the `KthKit` global. Call `await kit.init({ components: [...] })`
 * (or `{ locale: 'es' }`) afterwards to define elements.
 *
 * Needs a DOM environment (`// @vitest-environment jsdom`), where `window === globalThis`.
 */
export async function loadUiKit(opts: { code?: string } = {}): Promise<unknown> {
  const code = opts.code ?? readBundledUiKit();
  (0, eval)(code);
  const kit = (globalThis as { KthKit?: unknown }).KthKit;
  if (!kit) {
    throw new Error('loadUiKit: the bundle did not define globalThis.KthKit (is a DOM environment active?)');
  }
  return kit;
}
