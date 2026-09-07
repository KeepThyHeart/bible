import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createTagGraphRoutes } from '../routes/tagGraphRoutes';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;

const tagGraphDbPath = resolve(desktopData, 'tag_graph.db');
const hasTagGraphDb = existsSync(tagGraphDbPath);

let db: DatabaseManager;
let app: express.Express;
let disabledApp: express.Express;

// Store a known entity discovered at runtime for subsequent tests.
// searchEntities returns { id, name, category, notes }.
let knownEntity: { id: string; category: string; name: string } | undefined;

beforeAll(() => {
  if (!hasTagGraphDb) return;

  db = new DatabaseManager(dataDir, modulesDir);

  // Disabled app: middleware should short-circuit all endpoints to return []
  disabledApp = express();
  disabledApp.use('/api/taggraph', createTagGraphRoutes(db, { enabled: false }));

  // Enabled app: full functionality
  app = express();
  app.use('/api/taggraph', createTagGraphRoutes(db, { enabled: true }));
});

afterAll(() => {
  if (db) db.closeAll();
});

// ---------------------------------------------------------------------------
// Disabled middleware tests — always run (even without the DB the disabled app
// would return [] since it never touches the database)
// ---------------------------------------------------------------------------
describe('Tag Graph Routes (disabled)', () => {
  let localDisabledApp: express.Express;

  beforeAll(() => {
    if (hasTagGraphDb && db) {
      localDisabledApp = disabledApp;
    } else {
      // Even without a tag_graph.db we can test disabled behavior since the
      // middleware short-circuits before any DB access. But DatabaseManager
      // requires main.db, so skip if that is also absent.
      if (!existsSync(resolve(dataDir, 'main.db'))) return;
      const tempDb = new DatabaseManager(dataDir, modulesDir);
      localDisabledApp = express();
      localDisabledApp.use('/api/taggraph', createTagGraphRoutes(tempDb, { enabled: false }));
    }
  });

  it('GET /verse/:verseId returns [] when disabled', async () => {
    if (!localDisabledApp) return;
    const res = await request(localDisabledApp).get('/api/taggraph/verse/1001001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /entity/:category/:entityId returns [] when disabled', async () => {
    if (!localDisabledApp) return;
    const res = await request(localDisabledApp).get('/api/taggraph/entity/people/adam');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /search returns [] when disabled', async () => {
    if (!localDisabledApp) return;
    const res = await request(localDisabledApp).get('/api/taggraph/search?q=Moses');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /entity/:category/:entityId/associations returns [] when disabled', async () => {
    if (!localDisabledApp) return;
    const res = await request(localDisabledApp).get('/api/taggraph/entity/people/adam/associations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /topic-link/:sourceModule/:topicId returns [] when disabled', async () => {
    if (!localDisabledApp) return;
    const res = await request(localDisabledApp).get('/api/taggraph/topic-link/Naves/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Enabled tests — require tag_graph.db
// ---------------------------------------------------------------------------
describe.skipIf(!hasTagGraphDb)('Tag Graph Routes (enabled)', () => {
  // Discover a known entity via search so subsequent tests have valid IDs.
  beforeAll(async () => {
    const res = await request(app).get('/api/taggraph/search?q=Moses');
    if (res.status === 200 && Array.isArray(res.body) && res.body.length > 0) {
      knownEntity = res.body[0];
    }
  });

  // -- Verse lookup ----------------------------------------------------------

  it('GET /verse/:verseId returns array for a well-known verse', async () => {
    // Genesis 1:1 — may or may not have entity_verses rows depending on DB state
    const res = await request(app).get('/api/taggraph/verse/1001001');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // If entities exist, verify the shape
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('entity_id');
      expect(res.body[0]).toHaveProperty('category');
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).toHaveProperty('source');
    }
  });

  it('GET /verse/:verseId returns 400 for invalid verse ID', async () => {
    const res = await request(app).get('/api/taggraph/verse/not-a-number');
    expect(res.status).toBe(400);
  });

  it('GET /verse/:verseId returns 400 for negative verse ID', async () => {
    const res = await request(app).get('/api/taggraph/verse/-1');
    expect(res.status).toBe(400);
  });

  it('GET /verse/:verseId returns array for a verse with no entities', async () => {
    // Revelation 22:21 — unlikely to have entities in a sparse DB
    const res = await request(app).get('/api/taggraph/verse/66022021');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // -- Entity detail ---------------------------------------------------------

  it('GET /entity/:category/:entityId returns full entity details', async () => {
    if (!knownEntity) return;
    const res = await request(app).get(
      `/api/taggraph/entity/${knownEntity.category}/${knownEntity.id}`
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', knownEntity.id);
    expect(res.body).toHaveProperty('name');
  });

  it('GET /entity/people/adam returns Adam', async () => {
    const res = await request(app).get('/api/taggraph/entity/people/adam');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'adam');
    expect(res.body).toHaveProperty('name', 'Adam');
  });

  it('GET /entity/:category/:entityId returns 404 for nonexistent entity', async () => {
    const res = await request(app).get('/api/taggraph/entity/people/nonexistent_id_12345');
    expect(res.status).toBe(404);
  });

  // -- Entity associations ---------------------------------------------------

  it('GET /entity/:category/:entityId/associations returns array', async () => {
    if (!knownEntity) return;
    const res = await request(app).get(
      `/api/taggraph/entity/${knownEntity.category}/${knownEntity.id}/associations`
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // -- Entity verses ---------------------------------------------------------

  it('GET /entity/:category/:entityId/verses returns array', async () => {
    if (!knownEntity) return;
    const res = await request(app).get(
      `/api/taggraph/entity/${knownEntity.category}/${knownEntity.id}/verses`
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // entity_verses may be empty if the table is not yet populated
  });

  // -- Entity facets ---------------------------------------------------------

  it('GET /entity/:category/:entityId/facets returns array or 500 if table missing', async () => {
    if (!knownEntity) return;
    const res = await request(app).get(
      `/api/taggraph/entity/${knownEntity.category}/${knownEntity.id}/facets`
    );
    // The entity_facets table may not exist yet; accept either success or 500
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  // -- Entity topic links ----------------------------------------------------

  it('GET /entity/:category/:entityId/topic-links returns array', async () => {
    if (!knownEntity) return;
    const res = await request(app).get(
      `/api/taggraph/entity/${knownEntity.category}/${knownEntity.id}/topic-links`
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // If there are topic links, they should be enriched with topic_name
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('topic_id');
      expect(res.body[0]).toHaveProperty('source_module');
      expect(res.body[0]).toHaveProperty('match_type');
      expect('topic_name' in res.body[0]).toBe(true);
    }
  });

  // -- Search ----------------------------------------------------------------

  it('GET /search?q=Moses returns matching entities', async () => {
    const res = await request(app).get('/api/taggraph/search?q=Moses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // At least one result should contain "Moses" in the name
    const hasMoses = res.body.some((e: any) =>
      e.name?.toLowerCase().includes('moses')
    );
    expect(hasMoses).toBe(true);
  });

  it('GET /search?q=Jerusalem returns place entities', async () => {
    const res = await request(app).get('/api/taggraph/search?q=Jerusalem');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('GET /search with empty query returns []', async () => {
    const res = await request(app).get('/api/taggraph/search?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /search with no q param returns []', async () => {
    const res = await request(app).get('/api/taggraph/search');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /search with category filter narrows results', async () => {
    const res = await request(app).get('/api/taggraph/search?q=Moses&categories=people');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All results should be in the 'people' category
    for (const entity of res.body) {
      expect(entity.category).toBe('people');
    }
  });

  it('GET /search accepts a multi-category allowlisted filter', async () => {
    const res = await request(app).get('/api/taggraph/search?q=Moses&categories=people,places');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const entity of res.body) {
      expect(['people', 'places']).toContain(entity.category);
    }
  });

  // -- Reverse topic-link lookup ---------------------------------------------

  it('GET /topic-link/:sourceModule/:topicId returns entity or null', async () => {
    // topic_index_mapping exists but entity_topic_links may not; handle both
    const res = await request(app).get('/api/taggraph/topic-link/Naves/1');
    // Accept 200 (entity or null) or 500 (if table missing)
    expect([200, 500]).toContain(res.status);
    if (res.status === 200 && res.body !== null) {
      expect(res.body).toHaveProperty('entity_id');
      expect(res.body).toHaveProperty('entity_category');
    }
  });
});

// ---------------------------------------------------------------------------
// SQL injection regression (WS-B / B1)
//
// The `categories` query param becomes a SQLite table name inside
// TagGraphRepository.searchEntities. Any value outside the fixed allowlist
// (people/places/objects/themes) MUST be rejected with a 400 validation error
// BEFORE it reaches the repo — never interpolated into SQL. Validation runs
// ahead of the repo-null check, so these assertions hold even when a real
// tag_graph.db is not present (they only require main.db for DatabaseManager).
// ---------------------------------------------------------------------------
describe('Tag Graph Routes — categories allowlist (SQLi regression)', () => {
  let injApp: express.Express | undefined;
  let injDb: DatabaseManager | undefined;

  beforeAll(() => {
    if (!existsSync(resolve(dataDir, 'main.db'))) return;
    injDb = new DatabaseManager(dataDir, modulesDir);
    injApp = express();
    injApp.use('/api/taggraph', createTagGraphRoutes(injDb, { enabled: true }));
  });

  afterAll(() => {
    if (injDb) injDb.closeAll();
  });

  it('rejects a UNION SELECT injection payload with a 400 validation error', async () => {
    if (!injApp) return;
    const payload = encodeURIComponent('people UNION SELECT name FROM sqlite_master --');
    const res = await request(injApp).get(`/api/taggraph/search?q=Moses&categories=${payload}`);
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('INVALID_PARAM');
    // Must be an error envelope, never leaked query results.
    expect(Array.isArray(res.body)).toBe(false);
  });

  it('rejects a bare table-name injection (e.g. sqlite_master) with 400', async () => {
    if (!injApp) return;
    const res = await request(injApp).get('/api/taggraph/search?q=Moses&categories=sqlite_master');
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('INVALID_PARAM');
  });

  it('rejects a mix of one valid and one unknown category with 400', async () => {
    if (!injApp) return;
    const res = await request(injApp).get('/api/taggraph/search?q=Moses&categories=people,robots');
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('INVALID_PARAM');
  });

  it('accepts a legitimate allowlisted category (200, not a validation error)', async () => {
    if (!injApp) return;
    const res = await request(injApp).get('/api/taggraph/search?q=Moses&categories=people');
    // With no tag_graph.db the repo is null and the route returns []; with one
    // present it returns matching entities. Either way it must NOT be a 400.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
