/**
 * Test helper: build the QuickJS guest runtime bundle.
 *
 * Mirrors the esbuild step in `electron.vite.config.ts` exactly - same entry,
 * same `platform: 'neutral'`, same target - so a test that passes here is
 * testing the artifact production actually ships. The build is memoised
 * because it costs ~200 ms and every realm test needs the same bytes.
 *
 * The one deliberate difference is minification, which is off by default so a
 * failing realm test shows readable guest source. Production minifies, so
 * `buildGuestBundle({ minify: true })` exists to test that configuration where
 * it matters - see `minifiedGuest.test.ts`.
 */

import { build } from 'esbuild';
import { resolve } from 'path';

const ENTRY = resolve(__dirname, '../guest/index.ts');
const CORE_SRC = resolve(__dirname, '../../../../packages/core/src');

const cached = new Map<boolean, string>();

export async function buildGuestBundle(opts: { minify?: boolean } = {}): Promise<string> {
  const minify = opts.minify ?? false;
  const hit = cached.get(minify);
  if (hit !== undefined) return hit;

  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    target: 'es2020',
    mainFields: ['module', 'main'],
    conditions: ['import', 'default'],
    minify,
    sourcemap: false,
    legalComments: 'none',
    alias: { '@bible/core': CORE_SRC },
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no guest bundle');
  cached.set(minify, out.text);
  return out.text;
}
