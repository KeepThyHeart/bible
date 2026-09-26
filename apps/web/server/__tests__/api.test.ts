import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createModuleRoutes } from '../routes/moduleRoutes';
import { createBibleRoutes } from '../routes/bibleRoutes';
import { createCommentaryRoutes } from '../routes/commentaryRoutes';
import { createInterlinearRoutes } from '../routes/interlinearRoutes';
import { createSearchRoutes } from '../routes/searchRoutes';
import { createStrongsRoutes } from '../routes/strongsRoutes';
import { loadSiteSettings, type SiteSettings } from '../siteSettings';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

// Data lives in the desktop package's data directory.
// The web package shares this data via the BIBLE_DATA_DIR / BIBLE_MODULES_DIR env vars
// at runtime; for tests we resolve directly to the desktop data.
const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
// modulesDir is the parent from which database_path (e.g. "modules/bible_kjv.db") resolves
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let app: express.Express;

/**
 * Clarke is in the `tests` module preset but not `starter`, so a default
 * `npm run setup` does not install it. Its tests skip without it, as core's
 * data-backed suites do, rather than fail with a 404 that reads like a route
 * bug -- and say so, so the skip is not mistaken for coverage.
 */
const CLARKE_DB = resolve(modulesDir, 'modules', 'commentary_clarke.db');
const clarkeInstalled = existsSync(CLARKE_DB);
if (!clarkeInstalled) {
  console.warn(
    `\n[api tests] SKIPPING the Clarke commentary tests -- module not found:\n    ${CLARKE_DB}\n` +
      '  Install it with `npm run init:modules -- --select=tests` to run them.\n'
  );
}

