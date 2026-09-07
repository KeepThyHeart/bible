import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createCommentaryRoutes } from '../routes/commentaryRoutes';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let app: express.Express;

// Discovered at setup time
let commentaryModule: string;  // lowercase abbreviation that matches the filename

// These hit real commentary databases — tens of MB of SQLite — while the rest
// of the suite runs in parallel workers. Individually they take a few hundred
// milliseconds; under that contention they occasionally crossed the 5s default
// and failed a run for reasons that had nothing to do with the routes.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `Commentary route tests require the desktop package data directory with main.db.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);

  // Discover a valid commentary module from the metadata
  const mods = db.getModuleMetadataRepo().getByType('commentary');
  if (mods.length === 0) throw new Error('No commentary modules found in test data.');
  const abbr = mods[0].abbreviation || mods[0].getAbbreviation();
  commentaryModule = abbr ?? 'abbott';

  // Pass null for siteSettings so no filtering is applied
  app = express();
  app.use(express.json());
  app.use('/api/commentary', createCommentaryRoutes(db, null));
});

afterAll(() => {
  db.closeAll();
});

// ---------------------------------------------------------------------------
// GET /api/commentary/availability/:book/:chapter
// ---------------------------------------------------------------------------
describe('GET /api/commentary/availability/:book/:chapter', () => {
  it('returns object with module availability for valid book/chapter (John 3)', async () => {
    const res = await request(app).get('/api/commentary/availability/43/3');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
    // Each key should have hasVerse and hasChapter booleans
    for (const abbr of Object.keys(res.body)) {
      expect(res.body[abbr]).toHaveProperty('hasVerse');
      expect(res.body[abbr]).toHaveProperty('hasChapter');
    }
  });

  it('returns 400 for book number 0', async () => {
    const res = await request(app).get('/api/commentary/availability/0/1');
    expect(res.status).toBe(400);
  });

  it('returns 400 for book number 67', async () => {
    const res = await request(app).get('/api/commentary/availability/67/1');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid chapter 0', async () => {
    const res = await request(app).get('/api/commentary/availability/1/0');
    expect(res.status).toBe(400);
  });

  it('includes verse availability when verse query param provided', async () => {
    const res = await request(app).get('/api/commentary/availability/43/3?verse=16');
    expect(res.status).toBe(200);
    for (const abbr of Object.keys(res.body)) {
      expect(res.body[abbr]).toHaveProperty('hasVerse');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/commentary/home/:book/:chapter
// ---------------------------------------------------------------------------
describe('GET /api/commentary/home/:book/:chapter', () => {
  it('returns verse/passage/chapter module arrays for valid book/chapter', async () => {
    const res = await request(app).get('/api/commentary/home/43/3');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('verseModules');
    expect(res.body).toHaveProperty('passageModules');
    expect(res.body).toHaveProperty('chapterModules');
    expect(Array.isArray(res.body.verseModules)).toBe(true);
    expect(Array.isArray(res.body.passageModules)).toBe(true);
    expect(Array.isArray(res.body.chapterModules)).toBe(true);
  });

  it('returns 400 for invalid book number', async () => {
    const res = await request(app).get('/api/commentary/home/0/1');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid chapter', async () => {
    const res = await request(app).get('/api/commentary/home/43/0');
    expect(res.status).toBe(400);
  });

  it('includes verse-level modules when verse query param provided', async () => {
    const res = await request(app).get('/api/commentary/home/43/3?verse=16');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('verseModules');
  });
});

// ---------------------------------------------------------------------------
// GET /api/commentary/info/:module
// ---------------------------------------------------------------------------
describe('GET /api/commentary/info/:module', () => {
  it('returns module info for valid module', async () => {
    const res = await request(app).get(`/api/commentary/info/${commentaryModule}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('abbreviation');
    expect(res.body).toHaveProperty('fullName');
    expect(res.body).toHaveProperty('languageCode');
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/commentary/info/NONEXISTENT_XYZ');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid module name', async () => {
    const res = await request(app).get('/api/commentary/info/bad name!');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/commentary/:module/chapter-verses/:book/:chapter
// ---------------------------------------------------------------------------
describe('GET /api/commentary/:module/chapter-verses/:book/:chapter', () => {
  it('returns verse array for valid module/book/chapter', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/chapter-verses/43/3`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('verses');
    expect(Array.isArray(res.body.verses)).toBe(true);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/commentary/NONEXISTENT_XYZ/chapter-verses/43/3');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid book number', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/chapter-verses/0/1`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid chapter', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/chapter-verses/43/0`);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/commentary/:module/verse/:verseId
// ---------------------------------------------------------------------------
describe('GET /api/commentary/:module/verse/:verseId', () => {
  it('returns entries array for valid module and verseId', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/verse/43003016`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('returns 400 for invalid verseId (zero)', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/verse/0`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric verseId', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/verse/john3v16`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/commentary/NONEXISTENT_XYZ/verse/43003016');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid module name', async () => {
    const res = await request(app).get('/api/commentary/bad name!/verse/43003016');
    expect(res.status).toBe(400);
  });

  it('sets Cache-Control header', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/verse/43003016`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /api/commentary/all/:book/:chapter
// ---------------------------------------------------------------------------
describe('GET /api/commentary/all/:book/:chapter', () => {
  it('returns modules object for valid book/chapter', async () => {
    const res = await request(app).get('/api/commentary/all/43/3');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('modules');
    expect(typeof res.body.modules).toBe('object');
  });

  it('does not exceed MAX_COMMENTARY_MODULES (10) modules', async () => {
    const res = await request(app).get('/api/commentary/all/43/3');
    expect(res.status).toBe(200);
    const moduleCount = Object.keys(res.body.modules).length;
    expect(moduleCount).toBeLessThanOrEqual(10);
  });

  it('returns 400 for invalid book number', async () => {
    const res = await request(app).get('/api/commentary/all/0/1');
    expect(res.status).toBe(400);
  });

  it('returns 400 for book number 67', async () => {
    const res = await request(app).get('/api/commentary/all/67/1');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid chapter', async () => {
    const res = await request(app).get('/api/commentary/all/43/0');
    expect(res.status).toBe(400);
  });

  it('sets Cache-Control header', async () => {
    const res = await request(app).get('/api/commentary/all/43/3');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
  });

  // The `modules` filter exists so the client can prefetch a size-budgeted
  // subset instead of every active commentary — a chapter of the largest
  // modules runs to megabytes, which is not a payload to hand a phone
  // speculatively.
  describe('?modules= filter', () => {
    it('returns only the requested modules', async () => {
      const full = await request(app).get('/api/commentary/all/43/3');
      const available = Object.keys(full.body.modules);
      // Needs at least two active commentaries to be a meaningful assertion.
      if (available.length < 2) return;

      const wanted = available[0];
      const res = await request(app).get(`/api/commentary/all/43/3?modules=${wanted}`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.modules)).toEqual([wanted]);
    });

    it('ignores unknown module names rather than erroring', async () => {
      const res = await request(app).get('/api/commentary/all/43/3?modules=NoSuchModule');
      expect(res.status).toBe(200);
      expect(res.body.modules).toEqual({});
    });

    it('rejects path traversal in a module name without erroring', async () => {
      const res = await request(app).get('/api/commentary/all/43/3?modules=../../etc/passwd');
      expect(res.status).toBe(200);
      expect(res.body.modules).toEqual({});
    });

    it('keeps the valid names when the list also contains invalid ones', async () => {
      const full = await request(app).get('/api/commentary/all/43/3');
      const available = Object.keys(full.body.modules);
      if (available.length < 1) return;

      const res = await request(app).get(`/api/commentary/all/43/3?modules=${available[0]},../bad`);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.modules)).toEqual([available[0]]);
    });

    it('returns everything active when the parameter is absent', async () => {
      const full = await request(app).get('/api/commentary/all/43/3');
      expect(full.status).toBe(200);
      expect(Object.keys(full.body.modules).length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/commentary/:module/:book/:chapter
// ---------------------------------------------------------------------------
describe('GET /api/commentary/:module/:book/:chapter', () => {
  it('returns entries array for valid module/book/chapter (John 3)', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/43/3`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
    expect(Array.isArray(res.body.entries)).toBe(true);
    if (res.body.entries.length > 0) {
      const first = res.body.entries[0];
      expect(first).toHaveProperty('entry_id');
      expect(first).toHaveProperty('verse_id_start');
      expect(first).toHaveProperty('content');
    }
  });

  it('returns 400 for invalid book number', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/0/1`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for book number 67', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/67/1`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid chapter', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/43/0`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid module name', async () => {
    const res = await request(app).get('/api/commentary/bad name!/43/3');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/commentary/NONEXISTENT_XYZ/43/3');
    expect(res.status).toBe(404);
  });

  it('handles Genesis 1 (first book boundary)', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/1/1`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
  });

  it('sets Cache-Control header', async () => {
    const res = await request(app).get(`/api/commentary/${commentaryModule}/43/3`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
  });
});
