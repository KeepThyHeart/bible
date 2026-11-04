/**
 * The limits added before opening the site to the public (no site password):
 * per-client quotas, size caps on anonymous write stores, hidden modules
 * staying unreachable by name, and the inline-script hashes in the CSP.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { createClientQuota } from '../utils/clientQuota';
import { createDirectoryBudget } from '../utils/directoryBudget';
import { createFeedbackRoutes } from '../routes/feedbackRoutes';
import { createDesktopReportRoutes } from '../routes/desktopReportRoutes';
import { createBibleRoutes } from '../routes/bibleRoutes';
import { createSearchRoutes } from '../routes/searchRoutes';
import { contentSecurityPolicyDirectives, inlineScriptHashes } from '../cspDirectives';
import { DatabaseManager } from '../DatabaseManager';
import type { SiteSettings } from '../siteSettings';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hardening-test-')); });
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const fakeReq = (ip: string) => ({ ip, socket: {} }) as unknown as express.Request;

describe('createClientQuota', () => {
  it('allows `limit` uses per client per window, then reports the wait', () => {
    vi.useFakeTimers();
    const quota = createClientQuota({ limit: 2, windowMs: 60_000 });
    expect(quota.take(fakeReq('1.1.1.1'))).toBeNull();
    expect(quota.take(fakeReq('1.1.1.1'))).toBeNull();
    expect(quota.take(fakeReq('1.1.1.1'))).toBe(60);
    // Another client has its own allowance.
    expect(quota.take(fakeReq('2.2.2.2'))).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(quota.take(fakeReq('1.1.1.1'))).toBeNull();
  });
});

describe('createDirectoryBudget', () => {
  it('refuses past the file cap and reopens once files are removed', () => {
    vi.useFakeTimers();
    writeFileSync(join(dir, 'a.json'), 'x');
    const budget = createDirectoryBudget(dir, { maxFiles: 2, maxBytes: 1000 });
    expect(budget.hasRoom(1)).toBe(true);
    writeFileSync(join(dir, 'b.json'), 'x');
    budget.recordWrite(1);
    expect(budget.hasRoom(1)).toBe(false);

    unlinkSync(join(dir, 'a.json'));
    // Not re-counted until a minute has passed since the last count.
    expect(budget.hasRoom(1)).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(budget.hasRoom(1)).toBe(true);
  });

  it('refuses a file that would pass the byte cap', () => {
    const budget = createDirectoryBudget(dir, { maxFiles: 100, maxBytes: 10 });
    expect(budget.hasRoom(10)).toBe(true);
    expect(budget.hasRoom(11)).toBe(false);
  });
});

describe('POST /api/feedback limits', () => {
  const mount = (limits: { perClientPerHour: number; maxFiles: number; maxBytes: number }) => {
    const app = express();
    app.use(express.json());
    app.use('/api/feedback', createFeedbackRoutes(dir, 'strict', limits));
    return app;
  };

  it('answers 429 once the client has used its hourly quota, writing nothing more', async () => {
    const app = mount({ perClientPerHour: 2, maxFiles: 100, maxBytes: 1_000_000 });
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/api/feedback').send({ message: `m${i}` })).status).toBe(201);
    }
    const res = await request(app).post('/api/feedback').send({ message: 'one too many' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(readdirSync(resolve(dir, 'feedback'))).toHaveLength(2);
  });

  it('does not charge the quota for an invalid submission', async () => {
    const app = mount({ perClientPerHour: 1, maxFiles: 100, maxBytes: 1_000_000 });
    expect((await request(app).post('/api/feedback').send({ message: '' })).status).toBe(400);
    expect((await request(app).post('/api/feedback').send({ message: 'valid' })).status).toBe(201);
  });

  it('answers 503 when the store is full', async () => {
    const app = mount({ perClientPerHour: 100, maxFiles: 1, maxBytes: 1_000_000 });
    expect((await request(app).post('/api/feedback').send({ message: 'first' })).status).toBe(201);
    const res = await request(app).post('/api/feedback').send({ message: 'second' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_FULL');
  });
});

describe('POST /api/desktop-report limits', () => {
  it('answers 429 past the hourly quota', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/desktop-report', createDesktopReportRoutes(dir, '', { perClientPerHour: 1, maxFiles: 100, maxBytes: 1_000_000 }));
    const report = (id: string) => ({ type: 'manual', report_id: id, timestamp: '2026-11-03T00:00:00Z' });
    expect((await request(app).post('/api/desktop-report').send(report('r1'))).status).toBe(201);
    expect((await request(app).post('/api/desktop-report').send(report('r2'))).status).toBe(429);
  });
});

describe('inline script hashes in the CSP', () => {
  it('hashes inline scripts only, and drops unsafe-inline when there are any', () => {
    const inline = 'window.__BRAND__ = {};';
    mkdirSync(join(dir, 'present'));
    writeFileSync(join(dir, 'index.html'), `<html><script>${inline}</script><script type="module" src="/assets/x.js"></script></html>`);
    writeFileSync(join(dir, 'present', 'solo.html'), `<script>${inline}</script>`);
    const expected = `'sha256-${createHash('sha256').update(inline).digest('base64')}'`;

    const hashes = inlineScriptHashes(dir);
    expect(hashes).toEqual([expected]);

    const scriptSrc = Array.from(contentSecurityPolicyDirectives(undefined, undefined, null, hashes).scriptSrc ?? []);
    expect(scriptSrc).toContain(expected);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('ignores a literal <script> inside an HTML comment (B-098)', () => {
    const inline = 'window.__BRAND__ = {};';
    writeFileSync(join(dir, 'index.html'), `<!-- placeholder inside <script> tags is not escaped --><script>${inline}</script>`);
    expect(inlineScriptHashes(dir)).toEqual([`'sha256-${createHash('sha256').update(inline).digest('base64')}'`]);
  });

  it('falls back to unsafe-inline without a build', () => {
    expect(inlineScriptHashes(join(dir, 'missing'))).toEqual([]);
    expect(Array.from(contentSecurityPolicyDirectives().scriptSrc ?? [])).toContain("'unsafe-inline'");
  });
});

describe.runIf(existsSync(resolve(TEST_DATA_DIR, 'main.db')))('hidden Bibles stay hidden by name', () => {
  let db: DatabaseManager;
  let hidden: string;
  let visible: string;
  let settings: SiteSettings;

  beforeAll(() => {
    db = new DatabaseManager(TEST_DATA_DIR, TEST_MODULES_DIR);
    const abbrs = db.getModuleMetadataRepo().getByType('bible')
      .map(m => m.abbreviation || m.getAbbreviation())
      .filter((a): a is string => Boolean(a));
    if (abbrs.length < 2) throw new Error('These tests need at least two Bible modules in the test data');
    [visible, hidden] = abbrs;
    settings = {
      bibles: { modules: { [visible]: { active: true }, [hidden]: { active: false } }, sections: [] },
    };
  });

  it('answers 404 for a hidden Bible\'s chapter and verse routes', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/bible', createBibleRoutes(db, undefined, { siteSettings: settings }));
    expect((await request(app).get(`/api/bible/${visible}/43/3`)).status).toBe(200);
    expect((await request(app).get(`/api/bible/${hidden}/43/3`)).status).toBe(404);
    // Case does not get around it.
    expect((await request(app).get(`/api/bible/${hidden.toLowerCase()}/43/3`)).status).toBe(404);
    expect((await request(app).get(`/api/bible/${hidden}/verse/43003016`)).status).toBe(404);
    expect((await request(app).post(`/api/bible/${hidden}/verses`).send({ verseIds: [43003016] })).status).toBe(404);
  });

  it('keyword search naming only hidden Bibles returns nothing', async () => {
    const app = express();
    app.use('/api/search', createSearchRoutes(db, { siteSettings: settings }));
    const res = await request(app).get(`/api/search/keyword?q=love&modules=${hidden}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalAvailable).toBe(0);
  });
});
