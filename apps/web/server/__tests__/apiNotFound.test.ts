import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiNotFound } from '../middleware/apiNotFound';

function makeApp() {
  const app = express();
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api', apiNotFound);
  // Stand-in for the SPA/static fallback.
  app.get('*', (_req, res) => { res.type('html').send('<!doctype html>shell'); });
  return app;
}

describe('unknown /api paths (B-176)', () => {
  it('answers a JSON 404 in the API error shape, even for a browser Accept header', async () => {
    const res = await request(makeApp()).get('/api/nope/at/all').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('also covers POST and the bare /api path', async () => {
    const app = makeApp();
    expect((await request(app).post('/api/nope')).status).toBe(404);
    const bare = await request(app).get('/api');
    expect(bare.status).toBe(404);
    expect(bare.body.error.code).toBe('NOT_FOUND');
  });

  it('leaves real routes and non-API paths alone', async () => {
    const app = makeApp();
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
    const page = await request(app).get('/some/page').set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('shell');
  });
});
