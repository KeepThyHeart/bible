import { describe, it, expect, vi } from 'vitest';
import type { AssetManifest, IAssetManager, TtsEngineConfig } from '@bible/core/browser';
import { MemoryAssetCache } from '../../AssetCache';
import type { WorkerLike } from '../WorkerTtsEngine';
import { PiperEngine } from './PiperEngine';

const config: TtsEngineConfig = {
  id: 'piper', enabled: true, assetBase: 'https://example.test/audio/tts/piper',
  voices: [{ id: 'amy', label: 'Amy', language: 'en-US', files: ['voices/amy.onnx'] }],
};
const manifest = (id: string, kind: string): AssetManifest => ({
  id, kind, version: '1', title: id, license: 'x', size: 10, files: [{ path: 'f', url: `https://example.test/${id}`, size: 10, sha256: 'a'.repeat(64) }],
});
const manifests = [manifest('piper-runtime', 'tts-runtime'), manifest('amy', 'tts-voice')];

function fakeWorker(log: string[]): WorkerLike {
  const w: WorkerLike = {
    onmessage: null, onerror: null, onmessageerror: null, terminate() {},
    postMessage(m) {
      log.push(`worker:${m.op}`);
      queueMicrotask(() => w.onmessage?.({ data: { id: m.id, kind: 'ok' } as never }));
    },
  };
  return w;
}

function fakeAssets(log: string[], installed: Record<string, boolean> = {}) {
  const state = { ...installed };
  const assets = {
    installed: vi.fn((id: string) => (state[id] ? ({ id } as never) : undefined)),
    install: vi.fn(async (target: AssetManifest | string, opts?: { onProgress?: (p: never) => void }) => {
      const id = typeof target === 'string' ? target : target.id;
      log.push(`install:${id}`);
      opts?.onProgress?.({ loaded: 5, total: 10 } as never);
      state[id] = true;
      return { id } as never;
    }),
    adopt: vi.fn(async (m: AssetManifest) => { state[m.id] = true; return true; }),
    remove: vi.fn(async (id: string) => { log.push(`remove:${id}`); state[id] = false; }),
  };
  return assets as typeof assets & IAssetManager;
}

const make = (assets: IAssetManager, log: string[], cache = new MemoryAssetCache()) =>
  new PiperEngine(config, { assets, cache, loadManifests: async () => manifests, createWorker: () => fakeWorker(log) });

describe('PiperEngine with the asset manager', () => {
  it('prepare installs the runtime, then the voice, before the worker prepares', async () => {
    const log: string[] = [];
    const assets = fakeAssets(log);
    const progress: Array<{ phase: string; loaded: number }> = [];
    await make(assets, log).prepare('amy', p => progress.push(p), new AbortController().signal);
    expect(log.filter(l => l.startsWith('install') || l === 'worker:prepare')).toEqual(['install:piper-runtime', 'install:amy', 'worker:prepare']);
    expect(progress.slice(0, 2).map(p => p.phase)).toEqual(['engine', 'voice']);
    expect(assets.install.mock.calls.every(c => (c[1] as { pinned?: boolean }).pinned === true)).toBe(true);
  });

  it('synthesize after a worker crash never installs, even when the catalog version differs', async () => {
    const log: string[] = [];
    const assets = fakeAssets(log, { 'piper-runtime': true, amy: true });
    const newer = [{ ...manifests[0], version: '2' }, { ...manifests[1], version: '2' }];
    const w: WorkerLike = {
      onmessage: null, onerror: null, onmessageerror: null, terminate() {},
      postMessage(m) {
        log.push(`worker:${m.op}`);
        const value = m.op === 'synthesize' ? { pcm: new Float32Array(1), sampleRate: 1, sentences: [] } : undefined;
        queueMicrotask(() => w.onmessage?.({ data: { id: m.id, kind: 'ok', value } as never }));
      },
    };
    const engine = new PiperEngine(config, { assets, cache: new MemoryAssetCache(), loadManifests: async () => newer, createWorker: () => w });
    await engine.synthesize({ voiceId: 'amy', text: 'hi' } as never, new AbortController().signal);
    expect(assets.install).not.toHaveBeenCalled();
    expect(log.filter((l) => l !== 'worker:init')).toEqual(['worker:prepare', 'worker:synthesize']);
  });

  it('isVoiceReady is true from the registry and false when nothing is stored', async () => {
    const log: string[] = [];
    expect(await make(fakeAssets(log, { 'piper-runtime': true, amy: true }), log).isVoiceReady('amy')).toBe(true);
    expect(await make(fakeAssets(log), log).isVoiceReady('amy')).toBe(false);
  });

  it('adopts files downloaded before the manager existed', async () => {
    const log: string[] = [];
    const cache = new MemoryAssetCache();
    for (const f of ['runtime/ort-wasm-simd-threaded.wasm', 'runtime/piper_phonemize.wasm', 'runtime/piper_phonemize.data', 'voices/amy.onnx']) {
      await cache.put(`https://example.test/audio/tts/piper/${f}`, new Response(new Uint8Array(3)));
    }
    const assets = fakeAssets(log);
    expect(await make(assets, log, cache).isVoiceReady('amy')).toBe(true);
    expect(assets.adopt).toHaveBeenCalledTimes(2);
  });

  it('evictVoice removes the voice from the manager but keeps the runtime', async () => {
    const log: string[] = [];
    const assets = fakeAssets(log, { 'piper-runtime': true, amy: true });
    await make(assets, log).evictVoice('amy');
    expect(log).toContain('remove:amy');
    expect(log).not.toContain('remove:piper-runtime');
  });
});
