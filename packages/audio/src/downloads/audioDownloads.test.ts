import { describe, it, expect, vi } from 'vitest';
import { buildFixtureManifest } from '@bible/core/browser';
import type { ChapterManifest, TranslationAudioIndex } from '@bible/core/browser';
import { FakeManifestSource } from '../testing';
import { CdnAudioLocator } from '../CdnAudioLocator';
import { MemoryAssetCache } from '../AssetCache';
import {
  AUDIO_DOWNLOAD_WARN_BYTES, AudioDownloadsModel, audioBookId, createAudioPackInstaller, narratorBooks, parseAudioBookId,
  type AudioDownloadFile, type IAudioDownloadStore,
} from './audioDownloads';
import { createCacheDownloadStore, layeredAssetCache } from './cacheDownloadStore';

const counts: Record<number, number> = { 1: 2, 40: 3, 43: 3 };
const chapterCount = (b: number) => counts[b] ?? 0;

function source(): FakeManifestSource {
  const index: TranslationAudioIndex = {
    schema: 'kth-audio-index/1',
    module: 'KJV',
    narrators: [{ id: 'amy', label: 'Amy', language: 'en', rev: '1', books: [1, 43], chapters: { '40': [1, 3] } }],
  };
  const manifests: Record<string, ChapterManifest> = {};
  const add = (book: number, chapter: number) => {
    const ccc = String(chapter).padStart(3, '0');
    manifests[`KJV:${book}:${chapter}`] = buildFixtureManifest({
      module: 'KJV', narrator: 'amy', rev: '1', book, chapter, verseCount: 3,
      files: [
        { codec: 'opus', mime: 'audio/ogg; codecs=opus', path: `${book}/${ccc}.ogg`, bytes: 1000 },
        { codec: 'mp3', mime: 'audio/mpeg', path: `${book}/${ccc}.mp3`, bytes: 2000 },
      ],
    });
  };
  add(1, 1); add(1, 2); add(40, 1); add(40, 3); add(43, 1); add(43, 2); add(43, 3);
  return new FakeManifestSource({ KJV: index }, manifests);
}

