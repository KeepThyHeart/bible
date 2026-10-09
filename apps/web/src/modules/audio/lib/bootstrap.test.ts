import { describe, it, expect, vi } from 'vitest';
import { parseAudioSiteConfig } from '@bible/core/browser';
import { chapterNeighbours, createAudioSystem, resolveBase, type AudioBootstrapDeps } from './bootstrap';
import { FakeMediaElement, asAudioElement } from './testing';
import { HtmlAudioOutput } from './HtmlAudioOutput';
import { defaultAudioPrefs } from './audioPrefs';

const counts: Record<number, number> = { 1: 50, 2: 40, 66: 22 };
const neighbours = chapterNeighbours(b => counts[b] ?? 0);

describe('chapter arithmetic', () => {
  it('crosses book edges and stops at the ends of the Bible', () => {
    const at = (book: number, chapter: number) => ({ moduleAbbr: 'KJV', book, chapter });
    expect(neighbours.next(at(1, 1))).toEqual(at(1, 2));
    expect(neighbours.next(at(1, 50))).toEqual(at(2, 1));
    expect(neighbours.next(at(66, 22))).toBeNull();
    expect(neighbours.prev(at(2, 1))).toEqual(at(1, 50));
    expect(neighbours.prev(at(1, 1))).toBeNull();
    expect(neighbours.prev(at(4, 1))).toBeNull(); // book 3 length unknown
  });
});

describe('resolveBase', () => {
  it('puts a /-relative base under the app base path, once, and leaves absolute URLs alone', () => {
    expect(resolveBase('/audio', '/')).toBe('/audio');
    expect(resolveBase('/audio', '/bible/')).toBe('/bible/audio');
    expect(resolveBase('/bible/audio', '/bible/')).toBe('/bible/audio');
    expect(resolveBase('https://cdn.example.com/a', '/bible/')).toBe('https://cdn.example.com/a');
  });
});

function deps(over: Partial<AudioBootstrapDeps> = {}): AudioBootstrapDeps {
  return {
    baseUrl: '/',
    getChapter: async () => [],
    loadedVerses: () => null,
    languageOf: () => 'en',
    bookName: b => `Book ${b}`,
    chapterCount: b => counts[b] ?? 0,
    createOutput: () => new HtmlAudioOutput(asAudioElement(new FakeMediaElement())),
    online: { addEventListener: vi.fn() },
    ...over,
  };
}

describe('createAudioSystem', () => {
  it('with zero recordings and no engines nothing can be played', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('nf', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const system = createAudioSystem(parseAudioSiteConfig({}), deps());
      expect(system.engines?.size).toBe(0);
      expect(await system.resolver.resolve('KJV', 'en', defaultAudioPrefs())).toBeNull();
      // It asked the recorded provider's index, at the site's own /audio.
      expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/audio/v1/KJV/index.json'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('registers one provider per enabled engine the build knows, and skips unknown ones', async () => {
    const cfg = parseAudioSiteConfig({
      recorded: false,
      tts: { engines: [
        { id: 'piper', voices: [{ id: 'en_US-amy-low', label: 'Amy', language: 'en-US', files: ['voices/a.onnx', 'voices/a.onnx.json'] }] },
        { id: 'nonesuch', voices: [] },
      ] },
    });
    vi.stubGlobal('Worker', class {});
    try {
      const system = createAudioSystem(cfg, deps({ baseUrl: '/bible/' }));
      expect([...system.engines!.keys()]).toEqual(['piper']);
      const options = await system.resolver.options('KJV', 'en');
      expect(options.map(o => o.provider.id)).toEqual(['tts:piper']);
      expect(options[0].voices.map(v => v.id)).toEqual(['en_US-amy-low']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('invalidates negative answers when the browser comes back online', () => {
    const online = { addEventListener: vi.fn() };
    createAudioSystem(parseAudioSiteConfig({}), deps({ online }));
    expect(online.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
  });
});
