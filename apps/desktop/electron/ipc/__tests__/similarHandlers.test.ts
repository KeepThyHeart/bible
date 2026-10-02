/**
 * Similar passages IPC (task 0070): validation, preparing/unavailable answers, the table
 * source order (env override, asset store, background install), hydration and explain.
 * Uses injected fakes and a tiny encoded table written to a temp dir.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/fake/userData'), isPackaged: false },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { BibleVerse, encodeNeighbourTable } from '@bible/core';
import type { NeighbourHit } from '@bible/core';
import {
  createSimilarApi,
  sanitizeOptions,
  validateRange,
  type SimilarBibleRepo,
  type SimilarEnv,
} from '../similarHandlers';
import { SimilarTableProvider, type SimilarAssetSource } from '../../services/similarTable';

const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;
const ROM_5_8 = 45005008;
const JOHN1_4_9 = 62004009;
const GEN_1_1 = 1001001;

const hit = (id: number, score: number): NeighbourHit => ({
  startVerseId: id,
  endVerseId: id,
  level: 'verse',
  score,
});

let dir: string;
let binPath: string;
let gzPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'similar-'));
  const bytes = encodeNeighbourTable(
    { neighbourFloor: 0.5, scoreMin: 0.5, scoreMax: 1, k: 3, levels: ['verse'], excludeWindow: 2 },
    [
      {
        key: { startVerseId: JOHN_3_16, endVerseId: JOHN_3_16, level: 'verse' },
        neighbours: [hit(ROM_5_8, 0.95), hit(JOHN1_4_9, 0.9), hit(JOHN_3_17, 0.85)],
      },
    ]
  );
  binPath = join(dir, 'table.bin');
  gzPath = join(dir, 'table.bin.gz');
  writeFileSync(binPath, bytes);
  writeFileSync(gzPath, gzipSync(bytes));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface AssetFake extends SimilarAssetSource {
  installs: string[];
  path: string | null;
  known: boolean;
  status: string;
}

function assetFake(over: Partial<Pick<AssetFake, 'path' | 'known' | 'status'>> = {}): AssetFake {
  const f: AssetFake = {
    installs: [],
    path: null,
    known: false,
    status: 'available',
    ...over,
    ensureReady: async () => undefined,
    resolvePath: async () => f.path,
    knows: async () => f.known,
    assets: {
      install: async (id: string) => {
        f.installs.push(id);
      },
      getSnapshot: () => ({ entries: f.known ? [{ id: 'similar-neighbours', status: f.status }] : [] }),
    },
  };
  return f;
}

const verse = (id: number, text: string) => new BibleVerse({ verseId: id, text });

function fakeRepo(): SimilarBibleRepo {
  const verses = new Map<number, BibleVerse>([
    [JOHN_3_16, verse(JOHN_3_16, 'For God so loved the world')],
    [ROM_5_8, verse(ROM_5_8, 'God commendeth his love toward us')],
    [JOHN1_4_9, verse(JOHN1_4_9, 'In this was manifested the love of God')],
  ]);
  return {
    getVerse: id => verses.get(id),
    getVerseRange: (s, e) => [...verses.values()].filter(v => v.verseId >= s && v.verseId <= e),
    getInterlinearWordsForRange: (s, e) => {
      const m = new Map<number, Array<{ strongsNumber?: string; lemma?: string; gloss?: string }>>();
      for (const id of [JOHN_3_16, ROM_5_8]) {
        if (id >= s && id <= e) m.set(id, [{ strongsNumber: 'G25', lemma: 'agapao', gloss: 'to love' }]);
      }
      return m;
    },
  };
}

function makeEnv(assets: AssetFake, over: Partial<SimilarEnv> = {}, envPath?: string) {
  const provider = new SimilarTableProvider({ getAssetService: () => assets, env: () => envPath });
  const repo = fakeRepo();
  const env: SimilarEnv = {
    table: provider,
    getSemanticSearchService: () => null,
    crossRefsFor: async () => [{ startVerseId: JOHN1_4_9, endVerseId: JOHN1_4_9 }],
    bibleRepo: async module => (module === 'KJV' || module === 'ESV' ? repo : null),
    defaultModule: () => 'ESV',
    languageOf: () => 'en',
    bookName: n => ({ 43: 'John', 45: 'Romans', 62: '1 John', 1: 'Genesis' } as Record<number, string>)[n] ?? `Book ${n}`,
    topicRepos: () => [
      {
        abbreviation: 'NAVES',
        repo: { getTopicsByVerse: () => [{ name: 'Love' }] },
      },
    ],
    ...over,
  };
  return { api: createSimilarApi(env), provider };
}

const range = (id: number) => ({ startVerseId: id, endVerseId: id });

describe('validation', () => {
  it('accepts a well-formed range', () => {
    expect(validateRange(range(JOHN_3_16))).toEqual(range(JOHN_3_16));
  });

  it.each([
    [null],
    [{ startVerseId: 0, endVerseId: 1 }],
    [{ startVerseId: 1.5, endVerseId: 2 }],
    [{ startVerseId: '43003016', endVerseId: 43003016 }],
    [{ startVerseId: 43003017, endVerseId: 43003016 }],
  ])('rejects %j', bad => {
    expect(() => validateRange(bad)).toThrow();
  });

  it('rejects ranges over 200 verses', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    await expect(api.find({ startVerseId: 43003001, endVerseId: 43003300 })).rejects.toThrow(/200/);
  });

  it('whitelists options, dropping unknown keys and capping maxResults', () => {
    expect(sanitizeOptions({ maxResults: 50, evil: 1, __proto__: { x: 1 }, testament: 'nt' })).toEqual({
      maxResults: 50,
      testament: 'nt',
    });
    expect(() => sanitizeOptions({ maxResults: 101 })).toThrow();
    expect(() => sanitizeOptions({ maxResults: '5' })).toThrow();
    expect(() => sanitizeOptions({ testament: 'mars' })).toThrow();
    expect(() => sanitizeOptions({ levels: ['sentence'] })).toThrow();
    expect(() => sanitizeOptions({ sections: ['nope'] })).toThrow();
    expect(sanitizeOptions(undefined)).toEqual({});
    expect(sanitizeOptions({ levels: ['verse', 'verse'], sections: ['gospels'] })).toEqual({
      levels: ['verse'],
      sections: ['gospels'],
    });
  });

  it('rejects a bad module name', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    await expect(api.find(range(JOHN_3_16), {}, '../x')).rejects.toThrow();
  });
});

describe('availability', () => {
  it('is unavailable with no table, no catalog entry and no pack', async () => {
    const { api } = makeEnv(assetFake());
    expect(await api.find(range(JOHN_3_16))).toEqual({ status: 'unavailable', unavailableReason: 'no-table-no-pack' });
    expect(await api.status()).toEqual({ table: 'missing', live: false });
  });

  it('answers preparing and starts one unpinned background install when a catalog offers the table', async () => {
    const assets = assetFake({ known: true });
    const { api } = makeEnv(assets);
    expect(await api.status()).toEqual({ table: 'available', live: false });
    expect(assets.installs).toEqual([]);
    expect(await api.find(range(JOHN_3_16))).toEqual({ status: 'preparing' });
    expect(await api.find(range(JOHN_3_16))).toEqual({ status: 'preparing' });
    expect(assets.installs).toEqual(['similar-neighbours']);
  });

  it('reports downloading while the asset manager is busy, without a second install', async () => {
    const assets = assetFake({ known: true, status: 'downloading' });
    const { api } = makeEnv(assets);
    expect(await api.status()).toEqual({ table: 'downloading', live: false });
    expect(await api.find(range(JOHN_3_16))).toEqual({ status: 'preparing' });
    expect(assets.installs).toEqual([]);
  });

  it('reports no-data for a verse missing from the table', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    const res = await api.find(range(GEN_1_1));
    expect(res.status).toBe('unavailable');
    expect(res.unavailableReason).toBe('no-data');
  });
});

describe('live scan (semantic pack installed, no neighbour table)', () => {
  const fakeSemantic = () => ({
    isAvailable: () => true,
    neighbourMinSimilarity: () => 0.5,
    getPassageRows: (_s: number, _e: number, levels: string[]) => [
      { id: `v:${JOHN_3_16}`, level: levels[0], vector: new Float32Array([1, 0]) },
    ],
    searchByVectors: (queries: Float32Array[]) =>
      queries.map(() => [
        { id: `v:${ROM_5_8}`, level: 'verse', startVerseId: ROM_5_8, endVerseId: ROM_5_8, similarity: 0.92 },
        { id: `v:${JOHN1_4_9}`, level: 'verse', startVerseId: JOHN1_4_9, endVerseId: JOHN1_4_9, similarity: 0.7 },
      ]),
  }) as unknown as SemanticSearchService;

  it('reports live and finds hydrated neighbours from the pack alone', async () => {
    const { api } = makeEnv(assetFake(), { getSemanticSearchService: fakeSemantic });
    expect(await api.status()).toEqual({ table: 'missing', live: true });
    const resp = await api.find(range(JOHN_3_16), { source: 'auto', levels: ['verse'] });
    expect(resp.status).toBe('ok');
    const rows = resp.result?.rows ?? [];
    expect(rows[0]).toMatchObject({ startVerseId: ROM_5_8, reference: expect.stringContaining('Romans'), text: expect.stringContaining('God commendeth') });
    expect(resp.result?.via).toBe('live');
  });
});

describe('table source', () => {
  it('reads a gzipped table from the asset store and hydrates rows', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    const res = await api.find(range(JOHN_3_16), { excludeNearby: 5 });
    expect(res.status).toBe('ok');
    const rows = res.result!.rows;
    expect(res.result!.via).toBe('table');
    // John 3:17 is within the exclusion window; the other two remain, best first.
    expect(rows.map(r => r.startVerseId)).toEqual([ROM_5_8, JOHN1_4_9]);
    expect(rows[0]).toMatchObject({
      key: `verse|${ROM_5_8}|${ROM_5_8}`,
      reference: 'Romans 5:8',
      level: 'verse',
      via: 'table',
      isCrossReference: false,
    });
    expect(rows[0].text).toContain('commendeth');
    expect(rows[1].isCrossReference).toBe(true);
    expect(await api.status()).toEqual({ table: 'ready', live: false });
  });

  it('falls back to KJV text when the named module has none', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    const res = await api.find(range(JOHN_3_16), {}, 'NOSUCH');
    expect(res.result!.rows[0].text).toContain('commendeth');
  });

  it('prefers BIBLE_SIMILAR_TABLE (a plain .bin) over the asset store', async () => {
    const assets = assetFake({ known: true });
    const { api } = makeEnv(assets, {}, binPath);
    const res = await api.find(range(JOHN_3_16));
    expect(res.status).toBe('ok');
    expect(assets.installs).toEqual([]);
  });

  it('treats an unreadable env table as absent and continues down the order', async () => {
    const assets = assetFake({ path: gzPath });
    const { api } = makeEnv(assets, {}, join(dir, 'missing.bin'));
    // The env path wins by order but cannot be read, so the installed asset answers.
    expect((await api.find(range(JOHN_3_16))).status).toBe('ok');
  });

  it('picks up a table that appears later', async () => {
    const assets = assetFake();
    const { api } = makeEnv(assets);
    expect((await api.find(range(JOHN_3_16))).status).toBe('unavailable');
    assets.path = gzPath;
    expect((await api.find(range(JOHN_3_16))).status).toBe('ok');
  });
});

describe('explain', () => {
  it('reports shared lemmas and topics', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    const reasons = await api.explain(range(JOHN_3_16), range(ROM_5_8));
    expect(reasons.some(r => r.kind === 'lemma' && r.strongs === 'G25')).toBe(true);
    expect(reasons.some(r => r.kind === 'topic' && r.label === 'Love' && r.source === 'naves')).toBe(true);
  });

  it('leaves frequent Strong\'s numbers out of the chips', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }), { frequentStrongs: new Set(['G25']) });
    const reasons = await api.explain(range(JOHN_3_16), range(ROM_5_8));
    expect(reasons.some(r => r.kind === 'lemma')).toBe(false);
  });

  it('returns plain text in rows (no markup)', async () => {
    const { api } = makeEnv(assetFake({ path: gzPath }));
    const res = await api.find(range(JOHN_3_16), { excludeNearby: 5 });
    for (const row of res.result!.rows) expect(row.text).not.toMatch(/<[a-z]/i);
  });

  it('validates both ranges', async () => {
    const { api } = makeEnv(assetFake());
    await expect(api.explain(range(JOHN_3_16), { startVerseId: -1, endVerseId: 2 })).rejects.toThrow();
  });
});

beforeEach(() => vi.clearAllMocks());