class MemStore implements IAudioDownloadStore {
  stored = new Set<string>();
  fetched: string[] = [];
  failAfter = Infinity;
  persisted = 0;
  free: number | null = 10_000_000;
  async present(urls: readonly string[]) { return new Set(urls.filter(u => this.stored.has(u))); }
  async fetch(files: readonly AudioDownloadFile[], opts: { signal: AbortSignal; onBytes(n: number): void }) {
    let n = 0;
    for (const f of files) {
      if (opts.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
      if (this.fetched.length >= this.failAfter) throw new Error('network down');
      this.fetched.push(f.url);
      this.stored.add(f.url);
      n += f.bytes;
      opts.onBytes(n);
    }
  }
  async remove(urls: readonly string[]) { for (const u of urls) this.stored.delete(u); }
  async freeBytes() { return this.free; }
  async persist() { this.persisted++; }
}

function model(store = new MemStore(), ensureText: (m: string, s: AbortSignal) => Promise<void> = vi.fn(async () => {})) {
  const m = new AudioDownloadsModel({
    manifests: source(), locator: new CdnAudioLocator('/audio'), store,
    canPlay: mime => mime.startsWith('audio/ogg'), chapterCount, ensureText,
  });
  return { m, store, ensureText };
}

describe('book ids and listing', () => {
  it('round-trips ids and rejects bad ones', () => {
    expect(parseAudioBookId(audioBookId('KJV', 'amy', '1', 43))).toEqual({ module: 'KJV', narrator: 'amy', rev: '1', book: 43 });
    expect(parseAudioBookId('KJV/amy/1/67')).toBeNull();
    expect(parseAudioBookId('KJV/amy/43')).toBeNull();
  });

  it('lists full and partial books in order, with N of M for partial ones', async () => {
    const index = await source().translationIndex('KJV');
    const books = narratorBooks('KJV', index!.narrators[0], chapterCount);
    expect(books.map(b => [b.book, b.testament, b.chapters, b.totalChapters, b.partial])).toEqual([
      [1, 'ot', [1, 2], 2, false],
      [40, 'nt', [1, 3], 3, true],
      [43, 'nt', [1, 2, 3], 3, false],
    ]);
  });
});

describe('AudioDownloadsModel', () => {
  it('sizes books from their manifests (the playable file only)', async () => {
    const { m } = model();
    await m.open('KJV');
    expect(m.rows.map(r => [r.book, r.bytes, r.state])).toEqual([[1, 2000, 'absent'], [40, 2000, 'absent'], [43, 3000, 'absent']]);
    expect(m.totalBytes).toBe(7000);
  });

  it('selects per testament and the whole Bible, and totals the selection', async () => {
    const { m } = model();
    await m.open('KJV');
    m.selectTestament('nt');
    expect([...m.selected].sort((a, b) => a - b)).toEqual([40, 43]);
    expect(m.selectedBytes).toBe(5000);
    m.toggle(40);
    expect(m.selectedBytes).toBe(3000);
    m.selectWholeBible();
    expect(m.selectedBytes).toBe(7000);
  });

  it('warns over the threshold or over free space', async () => {
    const { m, store } = model();
    await m.open('KJV');
    m.selectWholeBible();
    expect((await m.check()).warn).toBe(false);
    store.free = 6000;
    expect(await m.check()).toMatchObject({ fits: false, warn: true });
    expect(AUDIO_DOWNLOAD_WARN_BYTES).toBeGreaterThan(1_000_000);
  });

  it('downloads the text first, then the index and each book; persists once', async () => {
    const order: string[] = [];
    const store = new MemStore();
    const ensureText = vi.fn(async (mod: string) => { order.push(`text:${mod}`); });
    const { m } = model(store, ensureText);
    await m.open('KJV');
    m.toggle(43);
    await m.download();
    expect(ensureText).toHaveBeenCalledOnce();
    expect(order).toEqual(['text:KJV']);
    expect(store.fetched[0]).toBe('/audio/v1/KJV/index.json');
    expect(store.fetched.filter(u => u.endsWith('.ogg'))).toEqual(['/audio/v1/KJV/amy/1/43/001.ogg', '/audio/v1/KJV/amy/1/43/002.ogg', '/audio/v1/KJV/amy/1/43/003.ogg']);
    expect(store.fetched.some(u => u.endsWith('.mp3'))).toBe(false);
    expect(m.rows.find(r => r.book === 43)!.state).toBe('downloaded');
    expect(m.run).toBe('done');
    expect(m.progress).toMatchObject({ done: 1, total: 1, loadedBytes: 3000 });
    expect(store.persisted).toBe(1);
  });

  it('keeps partial progress after a failure and resumes without refetching', async () => {
    const store = new MemStore();
    store.failAfter = 3; // index + one manifest + one file
    const { m } = model(store);
    await m.open('KJV');
    m.toggle(43);
    await m.download();
    expect(m.run).toBe('failed');
    expect(m.rows.find(r => r.book === 43)!.state).toBe('partial');
    const before = store.fetched.length;
    store.failAfter = Infinity;
    expect(m.selected.has(43)).toBe(true); // a failed book stays selected
    await m.download();
    expect(m.run).toBe('done');
    expect(store.fetched.slice(before)).not.toContain('/audio/v1/KJV/amy/1/43/001.ogg');
  });

  it('removes one book', async () => {
    const { m, store } = model();
    await m.open('KJV');
    m.toggle(1);
    await m.download();
    await m.remove(1);
    expect(m.rows.find(r => r.book === 1)!.state).toBe('absent');
    expect([...store.stored]).toEqual(['/audio/v1/KJV/index.json']);
  });

  it('cancel stops the run as cancelled', async () => {
    const { m } = model(undefined, vi.fn(async () => { m.cancel(); }));
    await m.open('KJV');
    m.toggle(1);
    await m.download();
    expect(m.run).toBe('cancelled');
    expect(m.error).toBeNull();
  });
});

describe('pack installer', () => {
  it('stores only the missing files of a book', async () => {
    const store = new MemStore();
    store.stored.add('a');
    const files = [{ url: 'a', bytes: 1 }, { url: 'b', bytes: 2 }];
    const inst = createAudioPackInstaller({ filesOf: async () => files, store });
    const onBytes = vi.fn();
    await inst.install({ key: 'audio:x', offer: { ref: { kind: 'audio', id: 'KJV/amy/1/1' } } as never, action: 'install', after: [] }, { signal: new AbortController().signal, onBytes });
    expect(store.fetched).toEqual(['b']);
    expect(onBytes).toHaveBeenLastCalledWith(2, 2);
  });
});

describe('cache download store and layering', () => {
  it('stores whole bodies, checks sizes, and the layered cache reads downloads first without LRU eviction', async () => {
    const pinned = new MemoryAssetCache();
    const store = createCacheDownloadStore(pinned, {
      fetchFn: async url => new Response(url.endsWith('bad') ? 'x' : 'abcd'),
      freeBytes: async () => 42, persist: async () => {},
    });
    await store.fetch([{ url: 'https://h/a', bytes: 4 }], { signal: new AbortController().signal, onBytes: () => {} });
    await expect(store.fetch([{ url: 'https://h/bad', bytes: 4 }], { signal: new AbortController().signal, onBytes: () => {} })).rejects.toThrow(/Size/);
    expect([...(await store.present(['https://h/a', 'https://h/bad']))]).toEqual(['https://h/a']);
    const lru = new MemoryAssetCache();
    const layered = layeredAssetCache(pinned, lru);
    expect(await layered.has('https://h/a')).toBe(true);
    expect(await layered.keys('')).toEqual([]);
    await layered.delete('');
    expect(await pinned.has('https://h/a')).toBe(true);
    expect(await store.freeBytes()).toBe(42);
  });

  it('rejects a body whose sha256 does not match', async () => {
    const store = createCacheDownloadStore(new MemoryAssetCache(), { fetchFn: async () => new Response('abcd'), freeBytes: async () => 1, persist: async () => {} });
    const ok = '88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589'; // sha256('abcd')
    await store.fetch([{ url: 'https://h/a', bytes: 4, sha256: ok }], { signal: new AbortController().signal, onBytes: () => {} });
    await expect(store.fetch([{ url: 'https://h/b', bytes: 4, sha256: '00'.repeat(32) }], { signal: new AbortController().signal, onBytes: () => {} })).rejects.toThrow(/Checksum/);
  });
});
