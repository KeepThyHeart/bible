import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../DatabaseManager';
import { createCrossRefRoutes } from '../routes/crossRefRoutes';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;
let db: DatabaseManager;
let app: express.Express;

const tskDbExists = existsSync(resolve(desktopData, 'modules/xref_tsk.db'));

beforeAll(() => {
  if (!existsSync(resolve(dataDir, 'main.db'))) {
    throw new Error(
      `Test data not found at ${dataDir}.\n` +
      `API tests require the desktop package data directory with main.db and module databases.\n` +
      `Set BIBLE_DATA_DIR to one -- see server/__tests__/testDataDir.ts.`
    );
  }
  db = new DatabaseManager(dataDir, modulesDir);
  app = express();
  app.use('/api/xref', createCrossRefRoutes(db));
});

afterAll(() => {
  db.closeAll();
});

describe('Cross-Reference Routes - Validation', () => {
  it('GET /api/xref groups with invalid module name returns 400', async () => {
    const res = await request(app).get('/api/xref/bad%20name/1001001/groups');
    expect(res.status).toBe(400);
  });

  it('GET /api/xref groups with invalid verse ID returns 400', async () => {
    const res = await request(app).get('/api/xref/TSKxref/abc/groups');
    expect(res.status).toBe(400);
  });

  it('GET /api/xref count with invalid module name returns 400', async () => {
    const res = await request(app).get('/api/xref/bad%20name/1001001/count');
    expect(res.status).toBe(400);
  });

  it('GET /api/xref count with verse ID out of range returns 400', async () => {
    const res = await request(app).get('/api/xref/TSKxref/999/count');
    expect(res.status).toBe(400);
  });
});

describe('Cross-Reference Routes - Nonexistent Module', () => {
  it('GET groups for nonexistent module returns empty array', async () => {
    const res = await request(app).get('/api/xref/NONEXISTENT/1001001/groups');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET count for nonexistent module returns 0', async () => {
    const res = await request(app).get('/api/xref/NONEXISTENT/1001001/count');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0 });
  });
});

describe.skipIf(!tskDbExists)('Cross-Reference Routes - TSK Module', () => {
  it('GET /api/xref/TSKxref/1001001/groups returns groups for Genesis 1:1', async () => {
    const res = await request(app).get('/api/xref/TSKxref/1001001/groups');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('groups response has correct shape with group and entries', async () => {
    const res = await request(app).get('/api/xref/TSKxref/1001001/groups');
    expect(res.status).toBe(200);
    const first = res.body[0];
    expect(first).toHaveProperty('group');
    expect(first).toHaveProperty('entries');

    // Group shape - group_id and verse_id are always present;
    // phrase and sort_order may be undefined (omitted from JSON) when null in DB
    expect(first.group).toHaveProperty('group_id');
    expect(first.group).toHaveProperty('verse_id');
    expect(first.group.verse_id).toBe(1001001);

    // Entries shape
    expect(Array.isArray(first.entries)).toBe(true);
    expect(first.entries.length).toBeGreaterThan(0);
    const entry = first.entries[0];
    expect(entry).toHaveProperty('entry_id');
    expect(entry).toHaveProperty('group_id');
    expect(entry).toHaveProperty('target_verse_id');
    expect(entry).toHaveProperty('sort_order');
  });

  it('GET /api/xref/TSKxref/43003016/groups returns groups for John 3:16', async () => {
    const res = await request(app).get('/api/xref/TSKxref/43003016/groups');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('groups returns valid array for verse that may lack cross-refs', async () => {
    // Revelation 22:21 - last verse in Bible, may or may not have cross-refs
    const res = await request(app).get('/api/xref/TSKxref/66022021/groups');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/xref/TSKxref/1001001/count returns positive count for Genesis 1:1', async () => {
    const res = await request(app).get('/api/xref/TSKxref/1001001/count');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('count');
    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('GET /api/xref/TSKxref/43003016/count returns positive count for John 3:16', async () => {
    const res = await request(app).get('/api/xref/TSKxref/43003016/count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
  });
});
