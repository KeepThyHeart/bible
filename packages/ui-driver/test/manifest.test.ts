import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { expand, expandDeep, freePort, loadManifest, missingBuild, resolveManifestPath } from '../src/manifest.ts';
import type { Manifest } from '../src/types.ts';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(name: string, body: unknown): string {
  const f = path.join(tmp, name);
  writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
  return f;
}

describe('resolveManifestPath', () => {
  it('defaults to web and resolves app names', () => {
    expect(resolveManifestPath(undefined, repoRoot)).toBe(`${repoRoot}/apps/web/driver.manifest.json`);
    expect(resolveManifestPath('desktop', repoRoot)).toBe(`${repoRoot}/apps/desktop/driver.manifest.json`);
  });
  it('takes .json names and paths as paths', () => {
    const f = write('x.json', {});
    expect(resolveManifestPath(f, repoRoot)).toBe(f);
  });
  it('throws for a missing manifest', () => {
    expect(() => resolveManifestPath('nope', repoRoot)).toThrow(/^no manifest for 'nope' \(looked at .*nope.*\)$/);
  });
});

describe('loadManifest', () => {
  it('validates fields', () => {
    expect(() => loadManifest(write('a.json', '{bad'))).toThrow(/manifest/);
    expect(() => loadManifest(write('b.json', {}))).toThrow(/app must be/);
    expect(() => loadManifest(write('c.json', { app: 'x', kind: 'tui' }))).toThrow(/kind must be/);
    expect(() => loadManifest(write('d.json', { app: 'x', kind: 'web' }))).toThrow(/server is required/);
    expect(() => loadManifest(write('e.json', { app: 'x', kind: 'web', server: { command: 'a', url: 'u' } })))
      .toThrow(/server\.ready\.url/);
    expect(() => loadManifest(write('f.json', { app: 'x', kind: 'electron' }))).toThrow(/electron\.main/);
    expect(() => loadManifest(write('g.json', { app: 'x', kind: 'electron', electron: { main: 'm.js' } }))).not.toThrow();
  });
  it('loads both real manifests', () => {
    const web = loadManifest(resolveManifestPath('web', repoRoot));
    expect(web.kind).toBe('web');
    expect(web.server?.ready.url).toContain('/api/health');
    const desktop = loadManifest(resolveManifestPath('desktop', repoRoot));
    expect(desktop.kind).toBe('electron');
    expect(desktop.electron?.readySelector).toContain('app-loaded');
  });
});

describe('expand', () => {
  const vars = { port: '1234', 'prepare.dataDir': '/d' };
  it('replaces plain and dotted variables', () => {
    expect(expand('http://127.0.0.1:${port}/x ${prepare.dataDir}', vars)).toBe('http://127.0.0.1:1234/x /d');
  });
  it('throws naming an unknown variable', () => {
    expect(() => expand('${nope}', vars)).toThrow('unknown variable ${nope}');
  });
  it('expandDeep walks objects and arrays', () => {
    expect(expandDeep({ a: ['${port}', { b: '${port}' }], n: 3 }, vars)).toEqual({ a: ['1234', { b: '1234' }], n: 3 });
  });
});

describe('missingBuild', () => {
  const m = { app: 'x', kind: 'web', build: { requires: ['dist/i.html'], hint: 'make it' } } as Manifest;
  it('reports a missing file with the hint, then null once present', () => {
    expect(missingBuild(m, tmp)).toMatch(/^not built: .*dist\/i\.html missing\. Run: make it$/);
    mkdirSync(path.join(tmp, 'dist'));
    writeFileSync(path.join(tmp, 'dist/i.html'), '');
    expect(missingBuild(m, tmp)).toBeNull();
    expect(missingBuild({ app: 'x', kind: 'web' } as Manifest, tmp)).toBeNull();
  });
});

describe('freePort', () => {
  it('returns a usable port', async () => {
    const p = await freePort();
    expect(p).toBeGreaterThan(1023);
  });
});
