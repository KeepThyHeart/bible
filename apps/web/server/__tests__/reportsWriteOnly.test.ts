/**
 * Desktop reports and web feedback are WRITE-ONLY from the web: only POST is
 * mounted, `/data` serves an allowlist that excludes the report folders, files
 * are owner-only on disk, and a client is rate limited.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createDesktopReportRoutes } from '../routes/desktopReportRoutes';
import { createFeedbackRoutes } from '../routes/feedbackRoutes';
import { dataAllowlist } from '../utils/dataAllowlist';

let dataDir: string;
let app: express.Express;

function mount(): express.Express {
  const a = express();
  a.use(express.json());
  a.use('/api/desktop-report', createDesktopReportRoutes(dataDir, ''));
  a.use('/api/feedback', createFeedbackRoutes(dataDir, 'strict'));
  // Same wiring as server/index.ts: allowlist, then static, then 404s.
  a.use('/data', dataAllowlist);
  a.use('/data', express.static(dataDir, { fallthrough: false }));
  a.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND' } }); });
  return a;
}

const feedbackBody = {
  type: 'feedback',
  report_id: 'fbk-0001',
  timestamp: '2026-11-01T10:00:00.000Z',
  app_version: '1.0.0',
  user_description: 'Please add a dark mode.',
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reports-wo-'));
  app = mount();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('reports are never readable from the web', () => {
  it('GET on the report and feedback endpoints is 404', async () => {
    expect((await request(app).get('/api/desktop-report')).status).toBe(404);
    expect((await request(app).get('/api/feedback')).status).toBe(404);
    expect((await request(app).get('/api/desktop-report/anything')).status).toBe(404);
  });

  it('serves nothing from the report folders under /data, even for a file that exists', async () => {
    await request(app).post('/api/desktop-report').send(feedbackBody).expect(201);
    await request(app).post('/api/feedback').send({ message: 'hello' }).expect(201);
    const reportFile = readdirSync(join(dataDir, 'desktop-reports'))[0];
    const feedbackFile = readdirSync(join(dataDir, 'feedback'))[0];

    for (const url of [
      '/data/desktop-reports',
      '/data/desktop-reports/',
      `/data/desktop-reports/${reportFile}`,
      '/data/feedback',
      '/data/feedback/',
      `/data/feedback/${feedbackFile}`,
      `/data/models/../desktop-reports/${reportFile}`,
      `/data/%2e%2e/feedback/${feedbackFile}`,
    ]) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.text, url).not.toContain('Please add a dark mode');
    }
  });
});

describe('on-disk permissions', () => {
  it('writes report files 0600 and the folders 0700', async () => {
    await request(app).post('/api/desktop-report').send(feedbackBody).expect(201);
    await request(app).post('/api/feedback').send({ message: 'hello' }).expect(201);

    for (const dir of ['desktop-reports', 'feedback']) {
      expect(statSync(join(dataDir, dir)).mode & 0o777, dir).toBe(0o700);
      const files = readdirSync(join(dataDir, dir));
      expect(files).toHaveLength(1);
      expect(statSync(join(dataDir, dir, files[0])).mode & 0o777, dir).toBe(0o600);
    }
  });
});

describe('rate limiting', () => {
  it('desktop-report: a client over its hourly quota gets 429 with Retry-After', async () => {
    const a = express();
    a.use(express.json());
    a.use('/api/desktop-report', createDesktopReportRoutes(dataDir, '', {
      perClientPerHour: 2, maxFiles: 100, maxBytes: 1024 * 1024,
    }));
    await request(a).post('/api/desktop-report').send(feedbackBody).expect(201);
    await request(a).post('/api/desktop-report').send(feedbackBody).expect(201);
    const res = await request(a).post('/api/desktop-report').send(feedbackBody);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(readdirSync(join(dataDir, 'desktop-reports'))).toHaveLength(2);
  });

  it('feedback: the same quota mechanism applies', async () => {
    const a = express();
    a.use(express.json());
    a.use('/api/feedback', createFeedbackRoutes(dataDir, 'strict', {
      perClientPerHour: 1, maxFiles: 100, maxBytes: 1024 * 1024,
    }));
    await request(a).post('/api/feedback').send({ message: 'one' }).expect(201);
    expect((await request(a).post('/api/feedback').send({ message: 'two' })).status).toBe(429);
  });
});
