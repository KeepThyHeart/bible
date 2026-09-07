import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createSearchRoutes } from '../routes/searchRoutes';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let app: express.Express;

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `Search route tests require the desktop package data directory with main.db and module databases.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);

  // Load at least one Bible module into the search service
  const mods = db.getModuleMetadataRepo().getByType('bible');
  if (mods.length > 0) {
    const abbr = (mods[0].abbreviation || mods[0].getAbbreviation()) ?? 'KJV';
    const repo = db.getBibleRepo(abbr);
    if (repo) {
      const searchService = db.getSearchService();
      searchService?.addBibleModule(abbr, repo);
    }
  }

  // Strong's search reads the interlinear table, which only KJV carries — without
  // it the Strong's cases below would assert against an empty result set.
  const kjvRepo = db.getBibleRepo('KJV');
  if (kjvRepo) db.getSearchService()?.addBibleModule('KJV', kjvRepo);

  app = express();
  app.use(express.json());
  // No pipeline or topicEntries: semantic search will be unavailable (503)
  app.use('/api/search', createSearchRoutes(db, {}));
});

afterAll(() => {
  db.closeAll();
});

// ---------------------------------------------------------------------------
// POST /api/search/semantic/warmup
// ---------------------------------------------------------------------------
describe('POST /api/search/semantic/warmup', () => {
  it('returns unavailable when no pipeline is configured', async () => {
    const res = await request(app).post('/api/search/semantic/warmup');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'unavailable');
  });
});

// ---------------------------------------------------------------------------
// GET /api/search/keyword
// ---------------------------------------------------------------------------
describe('GET /api/search/keyword', () => {
  it('returns 400 when query parameter is missing', async () => {
    const res = await request(app).get('/api/search/keyword');
    expect(res.status).toBe(400);
  });

  it('returns results for a valid query', async () => {
    const res = await request(app).get('/api/search/keyword?q=love');
    // Search may succeed or return empty array; should not be 4xx/5xx except 500 if no search service
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
    }
  });

  it('caps pageSize at 100 (does not crash with large value)', async () => {
    const res = await request(app).get('/api/search/keyword?q=love&pageSize=9999');
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.results.length).toBeLessThanOrEqual(100);
    }
  });

  it('returns 400 for an over-long query', async () => {
    const res = await request(app).get(`/api/search/keyword?q=${'a'.repeat(600)}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a whitespace-only query', async () => {
    const res = await request(app).get('/api/search/keyword?q=%20%20%20');
    expect(res.status).toBe(400);
  });

  it('returns results with expected shape', async () => {
    const res = await request(app).get('/api/search/keyword?q=god');
    if (res.status === 200 && res.body.results.length > 0) {
      const first = res.body.results[0];
      expect(first).toHaveProperty('verseId');
      expect(first).toHaveProperty('reference');
      expect(first).toHaveProperty('text');
      // The real MatchType, not the constant 'bible' this used to flatten to:
      // the browser needs it to badge approximate matches and to leave them out
      // of the distribution chart.
      expect(['exact', 'fuzzy', 'stem']).toContain(first.type);
    }
  });

  it('never flattens the match type to a constant', async () => {
    // Regression: every keyword result used to be mapped with a hardcoded
    // `type: 'bible'`, so `MatchType` never reached the browser. Asserted
    // unguarded — this file already requires the module data, so an empty
    // result set for "god" is itself a failure worth seeing.
    const res = await request(app).get('/api/search/keyword?q=god');
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const r of res.body.results) {
      expect(['exact', 'fuzzy', 'stem']).toContain(r.type);
    }
  });

  it('returns total count matching results array length', async () => {
    const res = await request(app).get('/api/search/keyword?q=faith');
    if (res.status === 200) {
      expect(res.body.total).toBe(res.body.results.length);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/search/semantic
// ---------------------------------------------------------------------------
describe('GET /api/search/semantic', () => {
  it('returns 400 when query parameter is missing', async () => {
    const res = await request(app).get('/api/search/semantic');
    expect(res.status).toBe(400);
  });

  it('returns 503 when semantic pipeline is not configured', async () => {
    const res = await request(app).get('/api/search/semantic?q=love');
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('error');
  });

  // Query length is validated before the pipeline is consulted, so an
  // over-long query is rejected outright rather than reaching the embedder —
  // a 15k-char query costs ~10s of CPU and ~1.5 GB of transient RSS.
  it('returns 400 for an over-long query, ahead of any pipeline work', async () => {
    const res = await request(app).get(`/api/search/semantic?q=${'a'.repeat(600)}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a whitespace-only query', async () => {
    const res = await request(app).get('/api/search/semantic?q=%20%20%20');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/search/strongs
// ---------------------------------------------------------------------------
describe('GET /api/search/strongs', () => {
  it('returns 400 when number parameter is missing', async () => {
    const res = await request(app).get('/api/search/strongs');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid Strong\'s number format', async () => {
    const res = await request(app).get('/api/search/strongs?number=INVALID');
    expect(res.status).toBe(400);
  });

  it('returns 200 or 500 for a valid Strong\'s number', async () => {
    // G25 = love (agape); H7225 = beginning (reshith)
    const res = await request(app).get('/api/search/strongs?number=G25');
    // 200 if search service available, 500 if search not available
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('results');
    }
  });

  it('reports the unclamped occurrence count so the client knows more exist', async () => {
    const res = await request(app).get('/api/search/strongs?number=G25&maxResults=5');
    expect([200, 500]).toContain(res.status);
    if (res.status !== 200) return;
    expect(typeof res.body.totalAvailable).toBe('number');
    // totalAvailable must never undercount what was actually returned.
    expect(res.body.totalAvailable).toBeGreaterThanOrEqual(res.body.total);
    if (res.body.total === 5) {
      // The page was capped, so there is more behind it.
      expect(res.body.totalAvailable).toBeGreaterThan(res.body.total);
    }
  });

  it('honours a maxResults above the old 100 ceiling', async () => {
    const small = await request(app).get('/api/search/strongs?number=G25&maxResults=100');
    const large = await request(app).get('/api/search/strongs?number=G25&maxResults=500');
    expect([200, 500]).toContain(large.status);
    if (small.status !== 200 || large.status !== 200) return;
    // Only meaningful when the word actually has more than 100 occurrences.
    if (large.body.totalAvailable > 100) {
      expect(large.body.results.length).toBeGreaterThan(small.body.results.length);
    }
  });

  it('falls back to the default page size for garbage maxResults', async () => {
    const res = await request(app).get('/api/search/strongs?number=G25&maxResults=abc');
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.results.length).toBeLessThanOrEqual(100);
    }
  });

  it('caps maxResults at the ceiling (does not crash with a huge value)', async () => {
    const res = await request(app).get('/api/search/strongs?number=G25&maxResults=999999');
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.results.length).toBeLessThanOrEqual(5000);
    }
  });
});
