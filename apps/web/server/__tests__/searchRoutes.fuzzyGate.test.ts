import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSearchRoutes } from '../routes/searchRoutes';
import type { DatabaseManager } from '../DatabaseManager';

/**
 * The keyword route opts in to the coverage gate for approximate matches.
 *
 * Stubbed database on purpose (no module data needed): what is under test is
 * the option the route hands the core search service, since the desktop app
 * shares that service and must keep its any-term default.
 */
describe('GET /api/search/keyword approximate-match gate', () => {
  it('asks the search service for coverage-gated approximate matches', async () => {
    const search = vi.fn(async () => []);
    const db = {
      getSearchService: () => ({ search, addBibleModule: vi.fn() }),
      getBibleRepo: () => null,
      getEnrichmentsDb: () => { throw new Error('unused'); },
    } as unknown as DatabaseManager;

    const app = express();
    app.use('/api/search', createSearchRoutes(db, {}));

    const res = await request(app).get('/api/search/keyword').query({ q: 'God so loved the world' });

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    const [query, options] = search.mock.calls[0] as unknown as [string, { fuzzyGate?: string }];
    expect(query).toBe('God so loved the world');
    expect(options.fuzzyGate).toBe('coverage');
  });
});
