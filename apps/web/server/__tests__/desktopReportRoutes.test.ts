import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { createDesktopReportRoutes } from '../routes/desktopReportRoutes';

let dataDir: string;
let app: express.Express;

function mount(token = ''): express.Express {
  const a = express();
  // express.json() must be mounted first or req.body is undefined for a JSON body.
  a.use(express.json());
  a.use('/api/desktop-report', createDesktopReportRoutes(dataDir, token));
  return a;
}

function storedFiles(): string[] {
  return readdirSync(resolve(dataDir, 'desktop-reports'));
}

function readStored(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dataDir, 'desktop-reports', name), 'utf-8'));
}

/** The shape `DiagnosticsService.buildFeedbackPayload` produces. */
function feedbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'feedback',
    report_id: '2026-09-05-feedback-ab12',
    timestamp: '2026-09-05T10:00:00.000Z',
    app_version: '0.1.1',
    build_id: '6e80a84',
    user_description: 'The commentary pane scrolls to the top.',
    ...overrides,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'desktop-report-test-'));
  app = mount();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('POST /api/desktop-report', () => {
  it('stores a feedback report whose content round-trips', async () => {
    const res = await request(app).post('/api/desktop-report').send(feedbackPayload());

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const files = storedFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('-feedback-');

    const stored = readStored(files[0]);
    expect(stored.type).toBe('feedback');
    expect(stored.reportId).toBe('2026-09-05-feedback-ab12');
    expect(stored.appVersion).toBe('0.1.1');
    expect(stored.buildId).toBe('6e80a84');
    expect((stored.payload as Record<string, unknown>).user_description).toBe(
      'The commentary pane scrolls to the top.'
    );
  });

  it('keeps desktop reports out of the web feedback directory', async () => {
    await request(app).post('/api/desktop-report').send(feedbackPayload());

    expect(readdirSync(dataDir)).toEqual(['desktop-reports']);
  });

  it('preserves type-specific fields it does not know about', async () => {
    await request(app)
      .post('/api/desktop-report')
      .send(
        feedbackPayload({
          type: 'crash',
          error: { message: 'boom', type: 'TypeError', stack: 'at x' },
          recent_ipc: [{ channel: 'bible:getChapter', ts: '2026-09-05T09:59:00.000Z' }],
        })
      );

    const stored = readStored(storedFiles()[0]);
    const payload = stored.payload as Record<string, unknown>;
    expect(payload.error).toEqual({ message: 'boom', type: 'TypeError', stack: 'at x' });
    expect(payload.recent_ipc).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Privacy. The desktop app shows the user a summary promising it never sends
  // their IP address; recording it here would make that promise false.
  // -------------------------------------------------------------------------
  it('never records the client address', async () => {
    await request(app)
      .post('/api/desktop-report')
      .set('X-Forwarded-For', '203.0.113.42')
      .send(feedbackPayload());

    const raw = readFileSync(join(dataDir, 'desktop-reports', storedFiles()[0]), 'utf-8');
    expect(raw).not.toContain('203.0.113.42');
    expect(raw).not.toContain('"ip"');
  });

  // -------------------------------------------------------------------------
  // Shared token
  // -------------------------------------------------------------------------
  describe('when a token is configured', () => {
    beforeEach(() => {
      app = mount('s3cret-build-token');
    });

    it('accepts a report presenting the matching token', async () => {
      const res = await request(app)
        .post('/api/desktop-report')
        .set('X-Report-Token', 's3cret-build-token')
        .send(feedbackPayload());

      expect(res.status).toBe(201);
      expect(storedFiles()).toHaveLength(1);
    });

    it('rejects a report with no token, and writes nothing', async () => {
      const res = await request(app).post('/api/desktop-report').send(feedbackPayload());

      // 404, not 401: a scanner should not learn that this path exists.
      expect(res.status).toBe(404);
      expect(storedFiles()).toHaveLength(0);
    });

    it('rejects a wrong token of the same length', async () => {
      const res = await request(app)
        .post('/api/desktop-report')
        .set('X-Report-Token', 's3cret-build-tokeX')
        .send(feedbackPayload());

      expect(res.status).toBe(404);
      expect(storedFiles()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  it('rejects an unrecognised report type', async () => {
    const res = await request(app)
      .post('/api/desktop-report')
      .send(feedbackPayload({ type: 'exfiltrate' }));

    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects a report id that could be used as a path', async () => {
    const res = await request(app)
      .post('/api/desktop-report')
      .send(feedbackPayload({ report_id: '../../etc/passwd' }));

    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects a missing timestamp', async () => {
    const res = await request(app)
      .post('/api/desktop-report')
      .send(feedbackPayload({ timestamp: '   ' }));

    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects an oversized description', async () => {
    const res = await request(app)
      .post('/api/desktop-report')
      .send(feedbackPayload({ user_description: 'x'.repeat(20001) }));

    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('names each stored file distinctly so concurrent reports cannot collide', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/api/desktop-report')
          .send(feedbackPayload({ report_id: `report-${i}` }))
      )
    );

    const files = storedFiles();
    expect(files).toHaveLength(5);
    expect(new Set(files).size).toBe(5);
  });
});
