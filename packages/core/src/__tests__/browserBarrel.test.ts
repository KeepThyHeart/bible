/**
 * Guards `@bible/core/browser`.
 *
 * The browser barrel only earns its keep if it stays free of platform
 * dependencies - a single `import 'fs'` reaching it transitively would break
 * the web client's bundle at build time, far from the edit that caused it.
 * This walks the real import graph from `browser.ts` and asserts that every
 * reachable module is pure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

const BARREL = resolve(__dirname, '../browser.ts');

/** Bare specifiers that must never appear in the browser barrel's graph. */
const FORBIDDEN = [
  'fs', 'node:fs', 'fs/promises', 'node:fs/promises',
  'path', 'node:path',
  'os', 'node:os',
  'crypto', 'node:crypto',
  'child_process', 'node:child_process',
  'better-sqlite3', 'better-sqlite3-multiple-ciphers',
  'electron', 'electron-log',
];

/** Collect every relative import specifier in a source file. */
function importsOf(src: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

function resolveModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // bare specifier - checked separately
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Walk the graph from the barrel, returning every reachable file. */
function walk(entry: string): { files: Set<string>; bare: Map<string, string[]> } {
  const files = new Set<string>();
  const bare = new Map<string, string[]>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    const src = readFileSync(file, 'utf8');
    for (const spec of importsOf(src)) {
      if (spec.startsWith('.')) {
        const target = resolveModule(file, spec);
        if (target && !files.has(target)) queue.push(target);
      } else {
        if (!bare.has(spec)) bare.set(spec, []);
        bare.get(spec)!.push(file);
      }
    }
  }
  return { files, bare };
}

describe('@bible/core/browser barrel', () => {
  it('exists', () => {
    expect(existsSync(BARREL)).toBe(true);
  });

  it('reaches no platform-specific module', () => {
    const { bare } = walk(BARREL);
    const violations: string[] = [];

    for (const [spec, importers] of bare) {
      const bareRoot = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (FORBIDDEN.includes(spec) || FORBIDDEN.includes(bareRoot)) {
        violations.push(`"${spec}" imported by:\n    ${importers.join('\n    ')}`);
      }
    }

    expect(
      violations,
      `The browser barrel must stay bundleable for the web client.\n` +
        `Forbidden imports reachable from browser.ts:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('reaches no bare runtime dependency at all', () => {
    // Stronger than the forbidden-list check: the pure subset should import
    // nothing external whatsoever, so a new dependency has to be considered
    // deliberately rather than slipping in.
    const { bare } = walk(BARREL);
    const external = [...bare.keys()].filter(s => !s.startsWith('.'));
    expect(external, `Unexpected external imports: ${external.join(', ')}`).toEqual([]);
  });

  it('pulls in a bounded set of files', () => {
    // A sanity bound: if this barrel suddenly reaches most of core, someone has
    // exported something that drags the Data layer in behind it. Raised from 25
    // when the passage-format engine (a dozen files) moved in from the desktop
    // renderer; core has ~400 source files, so this is still a bound, not a
    // rubber stamp.
    const { files } = walk(BARREL);
    expect(files.size).toBeGreaterThan(1);
    expect(files.size).toBeLessThan(40);
  });
});
