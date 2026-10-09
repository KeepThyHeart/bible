// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createData } from '../src/data';
import type { SourceConfig } from '../src/types';

const slice = (k: number) => ({ k, f: 1, v: ['a', 'b'], n: 2 });
let calls: string[];

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return handler(url); }));
}
const json = (o: unknown) => new Response(JSON.stringify(o));
const client = (src: SourceConfig) => createData(() => src, () => 'https://site.test/js/verse-hover.min.js');

beforeEach(() => vi.unstubAllGlobals());

describe('static source', () => {
  it('fetches one file per chapter and dedupes in-flight/cached requests', async () => {
    mockFetch(() => json(slice(43003)));
    const c = client({ type: 'static', base: '/bible-data' });
    const [a, b] = await Promise.all([c.get({ tr: 'KJV', book: 43, chapter: 3, from: 16, to: 16 }), c.get({ tr: 'KJV', book: 43, chapter: 3, from: 1, to: 5 })]);
    expect(a).toEqual(b);
    await c.get({ tr: 'KJV', book: 43, chapter: 3, from: 16, to: 16 });
    expect(calls).toEqual(['https://site.test/bible-data/KJV/43/3.json']);
  });
  it('decodes gzip by its magic bytes, and plain bytes served as .gz too', async () => {
    mockFetch((u) => new Response(u.endsWith('/3.json.gz') ? gzipSync(JSON.stringify(slice(43003))) : JSON.stringify(slice(43004))));
    const c = client({ type: 'static', base: '/d/', compressed: 'gzip' });
    expect((await c.get({ tr: 'KJV', book: 43, chapter: 3, from: 1, to: 1 })).k).toBe(43003);
    expect((await c.get({ tr: 'KJV', book: 43, chapter: 4, from: 1, to: 1 })).k).toBe(43004);
  });
  it('does not cache failures', async () => {
    let n = 0;
    mockFetch(() => (n++ === 0 ? new Response('', { status: 500 }) : json(slice(1001))));
    const c = client({ type: 'static', base: '/d/' });
    await expect(c.get({ tr: 'KJV', book: 1, chapter: 1, from: 1, to: 1 })).rejects.toThrow();
    expect((await c.get({ tr: 'KJV', book: 1, chapter: 1, from: 1, to: 1 })).k).toBe(1001);
  });
  it('manifest is null when missing', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    expect(await client({ type: 'static', base: '/d/' }).manifest('KJV')).toBeNull();
  });
});

describe('php source', () => {
  it('coalesces requests within 30 ms into one call, ids in verse-id form', async () => {
    mockFetch(() => json({ t: 'KJV', s: [slice(43003), slice(45005)] }));
    const c = client({ type: 'php', url: 'verse-hover.php' });
    const [a, b] = await Promise.all([c.get({ tr: 'KJV', book: 43, chapter: 3, from: 16, to: 16 }), c.get({ tr: 'KJV', book: 45, chapter: 5, from: 8, to: 9 })]);
    expect(a.k).toBe(43003);
    expect(b.k).toBe(45005);
    expect(calls).toEqual(['https://site.test/js/verse-hover.php?t=KJV&r=43003016-43003016,45005008-45005009']);
  });
  it('splits batches so no URL exceeds 1800 characters', async () => {
    mockFetch(() => json({ t: 'KJV', s: Array.from({ length: 300 }, () => slice(1001)) }));
    const c = client({ type: 'php', url: '/vh.php' });
    const ps = Array.from({ length: 120 }, (_, i) => c.get({ tr: 'KJV', book: 1 + (i % 60), chapter: 1 + Math.floor(i / 60), from: i + 1, to: i + 2 }).catch(() => null));
    await Promise.all(ps);
    expect(calls.length).toBeGreaterThan(1);
    for (const u of calls) expect(u.length).toBeLessThanOrEqual(1900);
  });
  it('separate translations go in separate calls', async () => {
    mockFetch(() => json({ t: 'X', s: [slice(1001)] }));
    const c = client({ type: 'php', url: '/vh.php' });
    await Promise.all([c.get({ tr: 'KJV', book: 1, chapter: 1, from: 1, to: 1 }), c.get({ tr: 'ASV', book: 1, chapter: 1, from: 1, to: 1 })]);
    expect(calls.length).toBe(2);
  });
  it('fetch uses omit credentials and cors', async () => {
    mockFetch(() => json({ s: [slice(1001)] }));
    await client({ type: 'php', url: '/vh.php' }).get({ tr: 'KJV', book: 1, chapter: 1, from: 1, to: 1 });
    expect((fetch as any).mock.calls[0][1]).toMatchObject({ credentials: 'omit', mode: 'cors' });
  });
});

describe('custom source', () => {
  it('delegates to load()', async () => {
    const load = vi.fn(async () => slice(9001));
    const c = client({ type: 'custom', load });
    expect((await c.get({ tr: 'KJV', book: 9, chapter: 1, from: 1, to: 1 })).k).toBe(9001);
    expect(load).toHaveBeenCalledOnce();
  });
});

describe('LRU', () => {
  it('keeps at most 64 chapters', async () => {
    mockFetch(() => json(slice(1)));
    const c = client({ type: 'static', base: '/d/' });
    for (let i = 1; i <= 70; i++) await c.get({ tr: 'KJV', book: 1, chapter: i, from: 1, to: 1 });
    calls.length = 0;
    await c.get({ tr: 'KJV', book: 1, chapter: 1, from: 1, to: 1 });
    expect(calls.length).toBe(1); // evicted
    await c.get({ tr: 'KJV', book: 1, chapter: 70, from: 1, to: 1 });
    expect(calls.length).toBe(1); // still cached
  });
});
