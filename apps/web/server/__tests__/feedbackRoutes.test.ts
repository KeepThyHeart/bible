import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { createFeedbackRoutes } from '../routes/feedbackRoutes';

let dataDir: string;
let app: express.Express;

function mount(privacyMode: 'strict' | 'relaxed' = 'strict'): express.Express {
  const a = express();
  // express.json() must be mounted first or req.body is undefined for a JSON body.
  a.use(express.json());
  a.use('/api/feedback', createFeedbackRoutes(dataDir, privacyMode));
  return a;
}

function storedFiles(): string[] {
  return readdirSync(resolve(dataDir, 'feedback'));
}

function readStored(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dataDir, 'feedback', name), 'utf-8'));
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'feedback-test-'));
  app = mount();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// POST /api/feedback — happy path
// ---------------------------------------------------------------------------
describe('POST /api/feedback', () => {
  it('writes a submission whose content round-trips', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ message: '  The commentary pane scrolls to the top.  ', category: 'bug', contact: 'reader@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.id).toBe('string');

    const files = storedFiles();
    expect(files).toHaveLength(1);

    const stored = readStored(files[0]);
    expect(stored.message).toBe('The commentary pane scrolls to the top.');
    expect(stored.category).toBe('bug');
    expect(stored.contact).toBe('reader@example.com');
    expect(stored.id).toBe(res.body.id);
    expect(typeof stored.submittedAt).toBe('string');
  });

  it('defaults an omitted category to "other" and omits a blank contact', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'Nice app.' });
    expect(res.status).toBe(201);

    const stored = readStored(storedFiles()[0]);
    expect(stored.category).toBe('other');
    expect(stored).not.toHaveProperty('contact');
  });

  it('gives each submission its own file', async () => {
    await request(app).post('/api/feedback').send({ message: 'first' });
    await request(app).post('/api/feedback').send({ message: 'second' });
    expect(storedFiles()).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  it('rejects a missing message', async () => {
    const res = await request(app).post('/api/feedback').send({ category: 'bug' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects a whitespace-only message', async () => {
    const res = await request(app).post('/api/feedback').send({ message: '   \n  ' });
    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects an oversized message', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAM');
    expect(storedFiles()).toHaveLength(0);
  });

  it('accepts a message at exactly the cap', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'x'.repeat(5000) });
    expect(res.status).toBe(201);
  });

  it('rejects an unknown category', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'hello', category: 'complaint' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('bug');
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects an oversized contact', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'hello', contact: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects a non-string message', async () => {
    const res = await request(app).post('/api/feedback').send({ message: { text: 'hi' } });
    expect(res.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Privacy and information disclosure
  // -------------------------------------------------------------------------
  it('never echoes a filesystem path', async () => {
    const res = await request(app).post('/api/feedback').send({ message: 'where do I live?' });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(dataDir);
    expect(body).not.toContain('feedback/');
    expect(body).not.toContain('.json');
    expect(res.body).not.toHaveProperty('path');
    expect(res.body).not.toHaveProperty('file');
  });

  it('does not record an IP in strict privacy mode', async () => {
    await request(app).post('/api/feedback').send({ message: 'anonymous please' });
    const stored = readStored(storedFiles()[0]);
    expect(stored).not.toHaveProperty('ip');
  });

  it('records the IP in relaxed privacy mode', async () => {
    const relaxed = mount('relaxed');
    await request(relaxed).post('/api/feedback').send({ message: 'log me' });
    const stored = readStored(storedFiles()[0]);
    expect(typeof stored.ip).toBe('string');
  });
});
