import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// The scripts are plain .mjs with no type declarations.
async function load(name: string): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../scripts', name)).href);
}

let dir: string;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function put(rel: string, body: string) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'asset-index-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('build-asset-index', () => {
  it('builds the index, sidecars and picks the newest version', async () => {
    const { buildAssetIndex } = await load('build-asset-index.mjs');
    put('v1/data/nbr/1.9/asset.json', '{"license":"CC0","title":"Old"}');
    put('v1/data/nbr/1.9/n.bin', 'old');
    put('v1/data/nbr/1.10/asset.json', '{"title":"Neighbours","license":"CC0","languages":["en"]}');
    put('v1/data/nbr/1.10/sub/n.bin', 'new bytes');
    put('v1/data/nbr/1.10/sub/n b.json', '{}');
    const { index, errors, stale } = await buildAssetIndex({ dir });
    expect(errors).toEqual([]);
    expect(stale).toContain('index.json');
    expect(index.schema).toBe('kth-asset-index/1');
    expect(index.assets).toHaveLength(1);
    const a = index.assets[0];
    expect(a.version).toBe('1.10');
    expect(a.title).toBe('Neighbours');
    expect(a.size).toBe(a.files.reduce((n: number, f: any) => n + f.size, 0));
    const f = a.files.find((x: any) => x.path === 'sub/n.bin');
    expect(f).toMatchObject({ url: 'data/nbr/1.10/sub/n.bin', size: 9, sha256: sha('new bytes') });
    expect(a.files.find((x: any) => x.path === 'sub/n b.json').url).toBe('data/nbr/1.10/sub/n%20b.json');
    expect(readFileSync(join(dir, 'v1/data/nbr/1.10/sub/n.bin.sha256'), 'utf8')).toBe(`${sha('new bytes')}  n.bin\n`);
    expect(JSON.parse(readFileSync(join(dir, 'v1/index.json'), 'utf8')).assets).toEqual(index.assets);
  });

  it('refuses an asset without a licence and skips invalid names', async () => {
    const { buildAssetIndex } = await load('build-asset-index.mjs');
    put('v1/data/nolic/1/asset.json', '{"title":"x"}');
    put('v1/data/nolic/1/f.bin', 'x');
    put('v1/data/bad id/1/asset.json', '{"license":"MIT"}');
    put('v1/data/bad id/1/f.bin', 'x');
    const { index, errors, warnings } = await buildAssetIndex({ dir });
    expect(index.assets).toEqual([]);
    expect(errors.join()).toContain('license');
    expect(warnings.join()).toContain('bad id');
  });

  it('--check writes nothing and reports staleness; a second build is clean', async () => {
    const { buildAssetIndex } = await load('build-asset-index.mjs');
    put('v1/data/d/1/asset.json', '{"license":"MIT"}');
    put('v1/data/d/1/f.bin', 'abc');
    const dry = await buildAssetIndex({ dir, check: true });
    expect(dry.stale.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'v1/index.json'))).toBe(false);
    expect(existsSync(join(dir, 'v1/data/d/1/f.bin.sha256'))).toBe(false);
    await buildAssetIndex({ dir });
    expect((await buildAssetIndex({ dir, check: true })).stale).toEqual([]);
    put('v1/data/d/1/f.bin', 'changed');
    expect((await buildAssetIndex({ dir, check: true })).stale).toContain('data/d/1/f.bin.sha256');
    await buildAssetIndex({ dir });
    expect(readFileSync(join(dir, 'v1/data/d/1/f.bin.sha256'), 'utf8')).toContain(sha('changed'));
  });

  it('hashFile and writeSidecar', async () => {
    const { hashFile, writeSidecar } = await load('build-asset-index.mjs');
    put('x.bin', 'hello');
    expect(await hashFile(join(dir, 'x.bin'))).toEqual({ sha256: sha('hello'), size: 5 });
    expect(writeSidecar(join(dir, 'x.bin'), sha('hello'))).toBe(true);
    expect(writeSidecar(join(dir, 'x.bin'), sha('hello'))).toBe(false);
  });
});

describe('fetch-piper-assets buildPiperIndex', () => {
  it('indexes the runtime and voices from disk', async () => {
    const { buildPiperIndex } = await load('fetch-piper-assets.mjs');
    const piper = join(dir, 'tts/piper');
    mkdirSync(join(piper, 'runtime'), { recursive: true });
    mkdirSync(join(piper, 'voices'), { recursive: true });
    writeFileSync(join(piper, 'runtime/ort.wasm.min.mjs'), 'js');
    writeFileSync(join(piper, 'runtime/piper_phonemize.wasm'), 'wasm');
    writeFileSync(join(piper, 'voices/en_US-amy-medium.onnx'), 'model');
    writeFileSync(join(piper, 'voices/en_US-amy-medium.onnx.json'), '{"language":{"code":"en_US"},"audio":{"quality":"medium","sample_rate":22050}}');
    const idx = await buildPiperIndex(piper);
    expect(idx.assets.map((a: any) => `${a.kind}:${a.id}`)).toEqual(['tts-runtime:piper-runtime', 'tts-voice:en_US-amy-medium']);
    const voice = idx.assets[1];
    expect(voice.languages).toEqual(['en-US']);
    expect(voice.license).toBe('see MODEL_CARD');
    expect(voice.meta).toEqual({ quality: 'medium', sampleRate: 22050 });
    expect(voice.files[0]).toMatchObject({ path: 'en_US-amy-medium.onnx', url: 'voices/en_US-amy-medium.onnx', size: 5, sha256: sha('model') });
    expect(existsSync(join(piper, 'voices/en_US-amy-medium.onnx.sha256'))).toBe(true);
    expect(JSON.parse(readFileSync(join(piper, 'index.json'), 'utf8')).schema).toBe('kth-asset-index/1');
  });
});
