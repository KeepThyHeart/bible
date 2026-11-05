/** W-005 / W-006 / W-013: module names from the URL/query are validated before use. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTopicalRoutes } from '../routes/topicalRoutes';
import { createBibleRoutes } from '../routes/bibleRoutes';
import { createInterlinearRoutes } from '../routes/interlinearRoutes';
import { logger } from '../utils/logger';

const hidden = {
  bibles: { modules: { SECRET: { active: false } }, sections: [] },
  commentaries: { modules: {}, sections: [] },
  dictionaries: { modules: {}, sections: [] },
} as any;

describe('topical routes module name (W-005)', () => {
  it('rejects an oversized module name without touching the loader', async () => {
    const getTopicalIndexRepo = vi.fn().mockReturnValue(null);
    const app = express();
    app.use('/api/topical', createTopicalRoutes({ getTopicalIndexRepo } as any, null));
    for (const url of ['topic/1', 'topic/1/children', 'topic/1/verses']) {
      const res = await request(app).get(`/api/topical/${'x'.repeat(8000)}/${url}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARAM');
    }
    expect(getTopicalIndexRepo).not.toHaveBeenCalled();
  });
});

describe('votd ?module= (W-005/W-006)', () => {
  const getBibleRepo = vi.fn().mockReturnValue(null);
  const db = { getBibleRepo, getDefaultBibleAbbreviation: () => 'KJV' } as any;
  const app = express();
  app.use('/api/bible', createBibleRoutes(db, undefined, { siteSettings: hidden }));

  it('404s a hidden Bible and 400s a malformed name, never opening them', async () => {
    const a = await request(app).get('/api/bible/votd?module=SECRET');
    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe('MODULE_NOT_FOUND');
    const b = await request(app).get('/api/bible/votd?module=' + encodeURIComponent('a b/../' + 'x'.repeat(200)));
    expect(b.status).toBe(400);
    expect(getBibleRepo).not.toHaveBeenCalled();
  });
});

describe('interlinear ?module= logging (W-013)', () => {
  beforeEach(() => vi.restoreAllMocks());
  it('does not echo a malformed module name into the log', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const getBibleRepo = vi.fn();
    const app = express();
    app.use('/api/interlinear', createInterlinearRoutes({ getBibleRepo, getDefaultInterlinearBibleAbbreviation: () => 'KJV' } as any));
    const evil = 'EVIL\nINJECT' + 'y'.repeat(500);
    const res = await request(app).get('/api/interlinear/1/1?module=' + encodeURIComponent(evil));
    expect(res.body).toEqual({ words: [], strongsEntries: {} });
    expect(getBibleRepo).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(String(call[0])).not.toContain('EVIL');
  });
});
