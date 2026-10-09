/**
 * Tests for /api/word-study. The service itself is covered in @bible/core; here
 * it is replaced so the tests pin down validation, module gating and the
 * arguments the routes pass through, with no data directory needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const svc = vi.hoisted(() => ({
  resolve: vi.fn(() => [{ strongs: 'G25', language: 'Greek', gloss: 'love' }]),
  getOverview: vi.fn(() => ({ totals: { occurrences: 3, verses: 2 } })),
  getOccurrences: vi.fn(() => ({ total: 0, items: [] })),
  ctor: vi.fn(),
}));

vi.mock('../../../core.js', async (orig) => {
  const actual = await orig<typeof import('../../../core.js')>();
  class FakeWordStudyService {
    constructor(deps: unknown) { svc.ctor(deps); }
    resolve = svc.resolve;
    getOverview = svc.getOverview;
    getOccurrences = svc.getOccurrences;
  }
  return { ...actual, WordStudyService: FakeWordStudyService };
});

import { createWordStudyRoutes } from '../routes';
import type { DatabaseManager } from '../../../DatabaseManager';
import type { SiteSettings } from '../../../siteSettings';

const settings = { bibles: { modules: { KJV: { active: true }, HIDDEN: { active: false } } } } as unknown as SiteSettings;

function makeApp(siteSettings: SiteSettings | null = settings) {
  const repos: Record<string, object> = { KJV: {}, HIDDEN: {} };
  const db = {
    getModuleMetadataRepo: () => ({
      getByType: () => Object.keys(repos).map(a => ({ abbreviation: a, getAbbreviation: () => a })),
    }),
    getBibleRepo: (a: string) => repos[a] ?? null,
    getDictionaryRepo: (n: string) => ({ name: n }),
    getWordFamilyService: () => ({ family: true }),
  } as unknown as DatabaseManager;
  const app = express();
  app.use(express.json());
  app.use('/api/word-study', createWordStudyRoutes(db, siteSettings));
  return app;
}

const group = { id: 'g1', label: 'love', terms: ['love', 'lov*'], exclude: ['lovely'] };

beforeEach(() => { vi.clearAllMocks(); });

describe('GET /resolve', () => {
  it('returns candidates', async () => {
    const res = await request(makeApp()).get('/api/word-study/resolve?q=G25');
    expect(res.status).toBe(200);
    expect(res.body[0].strongs).toBe('G25');
    expect(svc.resolve).toHaveBeenCalledWith('G25');
  });

  it('rejects a missing query', async () => {
    expect((await request(makeApp()).get('/api/word-study/resolve')).status).toBe(400);
  });
});

describe('POST /overview', () => {
  it('normalises a Strong\'s subject and passes options', async () => {
    const res = await request(makeApp()).post('/api/word-study/overview')
      .send({ subject: { kind: 'strongs', strongs: 'g0025' }, options: { module: 'KJV', renderingMode: 'phrase' } });
    expect(res.status).toBe(200);
    expect(svc.getOverview).toHaveBeenCalledWith({ kind: 'strongs', strongs: 'G25' }, { module: 'KJV', renderingMode: 'phrase' });
  });

  it('accepts a group subject', async () => {
    const res = await request(makeApp()).post('/api/word-study/overview').send({ subject: { kind: 'group', group } });
    expect(res.status).toBe(200);
    expect(svc.getOverview).toHaveBeenCalledWith({ kind: 'group', group: { ...group } }, {});
  });

  it('builds the service once, from served modules only', async () => {
    const app = makeApp();
    await request(app).post('/api/word-study/overview').send({ subject: { kind: 'strongs', strongs: 'G25' } });
    await request(app).post('/api/word-study/overview').send({ subject: { kind: 'strongs', strongs: 'G26' } });
    expect(svc.ctor).toHaveBeenCalledTimes(1);
    const deps = svc.ctor.mock.calls[0][0] as { bibles: () => Map<string, unknown> };
    expect([...deps.bibles().keys()]).toEqual(['KJV']);
  });

  it.each([
    ['no subject', {}],
    ['unknown kind', { subject: { kind: 'x' } }],
    ['bad strongs', { subject: { kind: 'strongs', strongs: 'love' } }],
    ['group without terms', { subject: { kind: 'group', group: { label: 'a' } } }],
    ['group with empty terms', { subject: { kind: 'group', group: { label: 'a', terms: [] } } }],
    ['too many terms', { subject: { kind: 'group', group: { label: 'a', terms: Array(61).fill('w') } } }],
    ['too many excludes', { subject: { kind: 'group', group: { label: 'a', terms: ['w'], exclude: Array(61).fill('w') } } }],
    ['long term', { subject: { kind: 'group', group: { label: 'a', terms: ['x'.repeat(81)] } } }],
    ['long label', { subject: { kind: 'group', group: { label: 'x'.repeat(81), terms: ['w'] } } }],
    ['non-string term', { subject: { kind: 'group', group: { label: 'a', terms: [5] } } }],
    ['bad module', { subject: { kind: 'strongs', strongs: 'G25' }, options: { module: '../x' } }],
    ['bad renderingMode', { subject: { kind: 'strongs', strongs: 'G25' }, options: { renderingMode: 'nope' } }],
  ])('rejects %s with 400', async (_l, body) => {
    const res = await request(makeApp()).post('/api/word-study/overview').send(body);
    expect(res.status).toBe(400);
    expect(svc.getOverview).not.toHaveBeenCalled();
  });

  it('accepts exactly 60 terms of 80 characters', async () => {
    const terms = Array.from({ length: 60 }, () => 'x'.repeat(80));
    const res = await request(makeApp()).post('/api/word-study/overview')
      .send({ subject: { kind: 'group', group: { label: 'a', terms } } });
    expect(res.status).toBe(200);
  });

  it('answers 500 when the service throws', async () => {
    svc.getOverview.mockImplementationOnce(() => { throw new Error('boom'); });
    const res = await request(makeApp()).post('/api/word-study/overview').send({ subject: { kind: 'strongs', strongs: 'G25' } });
    expect(res.status).toBe(500);
  });
});

describe('POST /occurrences', () => {
  const subject = { kind: 'strongs', strongs: 'G25' };

  it('passes a validated query through', async () => {
    const res = await request(makeApp()).post('/api/word-study/occurrences')
      .send({ subject, query: { module: 'KJV', book: 43, form: 'love', offset: 10, limit: 500 } });
    expect(res.status).toBe(200);
    expect(svc.getOccurrences).toHaveBeenCalledWith(subject, { module: 'KJV', book: 43, form: 'love', offset: 10, limit: 500 });
  });

  it.each([
    ['limit over 500', { module: 'KJV', limit: 501 }],
    ['limit zero', { module: 'KJV', limit: 0 }],
    ['negative offset', { module: 'KJV', offset: -1 }],
    ['book out of range', { module: 'KJV', book: 67 }],
    ['missing module', { limit: 5 }],
    ['bad module chars', { module: 'K JV' }],
  ])('rejects %s with 400', async (_l, query) => {
    const res = await request(makeApp()).post('/api/word-study/occurrences').send({ subject, query });
    expect(res.status).toBe(400);
  });

  it('404s a module the server does not serve', async () => {
    const res = await request(makeApp()).post('/api/word-study/occurrences').send({ subject, query: { module: 'HIDDEN' } });
    expect(res.status).toBe(404);
    const res2 = await request(makeApp()).post('/api/word-study/occurrences').send({ subject, query: { module: 'NOPE' } });
    expect(res2.status).toBe(404);
  });

  it('serves no modules when site settings are missing', async () => {
    const res = await request(makeApp(null)).post('/api/word-study/occurrences').send({ subject, query: { module: 'KJV' } });
    expect(res.status).toBe(404);
  });
});
