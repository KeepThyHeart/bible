/**
 * Tests for /api/interlinear and /api/study-overview.
 *
 * Both route modules were untested while every other route family had a file.
 *
 * The interlinear payload is the one place where a silent off-by-one is
 * expensive: `position` / `positionEnd` are indices into the same English word
 * sequence `utils/wordIndexing.ts` produces, and the client aligns original-
 * language rows against the English text with them. A missing `positionEnd`,
 * or an exclusive one where the client expects inclusive, shifts every row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createInterlinearRoutes } from '../routes/interlinearRoutes';
import { createStudyOverviewRoutes } from '../routes/studyOverviewRoutes';
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
  app.use('/api/interlinear', createInterlinearRoutes(db));
  app.use('/api/study-overview', createStudyOverviewRoutes(db));
});

afterAll(() => {
  db.closeAll();
});

describe('Interlinear Routes — validation', () => {
  it.each([
    ['book 0', '/api/interlinear/0/1'],
    ['book 67', '/api/interlinear/67/1'],
    ['a non-numeric book', '/api/interlinear/abc/1'],
    ['chapter 0', '/api/interlinear/1/0'],
    ['a non-numeric chapter', '/api/interlinear/1/xyz'],
  ])('rejects %s with 400', async (_label, url) => {
    const res = await request(app).get(url);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('accepts the boundary books', async () => {
    expect((await request(app).get('/api/interlinear/1/1')).status).toBe(200);
    expect((await request(app).get('/api/interlinear/66/1')).status).toBe(200);
  });
});

describe('Interlinear Routes — payload', () => {
  it('returns an empty payload rather than an error for an unavailable module', async () => {
    // A missing module is an ordinary state, not a failure: the client renders
    // plain text and moves on.
    //
    // Only the `!repo` half of the route's guard is reachable here. The other
    // half — a module present but carrying no interlinear rows — cannot be
    // exercised against this dataset, because all four translations activated
    // in `data/settings.json` (KJV, BSB, ASV, WEB) ship interlinear data.
    const res = await request(app).get('/api/interlinear/1/1?module=NoSuchModule');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ words: [], strongsEntries: {} });
  });

  it('always answers with both keys, whatever the data', async () => {
    const res = await request(app).get('/api/interlinear/43/3');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.words)).toBe(true);
    expect(typeof res.body.strongsEntries).toBe('object');
  });

  it('gives every word the fields the client aligns on', async () => {
    const res = await request(app).get('/api/interlinear/43/3');

    for (const word of res.body.words.slice(0, 25)) {
      expect(Number.isInteger(word.verseId)).toBe(true);
      // Both ends: the client cannot map a row onto the English text with only
      // a start index.
      expect(Number.isInteger(word.position)).toBe(true);
      expect(Number.isInteger(word.positionEnd)).toBe(true);
      expect(word.positionEnd).toBeGreaterThanOrEqual(word.position);
      expect(['Hebrew', 'Greek']).toContain(word.language);
    }
  });

  it('never leaves a text field undefined', async () => {
    // The client concatenates these straight into the DOM; `undefined` would
    // render as the word "undefined" in the interlinear row.
    const res = await request(app).get('/api/interlinear/43/3');

    for (const word of res.body.words.slice(0, 25)) {
      for (const field of ['originalWord', 'transliteration', 'strongsNumber', 'morphology', 'gloss']) {
        expect(typeof word[field]).toBe('string');
      }
    }
  });

  it('strips OSIS markup out of the original word and gloss', async () => {
    const res = await request(app).get('/api/interlinear/43/3');

    for (const word of res.body.words.slice(0, 50)) {
      expect(word.originalWord).not.toMatch(/<[^>]+>/);
      expect(word.gloss).not.toMatch(/<[^>]+>/);
    }
  });

  it('keys Strong\'s entries by the numbers the words reference', async () => {
    const res = await request(app).get('/api/interlinear/43/3');
    const referenced = new Set<string>(
      res.body.words.map((w: { strongsNumber: string }) => w.strongsNumber).filter(Boolean),
    );

    // Entries are looked up per distinct number, so the map may be smaller than
    // the reference set (some numbers have no dictionary entry) but must never
    // carry a key nothing referenced.
    for (const key of Object.keys(res.body.strongsEntries)) {
      expect(referenced.has(key)).toBe(true);
    }
  });

  it('gives each Strong\'s entry a brief meaning parsed from its definition', async () => {
    const res = await request(app).get('/api/interlinear/43/3');
    const entries = Object.values(res.body.strongsEntries) as Array<{ briefMeaning: string; definition: string }>;

    for (const entry of entries.slice(0, 20)) {
      expect(typeof entry.briefMeaning).toBe('string');
      // The brief meaning is cut from after ":--", so it must not carry the
      // etymology or the separator along with it.
      expect(entry.briefMeaning).not.toContain(':--');
    }
  });
});

describe('Study Overview Routes', () => {
  it.each([
    ['book 0', '/api/study-overview/0/1'],
    ['book 67', '/api/study-overview/67/1'],
    ['a non-numeric book', '/api/study-overview/abc/1'],
    ['chapter 0', '/api/study-overview/1/0'],
    ['a non-numeric chapter', '/api/study-overview/1/abc'],
  ])('rejects %s with 400', async (_label, url) => {
    const res = await request(app).get(url);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('answers with the full shape whether or not the cache exists', async () => {
    // The route degrades to an empty structure when the study cache has not
    // been generated. The client destructures all five keys, so a partial
    // response is worse than an empty one.
    const res = await request(app).get('/api/study-overview/43/3');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.commentary)).toBe(true);
    expect(typeof res.body.topics).toBe('object');
    expect(typeof res.body.crossrefs).toBe('object');
    expect(typeof res.body.entities).toBe('object');
    expect(typeof res.body.cached).toBe('boolean');
  });
});
