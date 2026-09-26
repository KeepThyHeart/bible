import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InModuleFts5Provider } from './InModuleFts5Provider';
import { KJVTestHelper } from '../../../__tests__/helpers/KJVTestHelper';
import { IBibleRepository } from '../../Repositories/IBibleRepository';
import { IndexTarget, KeywordQuery } from '../KeywordTypes';
import { RuntimeEnvironment } from '../IKeywordIndexProvider';
import { Book, VerseIdHelper } from '../../Core/Types';

// Gated so a checkout without module data skips with a warning rather than
// erroring in beforeAll. See __tests__/helpers/testData.ts.
const KJV_AVAILABLE = KJVTestHelper.isAvailable();

const ENV: RuntimeEnvironment = {
  runtime: 'node-server',
  sqlite: { fts5: true, writableModules: false },
  codecs: new Set(),
  indexDir: null,
};

function target(moduleUuid: string): IndexTarget {
  return { moduleUuid, moduleType: 'bible', contentSha256: `sha-${moduleUuid}` };
}

/**
 * A fake `IBibleRepository` that always throws from `searchVersesWithHighlighting`,
 * simulating a module whose `bible_verse_fts` table is missing or broken -
 * e.g. a v0.2-schema module (F2), which no longer carries that table at
 * all. Only the one method this provider actually calls needs a real
 * implementation for these tests.
 */
function brokenRepo(): IBibleRepository {
  return {
    searchVersesWithHighlighting: () => {
      throw new Error('no such table: bible_verse_fts');
    },
  } as unknown as IBibleRepository;
}

