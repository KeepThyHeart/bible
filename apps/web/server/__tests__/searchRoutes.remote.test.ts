import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { RemoteSemantic } from '@bible/core';
import { createSearchRoutes } from '../routes/searchRoutes';
import { RemoteSemanticService } from '../search/RemoteSemanticService';

const CONSENT = String(RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION);

const repo = {
  getVerse: (id: number) => ({ text: `text ${id}` }),
  getVerseRange: () => [],
};
const db = {
  getBookRepo: () => ({ getAll: () => [{ bookNumber: 43, bookName: 'John' }] }),
  getEnrichmentsDb: () => { throw new Error('none'); },
  getBibleRepo: (m: string) => (m === 'KJV' || m === 'WEB' ? repo : null),
  resolveAbbreviation: (m: string) => m,
  getDefaultBibleAbbreviation: () => 'KJV',
  getSearchService: () => null,
} as never;

function setup(fetchFn: (...a: unknown[]) => Promise<Response>) {
  const client = new RemoteSemantic.RemoteSemanticClient({
    baseUrl: 'http://bibsearch.internal:8080', apiKey: 'SECRETKEY', fetch: fetchFn as unknown as typeof fetch,
    sleep: async () => {},
  });
  const app = express();
  app.use('/api/search', createSearchRoutes(db, { remote: new RemoteSemanticService(client) }));
  return app;
}

const okResponse = () => new Response(JSON.stringify({
  mode: 'semantic', degraded: false, results: [{ rank: 1, id: 'KJV.JHN.3.16', score: 0.9 }],
}), { status: 200, headers: { 'content-type': 'application/json', 'RateLimit-Remaining': '4' } });

describe('GET /api/search/semantic (remote mode)', () => {
  it('returns 403 CONSENT_REQUIRED and sends nothing without the consent header', async () => {
    const f = vi.fn(async () => okResponse());
    const res = await request(setup(f)).get('/api/search/semantic?q=forgiveness');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    expect(res.body.results).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects an outdated notice version', async () => {
    const f = vi.fn(async () => okResponse());
    const res = await request(setup(f)).get('/api/search/semantic?q=forgiveness').set('X-Remote-Search-Consent', '0');
    expect(res.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it('answers with hydrated results and semantic meta, forwarding no user data', async () => {
    const f = vi.fn(async (_u: unknown, _i?: unknown) => okResponse());
    const res = await request(setup(f)).get('/api/search/semantic?q=forgiveness&modules=WEB')
      .set('X-Remote-Search-Consent', CONSENT)
      .set('Cookie', 'session=abc')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('Authorization', 'Bearer user-token');
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ verseId: 43003016, module: 'WEB', type: 'verse' });
    expect(res.body.total).toBe(1);
    expect(res.body.timings).toBeDefined();
    expect(res.body.semantic).toMatchObject({ source: 'remote', rateLimit: { remaining: 4 } });
    const headers = new Headers((f.mock.calls[0][1] as RequestInit).headers);
    expect([...headers.keys()].sort()).toEqual(expect.not.arrayContaining(['cookie', 'authorization', 'x-forwarded-for']));
    expect(headers.get('x-api-key')).toBe('SECRETKEY');
  });

  it('falls back to the default translation for an unknown module', async () => {
    const res = await request(setup(async () => okResponse())).get('/api/search/semantic?q=forgiveness&modules=NOPE')
      .set('X-Remote-Search-Consent', CONSENT);
    expect(res.body.results[0].module).toBe('KJV');
  });

  it('answers 503 REMOTE_UNAVAILABLE with a note and leaks nothing', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'http://bibsearch.internal:8080 SECRETKEY' } }), {
      status: 429, headers: { 'content-type': 'application/json', 'Retry-After': '3600' },
    }));
    const res = await request(setup(f)).get('/api/search/semantic?q=forgiveness').set('X-Remote-Search-Consent', CONSENT);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('REMOTE_UNAVAILABLE');
    expect(res.body.results).toEqual([]);
    expect(res.body.semantic.source).toBe('remote');
    expect(res.body.semantic.notice.kind).toBe('quota');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('SECRETKEY');
    expect(raw).not.toContain('bibsearch.internal');
  });

  it('maps a network failure to unavailable', async () => {
    const res = await request(setup(async () => { throw new TypeError('fetch failed'); }))
      .get('/api/search/semantic?q=forgiveness').set('X-Remote-Search-Consent', CONSENT);
    expect(res.status).toBe(503);
    expect(res.body.semantic.notice).toEqual({ kind: 'unavailable' });
  });

  it('still validates the query', async () => {
    const f = vi.fn(async () => okResponse());
    const res = await request(setup(f)).get('/api/search/semantic').set('X-Remote-Search-Consent', CONSENT);
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('warmup sends nothing to bibsearch', async () => {
    const f = vi.fn(async () => okResponse());
    const res = await request(setup(f)).post('/api/search/semantic/warmup');
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it('pages through results with a single remote call fetched at k=100', async () => {
    const hits = Array.from({ length: 150 }, (_, i) => ({ rank: i + 1, id: `KJV.JHN.3.${i + 1}`, score: 0.9 }));
    const f = vi.fn(async (_u: unknown, _i?: unknown) => new Response(JSON.stringify({
      mode: 'semantic', degraded: false, results: hits,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const app = setup(f);
    const lengths: number[] = [];
    for (const n of [20, 40, 60, 100, 250, 500]) {
      const res = await request(app).get(`/api/search/semantic?q=paging&maxResults=${n}`).set('X-Remote-Search-Consent', CONSENT);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(res.body.results.length);
      lengths.push(res.body.results.length);
    }
    expect(f).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify((f.mock.calls[0][1] as RequestInit).body ?? '') + String(f.mock.calls[0][0]);
    expect(sent).toMatch(/\bk\b\W+100\b|k=100/);
    expect(lengths).toEqual([20, 40, 60, 100, 100, 100]);
  });

  it('concurrent misses for the same query share one remote call', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const f = vi.fn(async (_u: unknown, _i?: unknown) => { await gate; return okResponse(); });
    const app = setup(f);
    const get = () => request(app).get('/api/search/semantic?q=same%20idea').set('X-Remote-Search-Consent', CONSENT).then(r => r);
    const a = get();
    const b = get();
    // Let both requests reach the route before the remote answers.
    await new Promise(r => setTimeout(r, 50));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
