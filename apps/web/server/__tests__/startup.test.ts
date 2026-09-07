// `beforeAll` was used but never imported. The suite is `describe.skipIf(!hasData)`,
// so on a machine without the dev data it never ran and the ReferenceError
// never surfaced.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import express from 'express';
import request from 'supertest';
import { DatabaseManager } from '../DatabaseManager';
import { createBibleRoutes } from '../routes/bibleRoutes';
import { createModuleRoutes } from '../routes/moduleRoutes';
import { loadSiteSettings } from '../siteSettings';
import { TEST_DATA_DIR } from './testDataDir';

// Verifies that the server can bootstrap: imports resolve, databases open,
// routes mount, and basic endpoints respond.  Catches the class of startup
// crash (missing files, bad imports, ESM/CJS issues) that took down production.

const desktopData = TEST_DATA_DIR;

const hasData = existsSync(resolve(desktopData, 'main.db'));

describe.skipIf(!hasData)('Server startup smoke test', () => {
  let db: DatabaseManager;
  let app: express.Express;

  // Build a minimal Express app with the routes that run at module load time
  // (the same ones that crashed in production).
  beforeAll(() => {
    db = new DatabaseManager(desktopData, desktopData);
    const siteSettings = loadSiteSettings(desktopData);
    app = express();
    app.use('/api', createModuleRoutes(db, siteSettings));
    app.use('/api/bible', createBibleRoutes(db));
  });

  afterAll(() => {
    db?.closeAll();
  });

  it('module routes respond', async () => {
    const res = await request(app).get('/api/modules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('bible routes respond (VOTD loads without crash)', async () => {
    const res = await request(app).get('/api/bible/votd');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('module');
  });
});
