// The PHP and Node static generators must produce identical files.
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
// @ts-expect-error plain ESM script without types
import { licenseAllowed } from '../scripts/build-static.mjs';

const root = resolve(__dirname, '..');
const PHP_SCRIPT = join(root, 'php/verse-hover.php');
const NODE_SCRIPT = join(root, 'scripts/build-static.mjs');
const MINI = join(root, 'test/fixtures/mini.db');
const NC = join(root, 'test/fixtures/mini-nc.db');

function phpDrivers(): string[] {
  const r = spawnSync('php', ['-r', 'echo (extension_loaded("pdo_sqlite")?"pdo,":"").(class_exists("SQLite3")?"sqlite3":"");'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split(',').filter(Boolean);
}
const drivers = phpDrivers();

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      statSync(p).isDirectory() ? walk(p) : out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

function runPhp(driver: string, args: string[]) {
  return spawnSync('php', [PHP_SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, VH_DRIVER: driver } });
}
function runNode(args: string[]) {
  return spawnSync(process.execPath, [NODE_SCRIPT, ...args], { encoding: 'utf8' });
}

const VARIANTS: [string, string[]][] = [
  ['default plain + gzip', ['--gzip']],
  ['plain only', []],
  ['--no-formatting', ['--no-formatting', '--gzip']],
  ['--gzip --no-plain', ['--gzip', '--no-plain']],
];

describe.skipIf(drivers.length === 0)('PHP vs Node static generator', () => {
  for (const driver of drivers) {
    for (const [label, flags] of VARIANTS) {
      it(`byte-identical output (${driver}, ${label})`, () => {
        const a = mkdtempSync(join(tmpdir(), 'vh-php-'));
        const b = mkdtempSync(join(tmpdir(), 'vh-node-'));
        try {
          expect(runPhp(driver, ['build-static', `--db=${MINI}`, `--out=${a}`, ...flags]).status).toBe(0);
          expect(runNode([`--db=${MINI}`, `--out=${b}`, ...flags]).status).toBe(0);
          const fa = files(a);
          expect(fa).toEqual(files(b));
          expect(fa.length).toBeGreaterThanOrEqual(9);
          for (const f of fa) {
            const x = readFileSync(join(a, f));
            const y = readFileSync(join(b, f));
            if (f.endsWith('.gz')) {
              // Compressed bytes may differ between zlib builds; the content must not.
              expect(gunzipSync(x).equals(gunzipSync(y)), f).toBe(true);
              if (!flags.includes('--no-plain')) {
                expect(gunzipSync(x).equals(readFileSync(join(a, f.slice(0, -3)))), f + ' matches plain').toBe(true);
              }
            } else {
              expect(x.equals(y), f).toBe(true);
            }
          }
        } finally {
          rmSync(a, { recursive: true, force: true });
          rmSync(b, { recursive: true, force: true });
        }
      });
    }

    it(`both generators refuse the NC license with exit 2 (${driver})`, () => {
      const a = mkdtempSync(join(tmpdir(), 'vh-nc-'));
      try {
        const p = runPhp(driver, ['build-static', `--db=${NC}`, `--out=${a}`]);
        const n = runNode([`--db=${NC}`, `--out=${a}`]);
        expect(p.status).toBe(2);
        expect(n.status).toBe(2);
        expect(files(a)).toEqual([]);
        expect(runNode([`--db=${NC}`, `--out=${a}`, '--force-license']).status).toBe(0);
      } finally {
        rmSync(a, { recursive: true, force: true });
      }
    });
  }

  it('license allow function agrees between PHP and Node', () => {
    const samples = ['GPL-2.0-or-later', 'Public Domain', 'public-domain', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT', 'Apache-2.0', 'LGPL-3.0',
      'Unlicense', 'CC-BY-3.0', 'PD', 'CC-BY-NC-4.0', 'cc-by-nc-sa-3.0', '', '  ', 'proprietary', 'Limited permitted use', 'All rights reserved', 'CC-BY-ND-4.0', 'AGPL-3.0'];
    const out = execFileSync('php', ['-r', 'define("VH_NO_RUN",1); require $argv[1]; echo json_encode(array_map("vh_license_allowed", json_decode($argv[2])));', PHP_SCRIPT, JSON.stringify(samples)], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(samples.map((s) => licenseAllowed(s)));
  });
});
