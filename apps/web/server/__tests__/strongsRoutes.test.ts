/**
 * Tests for /api/strongs.
 *
 * Every other route family under `server/routes/` has a test file; this one,
 * `interlinearRoutes` and `studyOverviewRoutes` did not. The interesting part
 * here is the three-format key fallback: modules in the wild store Strong's
 * keys as `G2316`, `02316` or `2316`, and the route tries all three. That
 * fallback is invisible from the outside until a dictionary that uses a
 * different convention stops resolving.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createStrongsRoutes } from '../routes/strongsRoutes';
import { TEST_DATA_DIR } from './testDataDir';

const dataDir = TEST_DATA_DIR;
let db: DatabaseManager;
let app: express.Express;

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }
  db = new DatabaseManager(dataDir, dataDir);
  app = express();
  app.use('/api/strongs', createStrongsRoutes(db));
});

afterAll(() => {
  db.closeAll();
});

describe('Strong\'s Routes — validation', () => {
  it.each([
    ['a bare word', 'love'],
    ['a number with no language prefix', '2316'],
    ['an unknown prefix', 'X2316'],
    ['a path traversal attempt', '..%2F..%2Fmain'],
    ['a SQL-looking payload', "G1'%20OR%20'1'='1"],
  ])('rejects %s with 400', async (_label, value) => {
    const res = await request(app).get(`/api/strongs/${value}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('rejects an empty number as a missing route rather than a lookup', async () => {
    const res = await request(app).get('/api/strongs/');

    expect(res.status).toBe(404);
  });
});

describe('Strong\'s Routes — lookup', () => {
  it('returns the Greek entry for G25', async () => {
    const res = await request(app).get('/api/strongs/G25');

    expect(res.status).toBe(200);
    expect(res.body.strongsNumber).toBe('G25');
    expect(typeof res.body.definition).toBe('string');
    expect(res.body.definition.length).toBeGreaterThan(0);
  });

  it('resolves the zero-padded key form', async () => {
    // Strong's Greek stores G25 as entry `00025`, so a plain `getEntryByKey('G25')`
    // misses and the padded fallback is what actually finds it. If that fallback
    // is ever dropped, this is the test that notices.
    const res = await request(app).get('/api/strongs/G0025');

    expect(res.status).toBe(200);
    expect(res.body.definition.length).toBeGreaterThan(0);
  });

  it('routes H-numbers to the Hebrew dictionary', async () => {
    const greek = await request(app).get('/api/strongs/G25');
    const hebrew = await request(app).get('/api/strongs/H25');

    expect(hebrew.status).toBe(200);
    // Same numeric part, different dictionary — the prefix has to pick the
    // dictionary, not just decorate the response.
    expect(hebrew.body.definition).not.toBe(greek.body.definition);
  });

  it('echoes back the number as asked for', async () => {
    const res = await request(app).get('/api/strongs/H1');

    expect(res.status).toBe(200);
    expect(res.body.strongsNumber).toBe('H1');
  });

  it('returns 404 for a well-formed number with no entry', async () => {
    const res = await request(app).get('/api/strongs/G99999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('exposes only the entry fields the client needs', async () => {
    const res = await request(app).get('/api/strongs/G25');

    expect(Object.keys(res.body).sort()).toEqual(
      ['definition', 'etymology', 'partOfSpeech', 'strongsNumber', 'transliteration', 'word'].sort(),
    );
  });
});
