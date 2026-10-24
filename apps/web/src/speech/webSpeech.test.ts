import { describe, it, expect, vi } from 'vitest';
import type { IAssetManager } from '@bible/core/browser';
import { webModelFiles, webOrtBase, brandedModelBase } from './webSpeech';

function fakeManager(): IAssetManager {
  const installed = new Set<string>();
  return {
    installed: vi.fn((id: string) => (installed.has(id) ? ({ id } as never) : undefined)),
    install: vi.fn(async (target: unknown, opts?: { onProgress?: (p: unknown) => void }) => {
      const id = typeof target === 'string' ? target : (target as { id: string }).id;
      opts?.onProgress?.({ id, loaded: 5, total: 10 });
      installed.add(id);
      return { id } as never;
    }),
    readFile: vi.fn(async () => new Uint8Array([1, 2])),
    remove: vi.fn(async (id: string) => { installed.delete(id); }),
  } as unknown as IAssetManager;
}

describe('webModelFiles', () => {
  it('installs pinned from the manifest, maps progress, reads and removes', async () => {
    const m = fakeManager();
    const files = webModelFiles(m);
    expect(await files.isInstalled('whisper-base-q8')).toBe(false);
    const progress: unknown[] = [];
    const ac = new AbortController();
    await files.install('whisper-base-q8', (p) => progress.push(p), ac.signal);
    const [target, opts] = (m.install as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(target.id).toBe('whisper-base-q8');
    expect(target.kind).toBe('stt-model');
    expect(opts.pinned).toBe(true);
    expect(opts.signal).toBe(ac.signal);
    expect(progress).toEqual([{ phase: 'manifest', loaded: 5, total: 10 }]);
    expect(await files.isInstalled('whisper-base-q8')).toBe(true);
    expect(Array.from(await files.read('whisper-base-q8', 'config.json'))).toEqual([1, 2]);
    await files.remove('whisper-base-q8');
    expect(await files.isInstalled('whisper-base-q8')).toBe(false);
  });

  it('falls back to the catalog id for an unknown manifest', async () => {
    const m = fakeManager();
    await webModelFiles(m, []).install('whisper-base-q8', () => {}, new AbortController().signal);
    expect((m.install as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('whisper-base-q8');
  });
});

describe('webOrtBase / brandedModelBase', () => {
  it('is an absolute URL ending in /ort/', () => {
    expect(webOrtBase()).toMatch(/^https?:\/\/[^/]+\/.*ort\/$/);
  });
  it('reads the branding key, empty by default', () => {
    expect(brandedModelBase()).toBe('');
    (globalThis as { __BRAND__?: unknown }).__BRAND__ = { speechModelBaseUrl: ' https://m.example/ ' };
    expect(brandedModelBase()).toBe('https://m.example/');
    delete (globalThis as { __BRAND__?: unknown }).__BRAND__;
  });
});
