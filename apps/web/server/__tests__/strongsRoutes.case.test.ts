/** W-007: lowercase Strong's numbers must resolve to the right testament's dictionary. */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStrongsRoutes } from '../routes/strongsRoutes';

function appWith(requested: string[]) {
  const db = {
    getDictionaryRepo: (name: string) => {
      requested.push(name);
      return { getEntryByKey: (k: string) => ({ word: k, definition: 'd' }) };
    },
  } as any;
  const app = express();
  app.use('/api/strongs', createStrongsRoutes(db));
  return app;
}

describe('strongsRoutes casing (W-007)', () => {
  it('h430 reads the Hebrew dictionary, not the Greek one', async () => {
    const requested: string[] = [];
    const res = await request(appWith(requested)).get('/api/strongs/h430');
    expect(res.status).toBe(200);
    expect(requested).toEqual(['strongshebrew']);
    expect(res.body.strongsNumber).toBe('H430');
  });

  it('g430 reads Greek; an Aramaic prefix is not treated as Greek', async () => {
    const requested: string[] = [];
    const app = appWith(requested);
    expect((await request(app).get('/api/strongs/g430')).status).toBe(200);
    expect(requested).toEqual(['strongsgreek']);
    const a = await request(app).get('/api/strongs/A12');
    expect(a.status).toBe(404);
    expect(requested).toEqual(['strongsgreek']);
  });
});
