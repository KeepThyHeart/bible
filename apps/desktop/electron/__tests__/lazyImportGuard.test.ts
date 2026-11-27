/**
 * Guard against the 1.0.0-beta.2 lazy-load bug class (see
 * electron/services/updaterLoader.ts): `await import('some-cjs-package')` in
 * the CommonJS main bundle returns a namespace that may lack the package's
 * named exports, and a mocked unit test cannot see it.
 *
 * Every dynamic `import('<bare specifier>')` under electron/ and extension-runtime/ must be on this
 * list. Adding a package here is a claim that it was checked against the built
 * bundle: add it to PROBES in scripts/check-lazy-imports.mjs too (the check
 * also scans the bundle and fails on any specifier it has no entry for).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_DYNAMIC_IMPORTS = new Set([
  'electron', // special-cased by Electron; provides real named exports
  'dns', 'fs', 'path', 'os', // node builtins
  'unzipper', // lexer-detectable exports (`Open`), verified by check-lazy-imports
  '@huggingface/transformers', // real ESM
  '@jitl/quickjs-singlefile-cjs-release-sync', // extension-runtime reads `ns.default ?? ns`
]);
const ALLOWED_PREFIXES = ['@bible/']; // workspace packages are bundled, not external

const ELECTRON_DIR = path.resolve(__dirname, '..');
const ROOTS = [ELECTRON_DIR, path.resolve(ELECTRON_DIR, '../extension-runtime')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Strip comments so prose that mentions `import('x')` is not a finding. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('lazy import guard', () => {
  it('only dynamically imports vetted packages', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap(sourceFiles)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // `await import('x')` / `import('x').then`; not `typeof import('x')` (types only).
      for (const m of code.matchAll(/(?<!typeof\s)(?<![\w.])import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1];
        if (spec.startsWith('.') || ALLOWED_PREFIXES.some((p) => spec.startsWith(p))) continue;
        if (!ALLOWED_DYNAMIC_IMPORTS.has(spec)) offenders.push(`${path.relative(path.resolve(ELECTRON_DIR, '..'), file)}: import('${spec}')`);
      }
    }
    expect(offenders, 'Load CommonJS packages with require() via pickExport, or vet and allow-list them (see file header)').toEqual([]);
  });

  it('catches the beta.2 pattern', () => {
    const bad = stripComments("updaterModule ??= await import('electron-updater');");
    const hit = [...bad.matchAll(/(?<!typeof\s)(?<![\w.])import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    expect(hit).toEqual(['electron-updater']);
    expect(ALLOWED_DYNAMIC_IMPORTS.has('electron-updater')).toBe(false);
  });
});
