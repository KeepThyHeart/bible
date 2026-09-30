import { describe, expect, it } from 'vitest';
import {
  compareAssetVersions, isSafeAssetPath, parseAssetIndex, parseAssetManifest, parseSidecar,
} from '../../assets/manifest';
import { ASSET_INDEX_SCHEMA } from '../../assets/types';

const SHA = 'a'.repeat(64);
const INDEX_URL = 'https://example.com/app/assets/v1/index.json';

function asset(over: Record<string, unknown> = {}, file: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'en_US-amy-medium', kind: 'tts-voice', version: '1', title: 'Amy', license: 'MIT', size: 30,
    files: [
      { path: 'voice.onnx', url: 'tts-voice/amy/1/voice.onnx', size: 10, sha256: SHA, ...file },
      { path: 'data/voice.json', url: 'tts-voice/amy/1/voice.json', size: 20, sha256: SHA },
    ],
    ...over,
  };
}
const errs = (raw: unknown, opts = {}) => {
  const r = parseAssetManifest(raw, { baseUrl: INDEX_URL, ...opts });
  return r.ok ? null : r.errors.join('|');
};

describe('isSafeAssetPath', () => {
  it('accepts plain relative paths', () => {
    expect(isSafeAssetPath('voice.onnx')).toBe(true);
    expect(isSafeAssetPath('data/n.bin')).toBe(true);
  });
  it('rejects unsafe paths', () => {
    for (const p of ['', '../x', 'a/../b', '/abs', 'a\\b', '.hidden', 'a/.hidden', 'a//b', './a', 'a/', 'x'.repeat(513)]) {
      expect(isSafeAssetPath(p), p).toBe(false);
    }
    expect(isSafeAssetPath(5)).toBe(false);
  });
});

describe('parseAssetManifest', () => {
  it('parses a valid manifest and resolves relative urls', () => {
    const r = parseAssetManifest(asset({ languages: ['en-US'], meta: { a: 1 } }), { baseUrl: INDEX_URL });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.files[0].url).toBe('https://example.com/app/assets/v1/tts-voice/amy/1/voice.onnx');
      expect(r.manifest.languages).toEqual(['en-US']);
      expect(r.manifest.meta).toEqual({ a: 1 });
    }
  });

  it('rejects bad paths', () => {
    for (const path of ['../x', '/abs', 'a\\b', '.hidden']) {
      expect(errs(asset({}, { path })), path).toMatch(/path/);
    }
  });
  it('rejects duplicate paths', () => {
    const a = asset();
    (a.files as Array<Record<string, unknown>>)[1].path = 'voice.onnx';
    expect(errs(a)).toMatch(/duplicate/);
  });
  it('rejects bad sha, missing sha and bad sizes', () => {
    expect(errs(asset({}, { sha256: 'zz' }))).toMatch(/sha256/);
    expect(errs(asset({}, { sha256: SHA.toUpperCase() }))).toMatch(/sha256/);
    expect(errs(asset({}, { sha256: undefined }))).toMatch(/sha256/);
    expect(errs(asset({}, { size: 0 }))).toMatch(/size/);
    expect(errs(asset({}, { size: 1.5 }))).toMatch(/size/);
  });
  it('rejects a size sum mismatch', () => {
    expect(errs(asset({ size: 31 }))).toMatch(/sum/);
    expect(errs(asset({ size: 0 }))).toMatch(/size/);
  });
  it('rejects bad id, kind, version, title, license, files', () => {
    expect(errs(asset({ id: '-x' }))).toMatch(/id/);
    expect(errs(asset({ id: 'a/b' }))).toMatch(/id/);
    expect(errs(asset({ kind: 'Bad Kind' }))).toMatch(/kind/);
    expect(errs(asset({ version: 'a b' }))).toMatch(/version/);
    expect(errs(asset({ version: '' }))).toMatch(/version/);
    expect(errs(asset({ title: ' ' }))).toMatch(/title/);
    expect(errs(asset({ license: '' }))).toMatch(/license/);
    expect(errs(asset({ files: [] }))).toMatch(/files/);
    expect(errs('x')).toMatch(/object/);
  });
  it('rejects non-http urls', () => {
    expect(errs(asset({}, { url: 'ftp://x/y' }))).toMatch(/http/);
    expect(errs(asset({}, { url: 'javascript:alert(1)' }))).toMatch(/http/);
  });
  it('requireAbsolute rejects relative urls only', () => {
    expect(errs(asset(), { requireAbsolute: true })).toMatch(/absolute/);
    const ok = asset({}, { url: 'https://cdn.example.com/v.onnx' });
    (ok.files as Array<Record<string, unknown>>)[1].url = 'https://cdn.example.com/v.json';
    expect(errs(ok, { requireAbsolute: true })).toBeNull();
  });
  it('relative url without a base fails', () => {
    const r = parseAssetManifest(asset());
    expect(r.ok).toBe(false);
  });
  it('drops allowUnverified', () => {
    const r = parseAssetManifest(asset({ allowUnverified: true }), { baseUrl: INDEX_URL });
    expect(r.ok && 'allowUnverified' in r.manifest).toBe(false);
  });
});

