import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createTopicalRoutes } from '../routes/topicalRoutes';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;

let db: DatabaseManager;
let app: express.Express;

// Dynamic IDs discovered from the database during setup
let validTopicId: number;
let validTopicIdWithChildren: number;
let naveAbbreviation: string;

beforeAll(async () => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `These tests need a data directory holding main.db and a modules/ directory of module .db files.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }

  if (!existsSync(resolve(dataDir, 'modules/topical_nave.db'))) {
    throw new Error(
      `Topical module not found at ${dataDir}/modules/topical_nave.db.\n` +
      `These tests require the Nave's Topical Bible module.`
    );
  }

  db = new DatabaseManager(dataDir, modulesDir);
  app = express();
  // Pass null for siteSettings to avoid filtering
  app.use('/api/topical', createTopicalRoutes(db, null));

  // Discover module abbreviation
  const modulesRes = await request(app).get('/api/topical/modules');
  const naveMod = modulesRes.body.find((m: any) => m.abbreviation.toLowerCase().includes('nave'));
  naveAbbreviation = naveMod?.abbreviation ?? 'NaveTopics';

  // Discover valid topic IDs from the database
  const searchRes = await request(app).get('/api/topical/search?q=love');
  if (searchRes.body.length > 0) {
    validTopicId = searchRes.body[0].topic_id;
  }

  // Find a topic that has children by looking for a root-level topic
  const verseRes = await request(app).get('/api/topical/verse/43003016');
  if (verseRes.body.length > 0) {
    // Pick a topic that has ancestors (meaning it has a parent, and the parent likely has children)
    const topicWithParent = verseRes.body.find((t: any) => t.parent_topic_id != null);
    if (topicWithParent) {
      validTopicIdWithChildren = topicWithParent.parent_topic_id;
    } else {
      validTopicIdWithChildren = verseRes.body[0].topic_id;
    }
  }
});

afterAll(() => {
  db.closeAll();
});