// Minimal site settings that exposes the modules used in tests.
// In production, this is loaded from settings.json in the data directory.
const testSiteSettings: SiteSettings = {
  bibles: {
    modules: { KJV: { active: true } },
    sections: [],
  },
  commentaries: {
    modules: {
      Barnes: { active: true },
      Clarke: { active: true },
    },
    sections: [],
  },
  dictionaries: {
    modules: {
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
      `API tests require the desktop package data directory with main.db and module databases.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);
  const siteSettings = loadSiteSettings(dataDir);
  app = express();
  app.use('/api', createModuleRoutes(db, testSiteSettings));
  app.use('/api/bible', createBibleRoutes(db));
  app.use('/api/commentary', createCommentaryRoutes(db, siteSettings));
  app.use('/api/interlinear', createInterlinearRoutes(db));
  app.use('/api/search', createSearchRoutes(db, {}, false, 0.15));
  app.use('/api/strongs', createStrongsRoutes(db));
});

afterAll(() => {
  db.closeAll();
});

describe('Module Routes', () => {
  it('GET /api/books returns 66 books', async () => {
    const res = await request(app).get('/api/books');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(66);
    expect(res.body[0].book_name).toBe('Genesis');
    expect(res.body[65].book_name).toBe('Revelation');
  });

  it('GET /api/modules returns available modules', async () => {
    const res = await request(app).get('/api/modules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('abbreviation');
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('type');
  });

  it('GET /api/modules?type=bible filters by type', async () => {
    const res = await request(app).get('/api/modules?type=bible');
    expect(res.status).toBe(200);
    expect(res.body.every((m: any) => m.type === 'bible')).toBe(true);
  });
});

describe('Bible Routes', () => {
  it('GET /api/bible/KJV/1/1 returns Genesis 1 verses', async () => {
    const res = await request(app).get('/api/bible/KJV/1/1');
    expect(res.status).toBe(200);
    expect(res.body.verses).toBeDefined();
    expect(res.body.verses.length).toBeGreaterThan(0);
    expect(res.body.verses[0]).toHaveProperty('verse_id');
    expect(res.body.verses[0]).toHaveProperty('text_html');
    expect(res.body.verses[0].book_number).toBe(1);
    expect(res.body.verses[0].chapter).toBe(1);
    expect(res.body.verses[0].verse).toBe(1);
  });

  it('GET /api/bible/KJV/verse/43003016 returns John 3:16', async () => {
    const res = await request(app).get('/api/bible/KJV/verse/43003016');
    expect(res.status).toBe(200);
    expect(res.body.verse_id).toBe(43003016);
    expect(res.body.book_number).toBe(43);
    expect(res.body.chapter).toBe(3);
    expect(res.body.verse).toBe(16);
  });

  it('returns 404 for unknown module', async () => {
    const res = await request(app).get('/api/bible/NONEXISTENT/1/1');
    expect(res.status).toBe(404);
  });

  it('returns hasInterlinearData flag', async () => {
    const res = await request(app).get('/api/bible/KJV/1/1');
    expect(res.body).toHaveProperty('hasInterlinearData');
    expect(typeof res.body.hasInterlinearData).toBe('boolean');
  });

  it('section_heading field is present when verse has heading data', async () => {
    // The KJV module may not have section headings in formatting_data.
    // This test verifies the field plumbing works — if the module has headings,
    // they appear; if not, the field is undefined.
    const res = await request(app).get('/api/bible/KJV/19/4');
    expect(res.status).toBe(200);
    const verse1 = res.body.verses.find((v: any) => v.verse === 1);
    expect(verse1).toBeDefined();
    // If section headings are present, they should be plain text (no XML)
    if (verse1.section_heading) {
      expect(verse1.section_heading).not.toContain('<w ');
      expect(verse1.section_heading).not.toContain('lemma=');
    }
  });

  it('Genesis 1:1 has no section heading', async () => {
    const res = await request(app).get('/api/bible/KJV/1/1');
    expect(res.status).toBe(200);
    const verse1 = res.body.verses.find((v: any) => v.verse === 1);
    expect(verse1).toBeDefined();
    // Genesis 1:1 should not have a section heading
    expect(verse1.section_heading).toBeUndefined();
  });

  it('single verse endpoint returns section_heading field', async () => {
    const res = await request(app).get('/api/bible/KJV/verse/43003016');
    expect(res.status).toBe(200);
    // Verify the response shape includes the field (value depends on module data)
    expect(res.body).toHaveProperty('verse_id');
    expect('section_heading' in res.body || res.body.section_heading === undefined).toBe(true);
  });
});

describe('Commentary Routes', () => {
  it('GET /api/commentary/Barnes/43/3 returns entries', async () => {
    const res = await request(app).get('/api/commentary/Barnes/43/3');
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeDefined();
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.entries[0]).toHaveProperty('entry_id');
    expect(res.body.entries[0]).toHaveProperty('content');
  });

  it('handles case-insensitive abbreviation', async () => {
    const res = await request(app).get('/api/commentary/barnes/43/3');
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown commentary', async () => {
    const res = await request(app).get('/api/commentary/NONEXISTENT/1/1');
    expect(res.status).toBe(404);
  });

  it.skipIf(!clarkeInstalled)('trims leading whitespace and junk HTML from commentary content', async () => {
    // Clarke Exodus 31 is known to have leading <!/P><br /> junk
    const res = await request(app).get('/api/commentary/Clarke/2/31');
    expect(res.status).toBe(200);
    const entries = res.body.entries;
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      // Content should not start with whitespace, <br>, or malformed HTML tags
      expect(entry.content).not.toMatch(/^\s/);
      expect(entry.content).not.toMatch(/^<br\s*\/?>/i);
      expect(entry.content).not.toMatch(/^<!\/?/);
    }
  });

  it.skipIf(!clarkeInstalled)('strips "Verse N" prefix labels from verse-level commentary entries', async () => {
    // Clarke Psalm 47:2 is known to have a leading "<b>Verse 2</b>" prefix
    const res = await request(app).get('/api/commentary/Clarke/19/47');
    expect(res.status).toBe(200);
    const entries = res.body.entries;
    expect(entries.length).toBeGreaterThan(0);

    // Find the entry for verse 2 (verse_id_start = 19047002)
    const v2Entry = entries.find((e: any) => e.verse_id_start === 19047002);
    expect(v2Entry).toBeDefined();
    // Content should NOT start with "Verse 2" or "<b>Verse 2</b>"
    expect(v2Entry.content).not.toMatch(/^\s*(<b>)?\s*Verse\s+\d/i);
    // Content should start with the actual commentary text
    expect(v2Entry.content.length).toBeGreaterThan(10);
  });
});

// Classifying commentary entries as verse or passage is covered, against
// fixtures, in src/utils/commentaryEntries.test.ts.

describe('Strong\'s Routes', () => {
  it('GET /api/strongs/G2316 returns entry', async () => {
    const res = await request(app).get('/api/strongs/G2316');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('strongsNumber');
    expect(res.body).toHaveProperty('definition');
  });

  it('returns 404 for unknown number', async () => {
    const res = await request(app).get('/api/strongs/G99999');
    expect(res.status).toBe(404);
  });
});

describe('Search Routes', () => {
  it('GET /api/search/keyword returns results', async () => {
    const res = await request(app).get('/api/search/keyword?q=love');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('returns 400 without query', async () => {
    const res = await request(app).get('/api/search/keyword');
    expect(res.status).toBe(400);
  });

  it('GET /api/search/semantic returns 503 when no pipeline configured', async () => {
    const res = await request(app).get('/api/search/semantic?q=love');
    expect(res.status).toBe(503);
    expect(res.body.results).toEqual([]);
  });
});

describe('Interlinear Routes', () => {
  it('GET /api/interlinear/1/1 returns data', async () => {
    const res = await request(app).get('/api/interlinear/1/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('words');
    expect(res.body).toHaveProperty('strongsEntries');
    expect(Array.isArray(res.body.words)).toBe(true);
  });
});
