import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resolve } from 'path';
import { createHymnRoutes } from '../routes/hymnRoutes';
import { HymnLibrary } from '../present/hymns/HymnLibrary';

/**
 * The HTTP surface of the hymn library.
 *
 * The library's own behaviour is tested in `hymns.test.ts`; what is left here
 * is what only exists at the boundary -- the query parameters, the failure
 * codes, and the fact that this is public content rather than session state.
 */

const library = new HymnLibrary();
library.load(resolve(__dirname, '../../../../hymns'));

let app: express.Express;

beforeEach(() => {
  app = express();
  app.use('/api/hymns', createHymnRoutes({ library }));
});

describe('GET /api/hymns', () => {
  it('browses the library when nothing is asked for', () => {
    // A picker that shows nothing until you type is useless to a presenter who
    // knows they want a hymn but not which one.
    return request(app).get('/api/hymns').expect(200).then(res => {
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.hymns.length).toBe(res.body.total);
    });
  });

  it('searches title, first line and hymnal number alike', async () => {
    for (const query of ['amazing grace', 'how sweet the sound', '460']) {
      const res = await request(app).get(`/api/hymns?q=${encodeURIComponent(query)}`);
      expect(res.status).toBe(200);
      expect(res.body.hymns[0]?.id, `searching ${query}`).toBe('amazing-grace');
    }
  });

  it('reports the true total even when it returns fewer', async () => {
    const res = await request(app).get('/api/hymns?limit=1');
    expect(res.body.hymns).toHaveLength(1);
    expect(res.body.total).toBeGreaterThan(1);
  });

  it('answers an empty list rather than an error for a query nothing matches', async () => {
    const res = await request(app).get('/api/hymns?q=zzzznothing');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hymns: [], total: 0 });
  });
});

describe('GET /api/hymns/:id', () => {
  it('returns slides ready to put on a screen', async () => {
    const res = await request(app).get('/api/hymns/amazing-grace');
    expect(res.status).toBe(200);
    expect(res.body.slides[0].lines[0]).toBe('Amazing grace! how sweet the sound');
    expect(res.body.attribution).toContain('John Newton');
  });

  it('honours a verse order the presenter chose', async () => {
    // The file's own order is a default, not a constraint: a service that sings
    // only verses one and four is entirely ordinary.
    const res = await request(app).get('/api/hymns/amazing-grace?order=1%204');
    expect(res.status).toBe(200);
    expect(res.body.slides.map((s: { token: string }) => s.token)).toEqual(['1', '4']);
  });

  it('refuses an order that is not made of section tokens', async () => {
    await request(app).get('/api/hymns/amazing-grace?order=1%20DROP').expect(400);
  });

  it('404s an unknown hymn', async () => {
    await request(app).get('/api/hymns/not-a-hymn').expect(404);
  });

  it('is cacheable, unlike everything else in the presenter path', async () => {
    // Hymn text does not change between deployments, and the machine driving a
    // television may be on a connection that struggles.
    const res = await request(app).get('/api/hymns/amazing-grace');
    expect(res.headers['cache-control']).toContain('max-age');
  });
});
