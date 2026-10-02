/**
 * The recite/ module is bundled into the QuickJS extension runtime: its import
 * graph must stay inside recite/ (plus type-only imports), and its sources must
 * avoid constructs QuickJS lacks or that break determinism.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';

const RECITE = resolve(__dirname, '../../recite');
const BARREL = join(RECITE, 'index.ts');

function sourcesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourcesIn(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

interface Import {
  spec: string;
  typeOnly: boolean;
}

function importsOf(src: string): Import[] {
  const out: Import[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ spec: m[4], typeOnly: m[2] !== undefined });
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(src)) !== null) out.push({ spec: m[1], typeOnly: false });
  const dyn = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(src)) !== null) out.push({ spec: m[1], typeOnly: false });
  return out;
}

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c)) return c;
  return null;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('recite/ safety', () => {
  it('runtime import graph stays inside recite/', () => {
    const seen = new Set<string>();
    const queue = [BARREL];
    while (queue.length > 0) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const imp of importsOf(readFileSync(f, 'utf8'))) {
        if (imp.typeOnly) {
          // Type-only: recite/ or ../speech/types, nothing else.
          expect(imp.spec.startsWith('.'), `${f}: ${imp.spec}`).toBe(true);
          continue;
        }
        expect(imp.spec.startsWith('.'), `${f} imports bare ${imp.spec}`).toBe(true);
        const target = resolveModule(f, imp.spec);
        expect(target, `${f} cannot resolve ${imp.spec}`).not.toBeNull();
        expect(target!.startsWith(RECITE + '/'), `${f} reaches outside recite/: ${imp.spec}`).toBe(true);
        queue.push(target!);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('type-only imports reach only speech/types', () => {
    for (const f of sourcesIn(RECITE)) {
      for (const imp of importsOf(readFileSync(f, 'utf8'))) {
        if (!imp.typeOnly) continue;
        const target = resolveModule(f, imp.spec);
        expect(target, `${f}: ${imp.spec}`).not.toBeNull();
        const inside = target!.startsWith(RECITE + '/');
        const speechTypes = target === resolve(RECITE, '../speech/types.ts');
        expect(inside || speechTypes, `${f}: ${imp.spec}`).toBe(true);
      }
    }
  });

  const BANNED: [string, RegExp][] = [
    ['Intl', /\bIntl\b/],
    ['String.prototype.normalize', /\.normalize\s*\(/],
    ['regex lookbehind', /\(\?<[=!]/],
    ['\\p{} property escape', /\\[pP]\{/],
    ['Date', /\bDate\b/],
    ['performance', /\bperformance\b/],
    ['Math.random', /Math\.random/],
    ['crypto', /\bcrypto\b/],
    ['Node globals', /\b(?:process|Buffer|__dirname|require)\b/],
    ['console', /\bconsole\./],
  ];

  it('sources avoid banned constructs', () => {
    for (const f of sourcesIn(RECITE)) {
      const code = stripComments(readFileSync(f, 'utf8'));
      for (const [name, re] of BANNED) {
        expect(re.test(code), `${f} uses ${name}`).toBe(false);
      }
    }
  });

  it('every source carries an SPDX header', () => {
    for (const f of sourcesIn(RECITE)) {
      expect(readFileSync(f, 'utf8').split('\n')[0] + readFileSync(f, 'utf8').slice(0, 200), f).toContain('SPDX-License-Identifier');
    }
  });
});
