import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createModuleRoutes } from '../routes/moduleRoutes';
import type { SiteSettings } from '../siteSettings';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let appNoSettings: express.Express;
let appWithSettings: express.Express;

// Discover a valid Bible module abbreviation at setup time
let bibleModuleAbbr: string;

// Every section is present, so `satisfies` keeps them non-optional for the
// setup below — `SiteSettings` marks them optional because a real settings file
// may omit any of them.
const testSiteSettings = {
  bibles: {
    modules: {} as Record<string, { active: boolean }>,
    sections: [],
  },
  commentaries: { modules: {}, sections: [] },
  dictionaries: { modules: {}, sections: [] },
} satisfies SiteSettings;

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `Module route tests require the desktop package data directory with main.db.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);

  // Discover a Bible module abbreviation for download tests
  const mods = db.getModuleMetadataRepo().getByType('bible');
  if (mods.length > 0) {
    bibleModuleAbbr = (mods[0].abbreviation || mods[0].getAbbreviation()) ?? 'KJV';
    // Populate testSiteSettings so the module shows as active
    testSiteSettings.bibles.modules[bibleModuleAbbr] = { active: true };
  } else {
    bibleModuleAbbr = 'KJV';
  }

  // App with null settings (no filtering — all modules pass through except managed types)
  appNoSettings = express();
  appNoSettings.use('/api', createModuleRoutes(db, null));

  // App with settings that has at least one active Bible module
  appWithSettings = express();
  appWithSettings.use('/api', createModuleRoutes(db, testSiteSettings));
});

afterAll(() => {
  db.closeAll();
});

// ---------------------------------------------------------------------------
// GET /api/modules
// ---------------------------------------------------------------------------
describe('GET /api/modules', () => {
  it('returns empty array when siteSettings is null', async () => {
    const res = await request(appNoSettings).get('/api/modules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // null settings → no modules visible (fail-safe)
    expect(res.body.length).toBe(0);
  });

  it('returns active modules when siteSettings provided', async () => {
    const res = await request(appWithSettings).get('/api/modules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should have at least one active bible module
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('each module has expected fields', async () => {
    const res = await request(appWithSettings).get('/api/modules');
    expect(res.status).toBe(200);
    for (const mod of res.body) {
      expect(mod).toHaveProperty('module_id');
      expect(mod).toHaveProperty('abbreviation');
      expect(mod).toHaveProperty('name');
      expect(mod).toHaveProperty('type');
    }
  });

  it('filters by type=bible', async () => {
    const res = await request(appWithSettings).get('/api/modules?type=bible');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const mod of res.body) {
      expect(mod.type).toBe('bible');
    }
  });

  it('filters by type=commentary', async () => {
    const res = await request(appWithSettings).get('/api/modules?type=commentary');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/module-sections
// ---------------------------------------------------------------------------
describe('GET /api/module-sections', () => {
  it('returns configured: false when siteSettings is null', async () => {
    const res = await request(appNoSettings).get('/api/module-sections');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('configured', false);
  });

  it('returns configured: true when siteSettings is provided', async () => {
    const res = await request(appWithSettings).get('/api/module-sections');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('configured', true);
    expect(res.body).toHaveProperty('bibles');
    expect(res.body).toHaveProperty('commentaries');
    expect(res.body).toHaveProperty('dictionaries');
  });

  it('bibles section has expected structure', async () => {
    const res = await request(appWithSettings).get('/api/module-sections');
    expect(res.status).toBe(200);
    expect(res.body.bibles).toHaveProperty('sections');
    expect(Array.isArray(res.body.bibles.sections)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/books
// ---------------------------------------------------------------------------
describe('GET /api/books', () => {
  it('returns 66 Bible books', async () => {
    const res = await request(appNoSettings).get('/api/books');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(66);
  });

  it('each book has expected fields', async () => {
    const res = await request(appNoSettings).get('/api/books');
    expect(res.status).toBe(200);
    const first = res.body[0];
    expect(first).toHaveProperty('book_number');
    expect(first).toHaveProperty('book_name');
    expect(first).toHaveProperty('book_abbreviation');
    expect(first).toHaveProperty('testament');
    expect(first).toHaveProperty('chapter_count');
  });

  it('first book is Genesis (book_number 1)', async () => {
    const res = await request(appNoSettings).get('/api/books');
    expect(res.status).toBe(200);
    const genesis = res.body[0];
    expect(genesis.book_number).toBe(1);
    expect(genesis.book_name).toBe('Genesis');
  });

  it('last book is Revelation (book_number 66)', async () => {
    const res = await request(appNoSettings).get('/api/books');
    expect(res.status).toBe(200);
    const revelation = res.body[65];
    expect(revelation.book_number).toBe(66);
    expect(revelation.book_name).toBe('Revelation');
  });

  it('Old Testament books have testament = OT', async () => {
    const res = await request(appNoSettings).get('/api/books');
    expect(res.status).toBe(200);

    // The predicate's type has to carry `book_number`. Typed
    // `(b: { testament: string })`, reading `b.book_number` gives `undefined`,
    // `undefined <= 39` is false, `otBooks` comes out empty and the loop below
    // never runs — the test would assert nothing about testaments at all.
    const books = res.body as Array<{ book_number: number; testament: string }>;
    const otBooks = books.filter(b => b.book_number <= 39);
    expect(otBooks).toHaveLength(39);
    for (const book of otBooks) {
      expect(book.testament).toBe('OT');
    }
  });

  it('New Testament books have testament = NT', async () => {
    const res = await request(appNoSettings).get('/api/books');
    expect(res.status).toBe(200);
    const ntBooks = res.body.filter((b: { testament: string; book_number: number }) => b.book_number >= 40);
    for (const book of ntBooks) {
      expect(book.testament).toBe('NT');
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/modules/:name/download
// ---------------------------------------------------------------------------
describe('GET /api/modules/:name/download', () => {
  it('returns 400 for invalid module name with special characters', async () => {
    const res = await request(appNoSettings).get('/api/modules/bad name!/download');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(appNoSettings).get('/api/modules/NONEXISTENT_XYZ/download');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/modules/:name/download-lite
// ---------------------------------------------------------------------------
describe('GET /api/modules/:name/download-lite', () => {
  it('returns 400 for invalid module name', async () => {
    const res = await request(appNoSettings).get('/api/modules/bad name!/download-lite');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent module', async () => {
    const res = await request(appNoSettings).get('/api/modules/NONEXISTENT_XYZ/download-lite');
    expect(res.status).toBe(404);
  });
});
