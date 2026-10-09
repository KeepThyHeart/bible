import { describe, expect, it } from 'vitest';
import { assetIdFor, fileUrl, whisperManifests, WHISPER_MODELS } from './whisperModels';

describe('whisperModels', () => {
  it('ids', () => expect(assetIdFor('base', 'q8')).toBe('whisper-base-q8'));

  it('fileUrl', () => {
    expect(fileUrl('https://h.co/', 'a/b', 'rev', 'onnx/x.onnx')).toBe('https://h.co/a/b/resolve/rev/onnx/x.onnx');
    expect(fileUrl('https://h.co', 'a/b', 'rev', 'c.json')).toBe('https://h.co/a/b/resolve/rev/c.json');
    expect(fileUrl('', 'a/b', 'rev', 'c.json')).toBe('https://huggingface.co/a/b/resolve/rev/c.json');
  });

  it('four manifests with pinned files', () => {
    const ms = whisperManifests('https://mirror.test/');
    expect(ms.map((m) => m.id).sort()).toEqual(['whisper-base-f16', 'whisper-base-q8', 'whisper-tiny-f16', 'whisper-tiny-q8']);
    for (const m of ms) {
      expect(m.kind).toBe('stt-model');
      expect(m.files).toHaveLength(7);
      expect(m.size).toBe(m.files.reduce((n, f) => n + f.size, 0));
      for (const f of m.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.size).toBeGreaterThan(0);
        expect(f.url.startsWith('https://mirror.test/onnx-community/')).toBe(true);
      }
      expect(m.meta).toMatchObject({ revision: WHISPER_MODELS[m.meta!.model as 'base'].revision });
    }
    const base = ms.find((m) => m.id === 'whisper-base-q8')!;
    expect(base.size).toBeGreaterThan(77_000_000);
    expect(base.size).toBeLessThan(85_000_000);
  });
});