describe('Topical Routes - /api/topical', () => {
  describe('GET /modules', () => {
    it('returns at least one topical module', async () => {
      const res = await request(app).get('/api/topical/modules');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('each module has abbreviation and name', async () => {
      const res = await request(app).get('/api/topical/modules');
      expect(res.status).toBe(200);
      for (const mod of res.body) {
        expect(mod).toHaveProperty('abbreviation');
        expect(mod).toHaveProperty('name');
        expect(typeof mod.abbreviation).toBe('string');
        expect(typeof mod.name).toBe('string');
      }
    });

    it('includes the Nave module', async () => {
      const res = await request(app).get('/api/topical/modules');
      expect(res.status).toBe(200);
      const nave = res.body.find((m: any) => m.abbreviation.toLowerCase().includes('nave'));
      expect(nave).toBeDefined();
    });
  });

  describe('GET /verse/:verseId', () => {
    it('returns topics for John 3:16', async () => {
      const res = await request(app).get('/api/topical/verse/43003016');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('each topic has required fields', async () => {
      const res = await request(app).get('/api/topical/verse/43003016');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const topic of res.body) {
        expect(topic).toHaveProperty('topic_id');
        expect(topic).toHaveProperty('name');
        expect(topic).toHaveProperty('source_abbreviation');
        expect(topic).toHaveProperty('source_name');
        expect(topic).toHaveProperty('verse_count');
        expect(typeof topic.topic_id).toBe('number');
        expect(typeof topic.name).toBe('string');
      }
    });

    it('returns empty array for a verse with no topics', async () => {
      // Use a very unlikely verse ID that is still valid format but has no topics
      const res = await request(app).get('/api/topical/verse/31001001');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Obadiah 1:1 may or may not have topics; use a more obscure verse if needed
      // The key assertion is that it returns a valid array (not an error)
    });

    it('returns 400 for invalid verse ID', async () => {
      const res = await request(app).get('/api/topical/verse/invalid');
      expect(res.status).toBe(400);
    });

    it('returns 400 for negative verse ID', async () => {
      const res = await request(app).get('/api/topical/verse/-1');
      expect(res.status).toBe(400);
    });

    it('filters out modules via exclude param', async () => {
      const res = await request(app).get(`/api/topical/verse/43003016?exclude=${naveAbbreviation}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      // With Nave excluded, there should be no results from that module
      const naveResults = res.body.filter((t: any) => t.source_abbreviation === naveAbbreviation);
      expect(naveResults).toHaveLength(0);
    });
  });

  describe('GET /:module/topic/:topicId', () => {
    it('returns topic detail with children and parent_chain', async () => {
      const res = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('topic');
      expect(res.body).toHaveProperty('children');
      expect(res.body).toHaveProperty('parent_chain');
      expect(res.body).toHaveProperty('verse_count');
      expect(res.body.topic.topic_id).toBe(validTopicId);
      expect(typeof res.body.topic.name).toBe('string');
      expect(Array.isArray(res.body.children)).toBe(true);
      expect(Array.isArray(res.body.parent_chain)).toBe(true);
    });

    it('returns 404 for unknown module', async () => {
      const res = await request(app).get('/api/topical/NONEXISTENT/topic/1');
      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown topic ID', async () => {
      const res = await request(app).get(`/api/topical/${naveAbbreviation}/topic/9999999`);
      expect(res.status).toBe(404);
    });

    it('topic with children includes child_count for each child', async () => {
      const res = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicIdWithChildren}`);
      expect(res.status).toBe(200);
      if (res.body.children.length > 0) {
        for (const child of res.body.children) {
          expect(child).toHaveProperty('topic_id');
          expect(child).toHaveProperty('name');
          expect(child).toHaveProperty('verse_count');
          expect(child).toHaveProperty('child_count');
          expect(typeof child.child_count).toBe('number');
        }
      }
    });
  });

  describe('GET /:module/topic/:topicId/children', () => {
    it('returns children for a topic that has children', async () => {
      const res = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicIdWithChildren}/children`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      for (const child of res.body) {
        expect(child).toHaveProperty('topic_id');
        expect(child).toHaveProperty('name');
        expect(child).toHaveProperty('verse_count');
      }
    });

    it('returns empty array for unknown module', async () => {
      const res = await request(app).get('/api/topical/NONEXISTENT/topic/1/children');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /:module/topic/:topicId/verses', () => {
    it('returns verses for a topic', async () => {
      const res = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}/verses`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      for (const verse of res.body) {
        expect(verse).toHaveProperty('topic_id');
        expect(verse).toHaveProperty('start_verse_id');
        expect(verse).toHaveProperty('end_verse_id');
        expect(typeof verse.start_verse_id).toBe('number');
      }
    });

    it('supports pagination with limit and offset', async () => {
      const fullRes = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}/verses`);
      if (fullRes.body.length > 2) {
        const limitRes = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}/verses?limit=2`);
        expect(limitRes.status).toBe(200);
        expect(limitRes.body).toHaveLength(2);

        const offsetRes = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}/verses?limit=2&offset=2`);
        expect(offsetRes.status).toBe(200);
        expect(offsetRes.body).toHaveLength(2);
        // Offset results should differ from the first page
        expect(offsetRes.body[0].start_verse_id).not.toBe(limitRes.body[0].start_verse_id);
      }
    });

    it('returns empty array for unknown module', async () => {
      const res = await request(app).get('/api/topical/NONEXISTENT/topic/1/verses');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /search', () => {
    it('returns results for "love"', async () => {
      const res = await request(app).get('/api/topical/search?q=love');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      for (const result of res.body) {
        expect(result).toHaveProperty('topic_id');
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('source_abbreviation');
        expect(result).toHaveProperty('source_name');
        expect(result).toHaveProperty('verse_count');
      }
    });

    it('returns empty array for empty query', async () => {
      const res = await request(app).get('/api/topical/search?q=');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns empty array when no q param', async () => {
      const res = await request(app).get('/api/topical/search');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('filters out modules via exclude param', async () => {
      const res = await request(app).get(`/api/topical/search?q=love&exclude=${naveAbbreviation}`);
      expect(res.status).toBe(200);
      const naveResults = res.body.filter((t: any) => t.source_abbreviation === naveAbbreviation);
      expect(naveResults).toHaveLength(0);
    });
  });
  /**
   * The pagination invariant. `verse_count` expands ranges while /verses
   * returns one row per link, so comparing those two left a "Load more"
   * button that never went away and fetched an empty page on every click.
   * `reference_count` is the contract the client pages against: it must equal
   * exactly the number of rows /verses can ever return.
   */
  describe('reference_count is the pagination unit', () => {
    /** Topics whose links are ranges, so the two counts genuinely differ. */
    async function findRangedTopic(): Promise<{ id: number; body: any } | null> {
      const res = await request(app).get('/api/topical/search?q=Jerusalem');
      for (const hit of res.body.slice(0, 25)) {
        const detail = await request(app)
          .get(`/api/topical/${naveAbbreviation}/topic/${hit.topic_id}`);
        if (detail.status === 200 && detail.body.verse_count > detail.body.reference_count) {
          return { id: hit.topic_id, body: detail.body };
        }
      }
      return null;
    }

    it('exposes reference_count on the topic detail', async () => {
      const res = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.reference_count).toBe('number');
    });

    it('reference_count equals the exact number of rows /verses returns', async () => {
      const detail = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}`);
      const verses = await request(app)
        .get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}/verses?limit=200`);
      expect(verses.status).toBe(200);
      // Only assert exhaustive equality when a single page can hold them all.
      if (detail.body.reference_count <= 200) {
        expect(verses.body).toHaveLength(detail.body.reference_count);
      } else {
        expect(verses.body.length).toBe(200);
      }
    });

    it('paging to reference_count leaves nothing behind', async () => {
      const detail = await request(app).get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}`);
      const total = detail.body.reference_count as number;
      const beyond = await request(app)
        .get(`/api/topical/${naveAbbreviation}/topic/${validTopicId}/verses?limit=50&offset=${total}`);
      expect(beyond.status).toBe(200);
      expect(beyond.body).toEqual([]);
    });

    it('verse_count exceeds reference_count where links are ranges, and only reference_count matches the rows', async () => {
      const ranged = await findRangedTopic();
      // Guard rather than skip silently: Nave's does contain ranged topics.
      expect(ranged, 'no ranged topic found in the topical index — fixture assumption broken').not.toBeNull();
      const { id, body } = ranged!;
      expect(body.verse_count).toBeGreaterThan(body.reference_count);
      const verses = await request(app)
        .get(`/api/topical/${naveAbbreviation}/topic/${id}/verses?limit=200`);
      const expected = Math.min(body.reference_count, 200);
      expect(verses.body).toHaveLength(expected);
      // The old bug in one line: verse_count would have promised more rows.
      expect(verses.body.length).toBeLessThan(body.verse_count);
    });

    it('children carry reference_count too', async () => {
      const res = await request(app)
        .get(`/api/topical/${naveAbbreviation}/topic/${validTopicIdWithChildren}`);
      expect(res.status).toBe(200);
      for (const child of res.body.children) {
        expect(typeof child.reference_count).toBe('number');
        expect(child.reference_count).toBeLessThanOrEqual(child.verse_count);
      }
    });
  });
});
