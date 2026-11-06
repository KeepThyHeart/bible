import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { RemoteSemantic } from '@bible/core';
import { DatabaseManager } from '../DatabaseManager';
import { createSearchRoutes } from '../routes/searchRoutes';
import { RemoteSemanticService } from '../search/RemoteSemanticService';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

/**
 * Search route hardening (task 0207): W-001 (no regular expressions),
 * W-003 (verse-proximity caps), W-002 (module casing), W-010 (semantic
 * maxResults) and W-014 (Strong's scope).
 */

// ---------------------------------------------------------------------------
// Real data
// ---------------------------------------------------------------------------
const HAS_DATA = existsSync(resolve(TEST_DATA_DIR, 'main.db'));

describe.skipIf(!HAS_DATA)('search route hardening (real data)', { timeout: 60_000 }, () => {
  let db: DatabaseManager;
  let app: express.Express;

  beforeAll(() => {
    db = new DatabaseManager(TEST_DATA_DIR, TEST_MODULES_DIR);
    app = express();
    app.use('/api/search', createSearchRoutes(db, {}));
  }, 60_000);

  afterAll(() => {
    db.closeAll();
  });

  describe('W-001: /pattern/ queries', () => {
    it('answers 400 INVALID_PARAM for the catastrophic-backtracking pattern, quickly', async () => {
      const t = Date.now();
      const res = await request(app).get('/api/search/keyword').query({ q: '/^(\\w+\\s?)*$/', modules: 'KJV' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
      expect(res.body.error.message).toBe('Pattern (regular expression) search is not available here');
      expect(Date.now() - t).toBeLessThan(5000);
    });

    it('answers 400 for any pattern, valid or not', async () => {
      for (const q of ['/love/', '/[/']) {
        const res = await request(app).get('/api/search/keyword').query({ q, modules: 'KJV' });
        expect(res.status, q).toBe(400);
        expect(res.body.error.message, q).toMatch(/^Pattern \(regular expression\) search/);
      }
    });
  });

  describe('W-003: verse-proximity caps', () => {
    it('answers 400 beyond 6 terms or 100 verses', async () => {
      const tooMany = await request(app).get('/api/search/keyword').query({ q: 'a b c d e f g ~3v', modules: 'KJV' });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.error.code).toBe('INVALID_PARAM');
      const tooFar = await request(app).get('/api/search/keyword').query({ q: 'faith hope ~101v', modules: 'KJV' });
      expect(tooFar.status).toBe(400);
      expect(tooFar.body.error.code).toBe('INVALID_PARAM');
    });

    it('still runs queries inside the caps', async () => {
      const res = await request(app).get('/api/search/keyword').query({ q: 'faith hope ~5v', modules: 'KJV' });
      expect(res.status).toBe(200);
      expect(res.body.totalAvailable).toBeGreaterThan(0);
    });
  });

  describe('W-002: module casing', () => {
    it('a lowercase module name does not break the canonical one, nor duplicate the Bible', async () => {
      const lower = await request(app).get('/api/search/keyword').query({ q: 'charity', modules: 'kjv' });
      const canonical = await request(app).get('/api/search/keyword').query({ q: 'charity', modules: 'KJV' });
      const mixed = await request(app).get('/api/search/keyword').query({ q: 'charity', modules: 'Kjv' });
      expect(lower.status).toBe(200);
      expect(canonical.status).toBe(200);
      expect(canonical.body.totalAvailable).toBeGreaterThan(0);
      expect(lower.body.totalAvailable).toBe(canonical.body.totalAvailable);
      expect(mixed.body.totalAvailable).toBe(canonical.body.totalAvailable);

      const registered = db.getSearchService()!.getRegisteredModules();
      expect(registered.filter(m => m.toLowerCase() === 'kjv')).toEqual(['KJV']);

      const none = await request(app).get('/api/search/keyword').query({ q: 'charity' });
      expect(none.status).toBe(200);
      expect(none.body.totalAvailable).toBeGreaterThan(0);
    });
  });

  describe('W-014: Strong\'s scope', () => {
    it('answers 400 for a scope that is not a whole book number', async () => {
      for (const scope of ['1.5', '0', '67', 'abc']) {
        const res = await request(app).get('/api/search/strongs').query({ number: 'G26', scope });
        expect(res.status, scope).toBe(400);
        expect(res.body.error.code, scope).toBe('INVALID_PARAM');
      }
    });

    it('accepts a whole book number', async () => {
      const res = await request(app).get('/api/search/strongs').query({ number: 'G26', scope: '46' });
      expect(res.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// W-010: semantic maxResults (stubbed remote, no data needed)
// ---------------------------------------------------------------------------
describe('W-010: /api/search/semantic maxResults', () => {
  const CONSENT = String(RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION);
  const repo = { getVerse: (id: number) => ({ text: `text ${id}` }), getVerseRange: () => [] };
  const db = {
    getBookRepo: () => ({ getAll: () => [{ bookNumber: 43, bookName: 'John' }] }),
    getEnrichmentsDb: () => { throw new Error('none'); },
    getBibleRepo: (m: string) => (m === 'KJV' ? repo : null),
    resolveAbbreviation: (m: string) => m,
    getDefaultBibleAbbreviation: () => 'KJV',
    getSearchService: () => null,
  } as never;

  async function sentK(maxResults: string | undefined): Promise<string | null> {
    const f = vi.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({
      mode: 'semantic', degraded: false, results: [{ rank: 1, id: 'KJV.JHN.3.16', score: 0.9 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new RemoteSemantic.RemoteSemanticClient({
      baseUrl: 'http://bibsearch.internal:8080', fetch: f as unknown as typeof fetch, sleep: async () => {},
    });
    const app = express();
    app.use('/api/search', createSearchRoutes(db, { remote: new RemoteSemanticService(client) }));
    const query: Record<string, string> = { q: 'forgiveness' };
    if (maxResults !== undefined) query.maxResults = maxResults;
    const res = await request(app).get('/api/search/semantic').query(query).set('X-Remote-Search-Consent', CONSENT);
    expect(res.status).toBe(200);
    return new URL(String(f.mock.calls[0][0])).searchParams.get('k');
  }

  it('clamps to an integer from 1 to 500 at the route (the remote client then caps k at 100), defaulting to 20', async () => {
    expect(await sentK(undefined)).toBe('20');
    expect(await sentK('abc')).toBe('20');
    expect(await sentK('0')).toBe('1');
    expect(await sentK('-7')).toBe('1');
    expect(await sentK('12.9')).toBe('12');
    expect(await sentK('999')).toBe('100'); // route allows 500; RemoteSemanticClient caps k at 100
    expect(await sentK('100')).toBe('100');
  });
});
