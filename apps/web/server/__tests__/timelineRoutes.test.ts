import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { loadSchemaSql } from '@bible/core';
import { DatabaseManager } from '../DatabaseManager';
import { SqliteProvider } from '../providers/SqliteProvider';
import { createTimelineRoutes } from '../routes/timelineRoutes';

const SCHEMAS = resolve(__dirname, '../../../../packages/core/sql/schemas/initial');

/** A data dir holding a real (empty) main.db, and optionally one installed timeline module. */
function buildDataDir(withTimeline: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'timeline-routes-'));
  mkdirSync(join(dir, 'modules'));

  const main = new SqliteProvider(join(dir, 'main.db'));
  main.exec(loadSchemaSql(join(SCHEMAS, 'MainDatabase.sql')));

  if (withTimeline) {
    const tl = new SqliteProvider(join(dir, 'modules', 'timeline.db'));
    tl.exec(loadSchemaSql(join(SCHEMAS, 'Timeline.sql')));
    tl.exec(`
      INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, license_spdx)
        VALUES (1, '00000000-0000-4000-8000-000000000001', 'timeline', 'TL', 'Test Timeline', 'timeline-module', 'CC-BY-4.0');
      INSERT INTO timeline_chronology VALUES ('ussher', 'Ussher', 'literal', NULL, 1, 0);
      INSERT INTO timeline_lane VALUES ('judah', 'Judah', NULL, 'judah', 0);
      INSERT INTO timeline_item (item_id, slug, kind, lane_id, title, reviewed_by) VALUES (1, 'a', 'reign', 'judah', 'A', NULL);
      INSERT INTO timeline_date (item_id, chronology_id, start_day, end_day, precision, circa) VALUES (1, 'ussher', 1000, 2000, 'year', 0);
      INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type) VALUES ('timeline_item', 1, 11001001, 11002000, 'primary_passage');
    `);
    tl.close();
    main.execute(
      `INSERT INTO module_metadata (module_uuid, module_type, module_name, abbreviation, database_path) VALUES (?, 'timeline', 'Test Timeline', 'TL', 'modules/timeline.db')`,
      ['00000000-0000-4000-8000-000000000001'],
    );
  }
  main.close();
  return dir;
}

describe('Timeline routes', () => {
  const dirs: string[] = [];
  const managers: DatabaseManager[] = [];

  function appFor(withTimeline: boolean, enabled = true): express.Express {
    const dir = buildDataDir(withTimeline);
    dirs.push(dir);
    const db = new DatabaseManager(dir, dir);
    managers.push(db);
    const app = express();
    app.use('/api/timeline', createTimelineRoutes(db, { enabled }));
    return app;
  }

  afterAll(() => {
    for (const m of managers) m.closeAll();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('returns the dataset with cache headers and an ETag', async () => {
    const app = appFor(true);
    const res = await request(app).get('/api/timeline');
    expect(res.status).toBe(200);
    expect(res.body.info).toMatchObject({ name: 'Test Timeline', abbreviation: 'TL' });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].passages).toEqual([{ start: 11001001, end: 11002000, primary: true }]);
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.headers.etag).toBeTruthy();

    const again = await request(app).get('/api/timeline').set('If-None-Match', res.headers.etag);
    expect(again.status).toBe(304);
  });

  it('answers 404 with a JSON error when no timeline module is installed', async () => {
    const res = await request(appFor(false)).get('/api/timeline');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 when the feature is disabled', async () => {
    const res = await request(appFor(true, false)).get('/api/timeline');
    expect(res.status).toBe(404);
  });
});
