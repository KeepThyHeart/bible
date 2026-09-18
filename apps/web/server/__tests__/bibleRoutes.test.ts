import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createBibleRoutes } from '../routes/bibleRoutes';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let app: express.Express;

// Discovered at setup time from the actual database
let bibleModule: string;         // any valid Bible module (may be NT-only)
let fullBibleModule: string;     // module with full OT+NT coverage
let validVerseId: number;        // e.g. 43003016 (John 3:16)

// Known full-Bible module abbreviations to try first before scanning
const FULL_BIBLE_CANDIDATES = ['KJV', 'ESV', 'ASV', 'NIV', 'AB', 'ACV', 'BBE', 'BSB'];

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `Bible route tests require the desktop package data directory with main.db and module databases.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);

  // Discover a valid Bible module from the metadata
  const allMods = db.getModuleMetadataRepo().getByType('bible');
  if (allMods.length === 0) throw new Error('No Bible modules found in test data.');
  const abbr = allMods[0].abbreviation || allMods[0].getAbbreviation();
  bibleModule = abbr ?? 'KJV';

  // Find a full-Bible module (OT+NT) for boundary tests.
  // Some modules are NT-only; the first alphabetical module may not cover Genesis.
  const knownFull = FULL_BIBLE_CANDIDATES.find(candidate =>
    allMods.some(m => (m.abbreviation || m.getAbbreviation())?.toUpperCase() === candidate.toUpperCase())
  );
  if (knownFull) {
    fullBibleModule = knownFull;
  } else {
    // Fall back: scan until we find one with OT content
    const found = allMods.find(m => {
      const a = m.abbreviation || m.getAbbreviation();
      if (!a) return false;
      const repo = db.getBibleRepo(a);
      return repo ? repo.getChapter(1, 1).length > 0 : false;
    });
    fullBibleModule = found?.abbreviation ?? bibleModule;
  }

  // John 3:16 should exist in any standard Bible
  validVerseId = 43003016;

  app = express();
  app.use(express.json());
  app.use('/api/bible', createBibleRoutes(db));
});

afterAll(() => {
  db.closeAll();
});

// ---------------------------------------------------------------------------
// GET /api/bible/topics/:book
// ---------------------------------------------------------------------------
describe('GET /api/bible/topics/:book', () => {
  it('returns topics object for a valid book number (book 1)', async () => {
    const res = await request(app).get('/api/bible/topics/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('topics');
  });

  it('returns 400 for book number 0', async () => {
    const res = await request(app).get('/api/bible/topics/0');
    expect(res.status).toBe(400);
  });

  it('returns 400 for book number 67', async () => {
    const res = await request(app).get('/api/bible/topics/67');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric book', async () => {
    const res = await request(app).get('/api/bible/topics/genesis');
    expect(res.status).toBe(400);
  });

  it('accepts boundary books (1 and 66)', async () => {
    const res1 = await request(app).get('/api/bible/topics/1');
    expect(res1.status).toBe(200);
    const res66 = await request(app).get('/api/bible/topics/66');
    expect(res66.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/bible/votd
// ---------------------------------------------------------------------------
describe('GET /api/bible/votd', () => {
  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/bible/votd?module=NONEXISTENT_XYZ');
    expect(res.status).toBe(404);
  });

  // The dataset is compiled into core, so with any Bible installed there is
  // always a verse to give -- whichever translations this install has.
  it('answers in an installed Bible when no module is named', async () => {
    const res = await request(app).get('/api/bible/votd');
    expect(res.status).toBe(200);
    expect(db.getBibleRepo(res.body.module)).not.toBeNull();
  });

  it('answers in the configured default when no module is named', async () => {
    const configured = express();
    configured.use('/api/bible', createBibleRoutes(db, undefined, { defaultModule: bibleModule }));
    const res = await request(configured).get('/api/bible/votd');
    expect(res.status).toBe(200);
    expect(String(res.body.module).toLowerCase()).toBe(bibleModule.toLowerCase());
  });

  it('falls back to an installed Bible when the configured default is not installed', async () => {
    const configured = express();
    configured.use('/api/bible', createBibleRoutes(db, undefined, { defaultModule: 'NOT_INSTALLED_XYZ' }));
    const res = await request(configured).get('/api/bible/votd');
    expect(res.status).toBe(200);
    expect(db.getBibleRepo(res.body.module)).not.toBeNull();
  });

  it('falls back only to a Bible the site settings make visible', async () => {
    const configured = express();
    configured.use('/api/bible', createBibleRoutes(db, undefined, {
      defaultModule: 'NOT_INSTALLED_XYZ',
      siteSettings: { bibles: { modules: { [bibleModule]: { active: true } }, sections: [] } },
    }));
    const res = await request(configured).get('/api/bible/votd');
    expect(res.status).toBe(200);
    expect(String(res.body.module).toLowerCase()).toBe(bibleModule.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// DatabaseManager.getDefaultBibleAbbreviation
// ---------------------------------------------------------------------------
describe('DatabaseManager.getDefaultBibleAbbreviation', () => {
  it('returns the preferred Bible when it is installed', () => {
    expect(db.getDefaultBibleAbbreviation(bibleModule.toLowerCase())).toBe(db.resolveAbbreviation(bibleModule));
  });

  it('returns an installed Bible when the preferred one is not installed', () => {
    const fallback = db.getDefaultBibleAbbreviation('NOT_INSTALLED_XYZ');
    expect(fallback).not.toBeNull();
    expect(db.getBibleRepo(fallback!)).not.toBeNull();
  });

  it('returns null when no installed Bible is acceptable', () => {
    expect(db.getDefaultBibleAbbreviation('NOT_INSTALLED_XYZ', () => false)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/bible/:module/verses
// ---------------------------------------------------------------------------
describe('POST /api/bible/:module/verses', () => {
  it('returns 400 when verseIds is missing from body', async () => {
    const res = await request(app)
      .post(`/api/bible/${bibleModule}/verses`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when verseIds is empty array', async () => {
    const res = await request(app)
      .post(`/api/bible/${bibleModule}/verses`)
      .send({ verseIds: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when verseIds exceeds 500 limit', async () => {
    const verseIds = Array.from({ length: 501 }, (_, i) => 43000000 + i);
    const res = await request(app)
      .post(`/api/bible/${bibleModule}/verses`)
      .send({ verseIds });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid verse ID in array', async () => {
    const res = await request(app)
      .post(`/api/bible/${bibleModule}/verses`)
      .send({ verseIds: ['notanumber'] });
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app)
      .post('/api/bible/NONEXISTENT_XYZ/verses')
      .send({ verseIds: [validVerseId] });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid module name with special chars', async () => {
    const res = await request(app)
      .post('/api/bible/bad name!/verses')
      .send({ verseIds: [validVerseId] });
    expect(res.status).toBe(400);
  });

  it('returns verses object for valid input', async () => {
    const res = await request(app)
      .post(`/api/bible/${bibleModule}/verses`)
      .send({ verseIds: [validVerseId] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('verses');
    if (res.body.verses[String(validVerseId)]) {
      expect(res.body.verses[String(validVerseId)]).toHaveProperty('text');
      expect(res.body.verses[String(validVerseId)]).toHaveProperty('verse_id');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/bible/:module/verse/:verseId
// ---------------------------------------------------------------------------
describe('GET /api/bible/:module/verse/:verseId', () => {
  it('returns a verse for valid module and verseId (John 3:16)', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/verse/${validVerseId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('verse_id');
    expect(res.body).toHaveProperty('text');
    expect(res.body).toHaveProperty('book_number');
    expect(res.body).toHaveProperty('chapter');
    expect(res.body).toHaveProperty('verse');
    expect(res.body.book_number).toBe(43);
    expect(res.body.chapter).toBe(3);
    expect(res.body.verse).toBe(16);
  });

  it('returns 400 for invalid verseId', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/verse/invalid`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid module name', async () => {
    const res = await request(app).get('/api/bible/bad name!/verse/43003016');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/bible/NONEXISTENT_XYZ/verse/43003016');
    expect(res.status).toBe(404);
  });

  it('returns 404 for verse that does not exist', async () => {
    // Verse ID 99999999 is not a valid verse
    const res = await request(app).get(`/api/bible/${bibleModule}/verse/99999001`);
    // Could be 400 (invalid verse id) or 404 (not found) depending on validation
    expect([400, 404]).toContain(res.status);
  });

  it('sets Cache-Control header', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/verse/${validVerseId}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /api/bible/:module/:book/:chapter
// ---------------------------------------------------------------------------
describe('GET /api/bible/:module/:book/:chapter', () => {
  it('returns chapter data for valid module/book/chapter (John 3)', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/43/3`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('verses');
    expect(res.body).toHaveProperty('hasInterlinearData');
    expect(Array.isArray(res.body.verses)).toBe(true);
    expect(res.body.verses.length).toBeGreaterThan(0);
  });

  it('each verse has expected fields', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/43/3`);
    expect(res.status).toBe(200);
    const first = res.body.verses[0];
    expect(first).toHaveProperty('verse_id');
    expect(first).toHaveProperty('text');
    expect(first).toHaveProperty('verse');
  });

  it('returns 400 for book number 0', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/0/1`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for book number 67', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/67/1`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid chapter 0', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/1/0`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-numeric book', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/genesis/1`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid module name', async () => {
    const res = await request(app).get('/api/bible/bad name!/1/1');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(app).get('/api/bible/NONEXISTENT_XYZ/1/1');
    expect(res.status).toBe(404);
  });

  it('sets Cache-Control header', async () => {
    const res = await request(app).get(`/api/bible/${bibleModule}/43/3`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
  });

  it('handles Genesis chapter 1 (book boundary)', async () => {
    const res = await request(app).get(`/api/bible/${fullBibleModule}/1/1`);
    expect(res.status).toBe(200);
    expect(res.body.verses.length).toBeGreaterThan(0);
  });

  it('handles Revelation chapter 22 (book boundary)', async () => {
    const res = await request(app).get(`/api/bible/${fullBibleModule}/66/22`);
    expect(res.status).toBe(200);
    expect(res.body.verses.length).toBeGreaterThan(0);
  });

  it('includes coveredBooks when chapter has no verses', async () => {
    // A very high chapter number that probably doesn't exist in any book
    const res = await request(app).get(`/api/bible/${bibleModule}/1/999`);
    expect(res.status).toBe(200);
    if (res.body.verses.length === 0) {
      expect(res.body).toHaveProperty('coveredBooks');
    }
  });
});
