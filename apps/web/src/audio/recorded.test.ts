import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFixtureManifest, AUDIO_INDEX_SCHEMA } from '@bible/core/browser';
import type { AudioNarrator, ChapterManifest, TranslationAudioIndex } from '@bible/core/browser';
import { CdnAudioLocator } from './CdnAudioLocator';
import { HttpManifestSource } from './HttpManifestSource';
import { RecordedAudioProvider } from './RecordedAudioProvider';
import { MemoryAssetCache } from './AssetCache';
import { FakeManifestSource } from './testing';

const signal = () => new AbortController().signal;
const ref = { moduleAbbr: 'KJV', book: 43, chapter: 3 };

describe('CdnAudioLocator', () => {
  const loc = new CdnAudioLocator('/audio/');
  const m = buildFixtureManifest({ module: 'KJV', book: 43, chapter: 3, verseCount: 3, narrator: 'n1', rev: '2026.1' });

  it('builds the documented URL scheme', () => {
    expect(loc.indexUrl('KJV')).toBe('/audio/v1/KJV/index.json');
    expect(loc.manifestUrl(ref, 'n1', '2026.1')).toBe('/audio/v1/KJV/n1/2026.1/43/003.json');
    expect(loc.fileUrl(m, m.files[0])).toBe('/audio/v1/KJV/n1/2026.1/43/003.ogg');
  });

  it('works with an absolute CDN base and encodes odd module names', () => {
    const cdn = new CdnAudioLocator('https://audio.example.com/x');
    expect(cdn.indexUrl('ES RV1909')).toBe('https://audio.example.com/x/v1/ES%20RV1909/index.json');
  });
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const narrator: AudioNarrator = { id: 'n1', label: 'Server voice', language: 'en', rev: '1', books: [43] };
const index: TranslationAudioIndex = { schema: AUDIO_INDEX_SCHEMA, module: 'KJV', narrators: [narrator] };
const manifest = (over: Partial<ChapterManifest> = {}): ChapterManifest =>
  ({ ...buildFixtureManifest({ module: 'KJV', book: 43, chapter: 3, verseCount: 4, narrator: 'n1', rev: '1', intro: 2 }), ...over });

describe('HttpManifestSource', () => {
  const loc = new CdnAudioLocator('/audio');
  let now = 0;

  function source(routes: Record<string, () => Response>, cache?: MemoryAssetCache) {
    const fetchFn = vi.fn(async (url: string) => {
      const route = routes[url];
      if (!route) return new Response('nope', { status: 404 });
      return route();
    });
    return { src: new HttpManifestSource(loc, cache, fetchFn, () => now), fetchFn };
  }

  beforeEach(() => { now = 0; vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('answers null for a translation with no recordings (404), the starting state', async () => {
    const { src } = source({});
    expect(await src.translationIndex('KJV', signal())).toBeNull();
  });

  it('returns and validates the index', async () => {
    const { src } = source({ '/audio/v1/KJV/index.json': () => jsonRes(index) });
    expect((await src.translationIndex('KJV', signal()))?.narrators[0].id).toBe('n1');
  });

  it('treats an HTML 200 (SPA fallback or proxy page) as no recording', async () => {
    const { src } = source({ '/audio/v1/KJV/index.json': () => new Response('<!doctype html>', { status: 200 }) });
    expect(await src.translationIndex('KJV', signal())).toBeNull();
  });

  it('rejects an index for a different module', async () => {
    const { src } = source({ '/audio/v1/KJV/index.json': () => jsonRes({ ...index, module: 'WEB' }) });
    expect(await src.translationIndex('KJV', signal())).toBeNull();
  });

  it('shares one request between callers within a minute, then refreshes', async () => {
    const { src, fetchFn } = source({ '/audio/v1/KJV/index.json': () => jsonRes(index) });
    await Promise.all([src.translationIndex('KJV', signal()), src.translationIndex('KJV', signal())]);
    await src.translationIndex('KJV', signal());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = 61_000;
    await src.translationIndex('KJV', signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not let one caller aborting fail another', async () => {
    const { src } = source({ '/audio/v1/KJV/index.json': () => jsonRes(index) });
    const ctrl = new AbortController();
    const a = src.translationIndex('KJV', ctrl.signal);
    ctrl.abort();
    expect((await a)?.module).toBe('KJV');
  });

  it('throws a retryable network error on a server failure, and does not memoize it', async () => {
    let fail = true;
    const { src } = source({ '/audio/v1/KJV/index.json': () => (fail ? new Response('x', { status: 503 }) : jsonRes(index)) });
    await expect(src.translationIndex('KJV', signal())).rejects.toMatchObject({ code: 'network', retryable: true });
    fail = false;
    expect((await src.translationIndex('KJV', signal()))?.module).toBe('KJV');
  });

  it('falls back to the last good index when offline', async () => {
    const cache = new MemoryAssetCache();
    let online = true;
    const fetchFn = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return jsonRes(index);
    });
    const src = new HttpManifestSource(loc, cache, fetchFn, () => now);
    await src.translationIndex('KJV', signal());
    await new Promise(r => setTimeout(r, 0)); // let the background cache put finish
    online = false;
    now = 120_000;
    expect((await src.translationIndex('KJV', signal()))?.module).toBe('KJV');
  });

  it('fetches, validates and caches a chapter manifest, then serves it from the cache', async () => {
    const cache = new MemoryAssetCache();
    const url = '/audio/v1/KJV/n1/1/43/003.json';
    const { src, fetchFn } = source({ [url]: () => jsonRes(manifest()) }, cache);
    expect((await src.chapter(ref, narrator, signal()))?.verses).toHaveLength(4);
    await new Promise(r => setTimeout(r, 0));
    expect(await cache.has(url)).toBe(true);
    await src.chapter(ref, narrator, signal());
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('answers null for an unrecorded chapter, an invalid manifest, or one for another chapter', async () => {
    const url = '/audio/v1/KJV/n1/1/43/003.json';
    expect(await source({}).src.chapter(ref, narrator, signal())).toBeNull();
    expect(await source({ [url]: () => jsonRes({ nonsense: true }) }).src.chapter(ref, narrator, signal())).toBeNull();
    expect(await source({ [url]: () => jsonRes(manifest({ chapter: 4 })) }).src.chapter(ref, narrator, signal())).toBeNull();
    expect(await source({ [url]: () => jsonRes(manifest({ narrator: 'other' })) }).src.chapter(ref, narrator, signal())).toBeNull();
  });

  it('propagates an abort', async () => {
    const ctrl = new AbortController();
    const fetchFn = vi.fn(async (_u: string, init?: { signal?: AbortSignal }) => {
      ctrl.abort();
      if (init?.signal?.aborted) throw Object.assign(new Error('x'), { name: 'AbortError' });
      return jsonRes(manifest());
    });
    const src = new HttpManifestSource(loc, undefined, fetchFn);
    await expect(src.chapter(ref, narrator, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('RecordedAudioProvider', () => {
  const loc = new CdnAudioLocator('/audio');
  const fixture = () => FakeManifestSource.withChapters('KJV', [
    { book: 43, chapter: 3, verseCount: 5, secondsPerVerse: 10, intro: 2 },
  ]);
  const provider = (src = fixture(), extra: Record<string, unknown> = {}) =>
    new RecordedAudioProvider(src, loc, { canPlay: () => true, ...extra });

  it('with zero recordings supports nothing and lists no voices', async () => {
    const p = provider(new FakeManifestSource());
    expect(await p.supports('KJV', 'en')).toBe(false);
    expect(await p.voices('KJV', 'en')).toEqual([]);
  });

  it('supports a recorded translation in its own language only', async () => {
    const p = provider();
    expect(await p.supports('KJV', 'en')).toBe(true);
    expect(await p.supports('KJV', 'en-GB')).toBe(true);
    expect(await p.supports('KJV', 'es')).toBe(false);
    expect(await p.supports('WEB', 'en')).toBe(false);
  });

  it('reports "no recording" rather than throwing when the index cannot be fetched', async () => {
    const src = new FakeManifestSource();
    src.translationIndex = async () => { throw { code: 'network', message: 'x', retryable: true }; };
    expect(await provider(src).supports('KJV', 'en')).toBe(false);
  });

  it('exposes narrators as voices and the player-mode speed range', async () => {
    const p = provider();
    expect(await p.voices('KJV', 'en')).toEqual([{ id: 'fixture-1', label: 'Fixture narrator', language: 'en' }]);
    const caps = p.capabilities('KJV');
    expect(caps).toMatchObject({ rateMode: 'player', onDevice: false, needsDownload: false });
    expect(caps.rate).toEqual({ min: 0.75, max: 1.5, step: 0.05 });
    expect(await p.isReady()).toBe(true);
  });

  it('opens a chapter: one segment, verse timings, offset at the requested verse', async () => {
    const chapter = await provider().openChapter(ref, { rate: 1 }, signal());
    expect(chapter.verses).toEqual([1, 2, 3, 4, 5]);
    const seg = await chapter.segmentFor(3, signal());
    expect(seg.offset).toBe(2 + 10 * 2);
    expect(seg.url).toBe('/audio/v1/KJV/fixture-1/0/43/003.ogg');
    expect(seg.mime).toBe('audio/ogg; codecs=opus');
    expect(seg.verses).toHaveLength(5);
    expect(seg.verses[0]).toEqual({ verse: 1, start: 2, end: 12 });
    expect(await chapter.segmentAfter(seg, signal())).toBeNull();
  });

  it('starts at the intro for the first verse, unless the intro is switched off', async () => {
    const p = provider();
    const withIntro = await p.openChapter(ref, { rate: 1 }, signal());
    expect((await withIntro.segmentFor(1, signal())).offset).toBe(0);
    const without = await p.openChapter(ref, { rate: 1, readIntro: false }, signal());
    expect((await without.segmentFor(1, signal())).offset).toBe(2);
  });

  it('starts a verse the recording lacks at the next one that exists, and clamps past the end', async () => {
    const src = new FakeManifestSource(
      { KJV: { schema: AUDIO_INDEX_SCHEMA, module: 'KJV', narrators: [narrator] } },
      { 'KJV:43:3': manifest({ verses: [[1, 0, 5], [3, 5, 10], [4, 10, 15]], duration: 15, intro: undefined }) },
    );
    const chapter = await provider(src).openChapter(ref, { rate: 1 }, signal());
    expect((await chapter.segmentFor(2, signal())).offset).toBe(5);
    expect((await chapter.segmentFor(99, signal())).offset).toBe(10);
  });

  it('rejects with not-found for an unrecorded chapter or translation', async () => {
    await expect(provider().openChapter({ ...ref, chapter: 4 }, { rate: 1 }, signal())).rejects.toMatchObject({ code: 'not-found' });
    await expect(provider(new FakeManifestSource()).openChapter(ref, { rate: 1 }, signal())).rejects.toMatchObject({ code: 'not-found' });
  });

  it('prefers the requested narrator when it has the chapter, else falls back to one that does', async () => {
    const n2: AudioNarrator = { id: 'n2', label: 'Other', language: 'en', rev: '1', books: [43] };
    const src = new FakeManifestSource(
      { KJV: { schema: AUDIO_INDEX_SCHEMA, module: 'KJV', narrators: [narrator, n2] } },
      { 'KJV:43:3': manifest({ narrator: 'n2' }) },
    );
    const spy = vi.spyOn(src, 'chapter');
    await provider(src).openChapter(ref, { rate: 1, voiceId: 'n2' }, signal()).catch(() => {});
    expect(spy.mock.calls[0][1].id).toBe('n2');
    spy.mockClear();
    await provider(src).openChapter(ref, { rate: 1, voiceId: 'gone' }, signal()).catch(() => {});
    expect(spy.mock.calls[0][1].id).toBe('n1');
  });

  it('picks the first playable file, and fails clearly when none plays', async () => {
    const mp3Only = provider(fixture(), { canPlay: (m: string) => m.startsWith('audio/mpeg') });
    const seg = await (await mp3Only.openChapter(ref, { rate: 1 }, signal())).segmentFor(1, signal());
    expect(seg.mime).toBe('audio/mpeg');
    expect(seg.url.endsWith('003.mp3')).toBe(true);
    const none = provider(fixture(), { canPlay: () => false });
    await expect(none.openChapter(ref, { rate: 1 }, signal())).rejects.toMatchObject({ code: 'decode' });
  });

  it('honours an abort between steps', async () => {
    const ctrl = new AbortController();
    const src = fixture();
    const orig = src.chapter.bind(src);
    src.chapter = async (...a) => { ctrl.abort(); return orig(...a); };
    await expect(provider(src).openChapter(ref, { rate: 1 }, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  describe('caching', () => {
    it('plays from the network on a miss and stores the file in the background', async () => {
      const cache = new MemoryAssetCache();
      const fetchFn = vi.fn(async () => new Response('AUDIO', { status: 200 }));
      const p = provider(fixture(), { cache, fetchFn });
      const chapter = await p.openChapter(ref, { rate: 1 }, signal());
      const seg = await chapter.segmentFor(1, signal());
      expect(seg.url).toBe('/audio/v1/KJV/fixture-1/0/43/003.ogg');
      await vi.waitFor(async () => expect(await cache.has(seg.url)).toBe(true));
    });

    it('plays a cached chapter from a blob, releasing it on dispose', async () => {
      const cache = new MemoryAssetCache();
      await cache.put('/audio/v1/KJV/fixture-1/0/43/003.ogg', new Response('AUDIO'));
      const createObjectURL = vi.fn(() => 'blob:cached');
      const revokeObjectURL = vi.fn();
      const fetchFn = vi.fn();
      const p = provider(fixture(), { cache, fetchFn, createObjectURL, revokeObjectURL });
      const chapter = await p.openChapter(ref, { rate: 1 }, signal());
      const a = await chapter.segmentFor(1, signal());
      const b = await chapter.segmentFor(3, signal());
      expect(a.url).toBe('blob:cached');
      expect(b.url).toBe('blob:cached');
      expect(createObjectURL).toHaveBeenCalledTimes(1); // shared across seeks
      expect(fetchFn).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      chapter.dispose();
      await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached'));
    });

    it('prefetch stores the next chapter, swallows failures, and evicts beyond the limit', async () => {
      const cache = new MemoryAssetCache();
      const src = FakeManifestSource.withChapters('KJV', [1, 2, 3, 4].map(chapter => ({ book: 43, chapter, verseCount: 2 })));
      const fetchFn = vi.fn(async () => new Response('A'));
      const p = provider(src, { cache, fetchFn, cacheLimit: 2 });
      for (const chapter of [1, 2, 3]) await p.prefetch({ ...ref, chapter }, { rate: 1 }, signal());
      expect((await cache.keys('')).length).toBe(2);
      expect(await cache.has('/audio/v1/KJV/fixture-1/0/43/001.ogg')).toBe(false); // oldest evicted
      // A chapter that does not exist is not an error.
      await expect(p.prefetch({ ...ref, chapter: 99 }, { rate: 1 }, signal())).resolves.toBeUndefined();
      // Neither is a failing download.
      fetchFn.mockRejectedValueOnce(new TypeError('offline'));
      await expect(p.prefetch({ ...ref, chapter: 4 }, { rate: 1 }, signal())).resolves.toBeUndefined();
    });

    it('prefetch lets an abort through', async () => {
      const ctrl = new AbortController();
      const src = fixture();
      const orig = src.chapter.bind(src);
      src.chapter = async (...a) => { ctrl.abort(); return orig(...a); };
      await expect(provider(src).prefetch(ref, { rate: 1 }, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    });
  });
});
