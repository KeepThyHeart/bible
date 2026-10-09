import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter, isGloballyRateLimitExempt, isSyncPath, tierForApiPath } from '../middleware/rateLimiter';

// Generous: CI and shared dev machines can be heavily loaded.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('sync API rate limit exemption', () => {
  it('recognises /api/sync paths (relative to /api) and nothing that merely starts with "sync"', () => {
    expect(isSyncPath('/sync')).toBe(true);
    expect(isSyncPath('/sync/v1/info')).toBe(true);
    expect(isSyncPath('/synchronise')).toBe(false);
    expect(isSyncPath('/bible/sync/x')).toBe(false);
  });

  it('exempts sync and games from the global ceiling, nothing else', () => {
    expect(isGloballyRateLimitExempt('/sync/v1/changes')).toBe(true);
    expect(isGloballyRateLimitExempt('/games/room')).toBe(true);
    expect(isGloballyRateLimitExempt('/bible/KJV/1/1')).toBe(false);
  });

  it('wired as index.ts does: sync is never limited, other API paths are', async () => {
    const limiter = createRateLimiter({ global: 5, default: 5, content: 5, windowMs: 60_000 });
    const app = express();
    const globalLimit = limiter.global();
    app.use('/api', (req, res, next) => (isGloballyRateLimitExempt(req.path) ? next() : globalLimit(req, res, next)));
    app.use('/api', (req, res, next) => (isSyncPath(req.path) ? next() : limiter.middleware(tierForApiPath(req.path))(req, res, next)));
    app.get('/api/*', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 30; i++) {
      expect((await request(app).get('/api/sync/v1/info')).status).toBe(200);
    }
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await request(app).get('/api/bible/books')).status);
    expect(statuses).toContain(429);
  });
});
