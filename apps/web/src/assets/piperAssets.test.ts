import { describe, it, expect } from 'vitest';
import type { TtsEngineConfig } from '@bible/core/browser';
import { PIPER_RUNTIME_ID, legacyPiperManifests, loadPiperManifests } from './piperAssets';

const config: TtsEngineConfig = {
  id: 'piper',
  enabled: true,
  assetBase: 'https://example.test/audio/tts/piper',
  voices: [{ id: 'en_US-amy-low', label: 'Amy', language: 'en-US', files: ['voices/amy.onnx', 'voices/amy.onnx.json'], license: 'CC0' }],
};
const signal = new AbortController().signal;

describe('piperAssets', () => {
  it('reads index.json next to the files and resolves relative urls', async () => {
    const asked: string[] = [];
    const index = {
      schema: 'kth-asset-index/1',
      assets: [{ id: 'amy', kind: 'tts-voice', version: '1', title: 'Amy', license: 'CC0', size: 3,
        files: [{ path: 'voices/amy.onnx', url: 'voices/amy.onnx', size: 3, sha256: 'a'.repeat(64) }] }],
    };
    const out = await loadPiperManifests(config, async (u) => { asked.push(u); return JSON.stringify(index); }, signal);
    expect(asked).toEqual(['https://example.test/audio/tts/piper/index.json']);
    expect(out.map((m) => m.id)).toEqual(['amy']);
    expect(out[0].files[0].url).toBe('https://example.test/audio/tts/piper/voices/amy.onnx');
  });

  it('falls back to legacy manifests on 404, a network error or a bad index', async () => {
    for (const getText of [async () => null, async () => { throw new Error('x'); }, async () => 'not json']) {
      const out = await loadPiperManifests(config, getText, signal);
      expect(out.map((m) => m.id)).toEqual([PIPER_RUNTIME_ID, 'en_US-amy-low']);
    }
  });

  it('builds legacy manifests: unverified, runtime has 6 files, absolute urls, unknown size', () => {
    const [runtime, voice] = legacyPiperManifests(config);
    expect(runtime).toMatchObject({ kind: 'tts-runtime', allowUnverified: true, version: '1', size: 0 });
    expect(runtime.files).toHaveLength(6);
    expect(runtime.files.map((f) => f.path)).toContain('runtime/ort-wasm-simd-threaded.mjs');
    expect(runtime.files.every((f) => f.url.startsWith('https://example.test/audio/tts/piper/runtime/') && f.size === 0)).toBe(true);
    expect(voice).toMatchObject({ id: 'en_US-amy-low', kind: 'tts-voice', license: 'CC0', allowUnverified: true });
    expect(voice.files.map((f) => f.url)).toEqual([
      'https://example.test/audio/tts/piper/voices/amy.onnx',
      'https://example.test/audio/tts/piper/voices/amy.onnx.json',
    ]);
  });
});
