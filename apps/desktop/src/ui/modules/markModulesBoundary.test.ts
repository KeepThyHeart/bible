/**
 * Boundary of the measures and keyword-marks modules (task 0127): the host imports none of their
 * code (only `builtinModules.ts` names the two bindings), and the entry-chunk files of each module
 * (manifest, binding, glyph, commands) import no module code beyond each other, so nothing of the
 * feature loads at boot.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const UI_ROOT = resolve(__dirname, '..');
const DESKTOP_ROOT = resolve(UI_ROOT, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'locales' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const specifiers = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import\(|vi\.mock\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('the host does not import the measures or keyword-marks modules', () => {
  const hostFiles = [...walk(join(DESKTOP_ROOT, 'src')), ...walk(join(DESKTOP_ROOT, 'electron'))].filter((f) => {
    const rel = relative(DESKTOP_ROOT, f).replace(/\\/g, '/');
    return !/(^|\/)(modules\/(measures|keyword-marks)|electron\/modules\/keyword-marks)\//.test(rel);
  });

  it('only builtinModules.ts and mainModules.ts name them', () => {
    const offenders: string[] = [];
    for (const f of hostFiles) {
      const rel = relative(DESKTOP_ROOT, f).replace(/\\/g, '/');
      if (/\.test\.tsx?$/.test(rel)) continue;
      for (const spec of specifiers(f)) {
        if (/(^|\/)(measures|keyword-marks)(\/|$)/.test(spec) && spec.startsWith('.')) offenders.push(`${rel} -> ${spec}`);
      }
    }
    expect(offenders.sort()).toEqual([
      'electron/modules/mainModules.ts -> ./keyword-marks/manifest',
      'electron/modules/mainModules.ts -> ./keyword-marks',
      'src/ui/modules/builtinModules.ts -> ./measures/binding',
      'src/ui/modules/builtinModules.ts -> ./keyword-marks/binding',
    ].sort());
  });
});

describe('boot code of each module imports no module code', () => {
  const allowed: Record<string, Record<string, readonly string[]>> = {
    measures: {
      'manifest.ts': [],
      'binding.ts': ['./glyph', './manifest'],
      'glyph.ts': [],
    },
    'keyword-marks': {
      'manifest.ts': [],
      'binding.ts': ['./manifest', './keywordCommands'],
      'keywordCommands.ts': [],
    },
  };

  for (const [dir, files] of Object.entries(allowed)) {
    for (const [file, local] of Object.entries(files)) {
      it(`${dir}/${file}`, () => {
        const own = specifiers(join(UI_ROOT, 'modules', dir, file)).filter((s) => s.startsWith('./'));
        // `import('./module')` etc. are lazy; static local imports must be from the allowed list.
        const src = readFileSync(join(UI_ROOT, 'modules', dir, file), 'utf8');
        const staticLocal = [...src.matchAll(/^import[^'"]*from\s*['"](\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
        expect(staticLocal.sort()).toEqual([...local].sort());
        expect(own.length).toBeGreaterThanOrEqual(staticLocal.length);
      });
    }
  }

  it('the module code is reachable only through lazy loaders in the bindings', () => {
    for (const dir of ['measures', 'keyword-marks']) {
      const src = readFileSync(join(UI_ROOT, 'modules', dir, 'binding.ts'), 'utf8');
      expect(src).toMatch(/load: \(\) => import\('\.\/module'\)/);
    }
  });
});
