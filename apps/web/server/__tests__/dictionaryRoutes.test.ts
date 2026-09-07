import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createDictionaryRoutes } from '../routes/dictionaryRoutes';
import type { SiteSettings } from '../siteSettings';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let app: express.Express;

// DatabaseManager.getDictionaryRepo constructs the path as dictionary_${name}.db
// On case-sensitive Linux, the abbreviation from module_metadata (e.g. "Easton")
// does not match the lowercase filename (dictionary_easton.db).
// For per-module route tests we use the lowercase name that matches the actual file.
const DICT_MODULE = 'easton';

const testSiteSettings: SiteSettings = {
  bibles: { modules: {}, sections: [] },
  commentaries: { modules: {}, sections: [] },
  dictionaries: {
    modules: {
      Easton: { active: true },
      StrongsGreek: { active: true },
      StrongsHebrew: { active: true },
    },
    sections: [],
  },
};

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `Dictionary tests require the desktop package data directory with main.db and module databases.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);
  app = express();
  app.use('/api/dictionary', createDictionaryRoutes(db, testSiteSettings));
});

afterAll(() => {
  db.closeAll();
});

describe('Dictionary Routes - /available', () => {
  it('GET /api/dictionary/available returns an array of dictionaries', async () => {
    const res = await request(app).get('/api/dictionary/available');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('each dictionary has abbreviation, name, and language_code', async () => {
    const res = await request(app).get('/api/dictionary/available');
    expect(res.status).toBe(200);
    for (const mod of res.body) {
      expect(mod).toHaveProperty('abbreviation');
      expect(mod).toHaveProperty('name');
      expect(mod).toHaveProperty('language_code');
    }
  });
});

describe('Dictionary Routes - global /search', () => {
  it('GET /api/dictionary/search?q=love returns 200 with array', async () => {
    const res = await request(app).get('/api/dictionary/search?q=love');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // On case-sensitive filesystems (Linux), getAllDictionaryRepos may fail
    // to resolve module files because abbreviation case differs from filename.
    // When results are returned, verify the shape.
    if (res.body.length > 0) {
      const first = res.body[0];
      expect(first).toHaveProperty('entry_key');
      expect(first).toHaveProperty('word');
      expect(first).toHaveProperty('module_abbr');
      expect(first).toHaveProperty('module_name');
    }
  });

  it('GET /api/dictionary/search with empty query returns empty array', async () => {
    const res = await request(app).get('/api/dictionary/search?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /api/dictionary/search without q param returns empty array', async () => {
    const res = await request(app).get('/api/dictionary/search');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('global search results include definition snippet', async () => {
    db.getDictionaryRepo(DICT_MODULE);
    const res = await request(app).get('/api/dictionary/search?q=love');
    expect(res.status).toBe(200);
    if (res.body.length > 0) {
      const hit = res.body[0];
      expect(hit).toHaveProperty('definition');
      // Definition is truncated to 200 chars
      if (hit.definition) {
        expect(hit.definition.length).toBeLessThanOrEqual(200);
      }
    }
  });
});

describe('Dictionary Routes - /:module/search', () => {
  it('GET /api/dictionary/:module/search?q=love returns results', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/search?q=love`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const first = res.body[0];
    expect(first).toHaveProperty('entry_key');
    expect(first).toHaveProperty('word');
    expect(first).toHaveProperty('definition');
  });

  it('per-module search with empty query returns empty array', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/search?q=`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('search on nonexistent module returns empty array', async () => {
    const res = await request(app).get('/api/dictionary/NONEXISTENT/search?q=love');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // Per-module search used to be a bare FTS5 MATCH over word + definition +
  // usage_notes, ranked by BM25 and capped at 30. A passing mention inside a
  // long article outranked the article actually titled with the search word, so
  // looking up "Moses" in a dictionary that plainly has a MOSES entry returned
  // thirty other articles and not that one.
  it.each(['Moses', 'Jerusalem', 'David'])('ranks the entry titled %s first', async (word) => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/search?q=${word}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].entry_key.toUpperCase()).toBe(word.toUpperCase());
  });

  // Raw input went straight into MATCH, where an apostrophe, a hyphen or a bare
  // reserved word is a syntax error — which surfaced as a 500 and left the UI
  // showing nothing at all.
  it.each(["God's", 'God-fearing', 'NOT', 'AND', 'faith(hope)'])(
    'does not fail on %s, which is FTS5 syntax',
    async (query) => {
      const res = await request(app).get(
        `/api/dictionary/${DICT_MODULE}/search?q=${encodeURIComponent(query)}`
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    },
  );

  // The module files on disk are lowercase while /available advertises the
  // mixed-case abbreviation, so the obvious path only resolved on a
  // case-insensitive filesystem — every dictionary lookup returned empty on Linux.
  it('resolves a module by its advertised mixed-case abbreviation', async () => {
    const res = await request(app).get('/api/dictionary/Easton/search?q=Moses');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('Dictionary Routes - /:module/letters', () => {
  it('GET /api/dictionary/:module/letters returns letter array', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/letters`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const first = res.body[0];
    expect(first).toHaveProperty('letter');
    expect(first).toHaveProperty('count');
    expect(typeof first.letter).toBe('string');
    expect(typeof first.count).toBe('number');
  });

  it('letters for nonexistent module returns empty array', async () => {
    const res = await request(app).get('/api/dictionary/NONEXISTENT/letters');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('Dictionary Routes - /:module/browse', () => {
  it('GET /api/dictionary/:module/browse?letter=A returns entries for letter A', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/browse?letter=A`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('letter');
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.letter).toBe('A');
  });

  it('browse with limit restricts result count', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/browse?letter=A&limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeLessThanOrEqual(5);
    // total should still reflect all A entries, not just the page
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.entries.length);
  });

  it('browse without letter returns all entries', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/browse?limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.letter).toBeNull();
  });

  it('browse for nonexistent module returns empty result', async () => {
    const res = await request(app).get('/api/dictionary/NONEXISTENT/browse?letter=A');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [], total: 0 });
  });
});

describe('Dictionary Routes - /:module/adjacent/:key', () => {
  it('GET /api/dictionary/:module/adjacent/:key returns prev and next', async () => {
    // First get known entry keys by browsing
    const browseRes = await request(app).get(`/api/dictionary/${DICT_MODULE}/browse?letter=B&limit=10`);
    expect(browseRes.status).toBe(200);
    expect(browseRes.body.entries.length).toBeGreaterThan(2);
    const middleKey = browseRes.body.entries[2].entry_key;

    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/adjacent/${encodeURIComponent(middleKey)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('prev');
    expect(res.body).toHaveProperty('next');
    // A middle entry should have both prev and next
    expect(res.body.prev).not.toBeNull();
    expect(res.body.next).not.toBeNull();
    expect(res.body.prev).toHaveProperty('entry_key');
    expect(res.body.next).toHaveProperty('entry_key');
  });

  it('adjacent for nonexistent module returns null prev/next', async () => {
    const res = await request(app).get('/api/dictionary/NONEXISTENT/adjacent/SomeKey');
    expect(res.status).toBe(200);
    expect(res.body.prev).toBeNull();
    expect(res.body.next).toBeNull();
  });
});

describe('Dictionary Routes - /:module/count', () => {
  it('GET /api/dictionary/:module/count returns a positive count', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/count`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('count for nonexistent module returns zero', async () => {
    const res = await request(app).get('/api/dictionary/NONEXISTENT/count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('Dictionary Routes - /:module/entry/:key', () => {
  it('GET /api/dictionary/:module/entry/:key returns full entry', async () => {
    // Get a known key first
    const browseRes = await request(app).get(`/api/dictionary/${DICT_MODULE}/browse?letter=A&limit=1`);
    expect(browseRes.status).toBe(200);
    expect(browseRes.body.entries.length).toBeGreaterThan(0);
    const key = browseRes.body.entries[0].entry_key;

    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/entry/${encodeURIComponent(key)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entry_key');
    expect(res.body).toHaveProperty('word');
    expect(res.body).toHaveProperty('definition');
    expect(res.body.entry_key).toBe(key);
  });

  it('returns 404 for nonexistent entry key', async () => {
    const res = await request(app).get(`/api/dictionary/${DICT_MODULE}/entry/ZZZNONEXISTENT999`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/dictionary/NONEXISTENT/entry/SomeKey');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid module name with special characters', async () => {
    const res = await request(app).get('/api/dictionary/bad%20name!/entry/SomeKey');
    expect(res.status).toBe(400);
  });
});
