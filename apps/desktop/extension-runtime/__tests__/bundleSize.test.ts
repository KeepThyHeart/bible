/**
 * Bundle size budget check.
 *
 * The runtime injected into each extension worker MUST stay under 50 KB
 * gzipped. The actual bundle is produced by electron-vite at build time;
 * this test enforces a safety margin against the *raw source* of the
 * runtime - gzipped, before any minification - so a regression here will
 * fire long before the production bundle exceeds the budget.
 *
 * If this test ever starts failing, the right move is almost always to
 * delete code, not to bump the budget. The 50 KB limit is in the spec
 * because shipping a fat runtime defeats the per-extension worker model.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

const RUNTIME_DIR = join(__dirname, '..');

/**
 * Only the files that actually end up *inside* the realm count against the
 * budget. `index.ts` (the supervisor) and `resolveEntry.ts` run in the worker
 * process, not the guest, and `host/QuickJSRealm.ts` is host code - none of
 * them are shipped into an extension's realm, so charging them here would
 * measure the wrong thing.
 */
const RUNTIME_FILES = [
  'bootstrap.ts',
  'runtime.ts',
  'apiProxy.ts',
  'eventEmitter.ts',
  'errorBoundary.ts',
  'guest/index.ts',
  'guest/guestGlobals.ts',
];

const BUDGET_GZIPPED_BYTES = 50 * 1024;

describe('extension-runtime bundle size', () => {
  it('total gzipped runtime source stays under the 50 KB spec budget', () => {
    let totalRaw = 0;
    const concatenated: string[] = [];
    for (const f of RUNTIME_FILES) {
      const buf = readFileSync(join(RUNTIME_DIR, f), 'utf8');
      totalRaw += buf.length;
      concatenated.push(buf);
    }
    const gzippedSize = gzipSync(concatenated.join('\n')).length;
    // Print the numbers so a CI failure is self-explanatory.
    // eslint-disable-next-line no-console
    console.log(
      `[runtime size] raw=${totalRaw}B  gzipped=${gzippedSize}B  budget=${BUDGET_GZIPPED_BYTES}B`,
    );
    expect(gzippedSize).toBeLessThan(BUDGET_GZIPPED_BYTES);
  });
});