describe('parseAssetIndex', () => {
  it('parses assets and keeps good ones when one is rejected', () => {
    const bad = asset({ id: 'bad', size: 1 });
    const r = parseAssetIndex({ schema: ASSET_INDEX_SCHEMA, assets: [asset(), bad, asset({ id: 'two' })] }, INDEX_URL);
    expect(r.assets.map((a) => a.id)).toEqual(['en_US-amy-medium', 'two']);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].index).toBe(1);
  });
  it('rejects a wrong schema or shape', () => {
    expect(parseAssetIndex({ schema: 'nope', assets: [asset()] }, INDEX_URL).assets).toEqual([]);
    expect(parseAssetIndex(null, INDEX_URL).assets).toEqual([]);
    expect(parseAssetIndex({ schema: ASSET_INDEX_SCHEMA }, INDEX_URL).assets).toEqual([]);
  });
  it('drops allowUnverified from network input', () => {
    const r = parseAssetIndex({ schema: ASSET_INDEX_SCHEMA, assets: [asset({ allowUnverified: true })] }, INDEX_URL);
    expect('allowUnverified' in r.assets[0]).toBe(false);
  });
});

describe('compareAssetVersions', () => {
  it('orders numerically', () => {
    expect(compareAssetVersions('1.10', '1.9')).toBe(1);
    expect(compareAssetVersions('1.9', '1.10')).toBe(-1);
    expect(compareAssetVersions('2', '1.0')).toBe(1);
    expect(compareAssetVersions('1.0', '1.0')).toBe(0);
  });
  it('shorter first on tie, stable for prereleases', () => {
    expect(compareAssetVersions('1', '1.0')).toBe(-1);
    expect(compareAssetVersions('1.0', '1.0-beta')).toBe(-1);
    expect(compareAssetVersions('1.0-beta', '1.0-rc')).toBe(-1);
    const list = ['1.0-rc', '1.0', '1.0-beta', '0.9'];
    const a = [...list].sort(compareAssetVersions);
    expect(a).toEqual([...list].reverse().sort(compareAssetVersions));
    expect(a[0]).toBe('0.9');
  });
});

describe('parseSidecar', () => {
  it('reads sha256sum format and bare digests, lower-casing', () => {
    expect(parseSidecar(`${SHA}  voice.onnx\n`)).toBe(SHA);
    expect(parseSidecar(`  ${SHA.toUpperCase()}\n`)).toBe(SHA);
  });
  it('returns null for junk', () => {
    expect(parseSidecar('')).toBeNull();
    expect(parseSidecar('<html>404</html>')).toBeNull();
    expect(parseSidecar('abc123')).toBeNull();
  });
});