describe.skipIf(!KJV_AVAILABLE)('InModuleFts5Provider', () => {
  let kjvRepo: IBibleRepository;

  beforeAll(() => {
    KJVTestHelper.initialize();
    kjvRepo = KJVTestHelper.getKJVRepository();
  });

  afterAll(() => {
    KJVTestHelper.cleanup();
  });

  describe('id', () => {
    it("is 'in-module-fts5'", () => {
      expect(new InModuleFts5Provider().id).toBe('in-module-fts5');
    });
  });

  describe('supports()', () => {
    it('is false for a target nobody registered', () => {
      const provider = new InModuleFts5Provider();
      expect(provider.supports(target('unregistered'), ENV)).toBe(false);
    });

    it('is true once a target has been registered', () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      expect(provider.supports(t, ENV)).toBe(true);
    });

    it('is false again after unregister()', () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      provider.unregister(t);
      expect(provider.supports(t, ENV)).toBe(false);
    });
  });

  describe('status()', () => {
    it('reports ready with the expected KeywordFeatures for a real, queryable module', async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);

      const status = await provider.status(t);
      expect(status).toEqual({
        state: 'ready',
        providerId: 'in-module-fts5',
        supports: {
          phrase: true,
          prefix: true,
          near: true,
          booleanOps: true,
          rank: false,
          snippetFromIndex: true,
        },
      });
    });

    it('reports unavailable/no-fts-engine for a registered repo whose FTS5 table is missing', async () => {
      const provider = new InModuleFts5Provider();
      const t = target('broken');
      provider.register(t, brokenRepo());

      const status = await provider.status(t);
      expect(status).toEqual({ state: 'unavailable', reason: 'no-fts-engine' });
    });

    it('reports unavailable/no-provider for a target nobody registered', async () => {
      const provider = new InModuleFts5Provider();
      const status = await provider.status(target('nobody'));
      expect(status).toEqual({ state: 'unavailable', reason: 'no-provider' });
    });
  });

  describe('open() + IKeywordIndex.search()', () => {
    it("finds hits for a 'terms' query against the real KJV module", async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);

      const index = await provider.open([t]);
      expect(index.providerId).toBe('in-module-fts5');
      expect(index.capability).toEqual({
        state: 'ready',
        providerId: 'in-module-fts5',
        supports: {
          phrase: true, prefix: true, near: true, booleanOps: true, rank: false, snippetFromIndex: true,
        },
      });

      const query: KeywordQuery = { kind: 'terms', terms: ['God', 'loved', 'world'], all: true };
      const response = await index.search(query, { targets: [t] });
      index.close();

      expect(response.skipped).toEqual([]);
      const john316 = VerseIdHelper.calculate(Book.John, 3, 16);
      const hit = response.hits.find(h => h.rowId === john316);
      expect(hit).toBeDefined();
      expect(hit?.target).toEqual(t);
      expect(hit?.snippet).toContain('<strong><u>');
    });

    it("finds hits for a 'phrase' query", async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      const query: KeywordQuery = { kind: 'phrase', phrase: 'For God so loved' };
      const response = await index.search(query, { targets: [t] });
      index.close();

      const john316 = VerseIdHelper.calculate(Book.John, 3, 16);
      expect(response.hits.some(h => h.rowId === john316)).toBe(true);
    });

    it("finds hits for a 'prefix' query", async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      const query: KeywordQuery = { kind: 'prefix', stem: 'believ' };
      const response = await index.search(query, { targets: [t], limit: 200 });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
    });

    it("finds hits for a 'near' query (verse-scoped, not book-scoped)", async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      // "faith, hope, charity" all appear together in 1 Corinthians 13:13.
      const query: KeywordQuery = { kind: 'near', terms: ['faith', 'hope'], distance: 5 };
      const response = await index.search(query, { targets: [t] });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
    });

    it("finds hits for a 'boolean' query", async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      const query: KeywordQuery = {
        kind: 'boolean',
        expr: { operator: 'OR', left: 'Jerusalem', right: 'Zion' },
      };
      const response = await index.search(query, { targets: [t] });
      index.close();

      expect(response.hits.length).toBeGreaterThan(0);
    });

    it('a bare-negation boolean query returns zero hits, not a throw', async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      const query: KeywordQuery = { kind: 'boolean', expr: { operator: 'NOT', left: 'wicked' } };
      const response = await index.search(query, { targets: [t] });
      index.close();

      expect(response).toEqual({ hits: [], skipped: [], truncated: false });
    });

    it('respects the limit option per target', async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      const query: KeywordQuery = { kind: 'terms', terms: ['love'], all: false };
      const response = await index.search(query, { targets: [t], limit: 3 });
      index.close();

      expect(response.hits.length).toBeLessThanOrEqual(3);
      expect(response.truncated).toBe(true);
    });

    it('a broken target throws internally but is caught per-target and reported as skipped, not propagated', async () => {
      const provider = new InModuleFts5Provider();
      const good = target('kjv');
      const bad = target('broken');
      provider.register(good, kjvRepo);
      provider.register(bad, brokenRepo());

      const index = await provider.open([good, bad]);
      const query: KeywordQuery = { kind: 'terms', terms: ['love'], all: true };
      const response = await index.search(query, { targets: [good, bad] });
      index.close();

      // The good target's hits still come back - one bad module does not
      // sink the whole search.
      expect(response.hits.length).toBeGreaterThan(0);
      expect(response.hits.every(h => h.target.moduleUuid === 'kjv')).toBe(true);

      expect(response.skipped).toHaveLength(1);
      expect(response.skipped[0].target).toEqual(bad);
      expect(response.skipped[0].reason).toEqual({ state: 'unavailable', reason: 'no-fts-engine' });
    });

    it('open() with multiple targets fans a single search() out across all of them', async () => {
      // Registers the same real repository under two different targets -
      // there is only one real module database in this fixture, but this
      // still exercises the fan-out/grouping machinery genuinely: two
      // distinct targets, one search() call, hits correctly tagged per
      // target.
      const provider = new InModuleFts5Provider();
      const t1 = target('kjv-a');
      const t2 = target('kjv-b');
      provider.register(t1, kjvRepo);
      provider.register(t2, kjvRepo);

      const index = await provider.open([t1, t2]);
      const query: KeywordQuery = { kind: 'terms', terms: ['charity'], all: true };
      const response = await index.search(query, { targets: [t1, t2] });
      index.close();

      const t1Hits = response.hits.filter(h => h.target.moduleUuid === 'kjv-a');
      const t2Hits = response.hits.filter(h => h.target.moduleUuid === 'kjv-b');
      expect(t1Hits.length).toBeGreaterThan(0);
      expect(t1Hits.length).toBe(t2Hits.length);
      expect(response.skipped).toEqual([]);
    });

    it('close() does not throw and does not affect the underlying repository', async () => {
      const provider = new InModuleFts5Provider();
      const t = target('kjv');
      provider.register(t, kjvRepo);
      const index = await provider.open([t]);

      expect(() => index.close()).not.toThrow();

      // The repository this index closed over is owned elsewhere and stays
      // usable after close() - proven by opening a fresh index over the
      // same registration and searching successfully.
      const index2 = await provider.open([t]);
      const response = await index2.search({ kind: 'terms', terms: ['love'], all: true }, { targets: [t] });
      index2.close();
      expect(response.hits.length).toBeGreaterThan(0);
    });
  });

  describe('build() / prune() / pruneExcept()', () => {
    it('build() rejects: in-module FTS5 tables are not built by this provider', async () => {
      const provider = new InModuleFts5Provider();
      await expect(
        provider.build({
          target: target('kjv'),
          count: () => 0,
          documents: function* () {},
        })
      ).rejects.toThrow(/not supported/i);
    });

    it('prune() resolves without doing anything observable', async () => {
      const provider = new InModuleFts5Provider();
      await expect(provider.prune(target('kjv'))).resolves.toBeUndefined();
    });

    it('pruneExcept() resolves without doing anything observable', async () => {
      const provider = new InModuleFts5Provider();
      await expect(provider.pruneExcept([target('kjv')])).resolves.toBeUndefined();
    });
  });
});
