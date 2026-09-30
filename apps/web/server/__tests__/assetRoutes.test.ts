import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAssetRouter } from '../routes/assetRoutes';

let root: string;
let app: express.Express;
const BODY = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

function put(rel: string, body: Buffer | string) {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-routes-'));
  put('v1/index.json', '{"schema":"kth-asset-index/1","assets":[]}');
  put('v1/tts-voice/v1/1/voice.onnx', BODY);
  put('v1/tts-voice/v1/1/voice.onnx.sha256', 'abc  voice.onnx\n');
  put('v1/data/n/1/sub/n.bin', BODY);
  put('v1/data/n/1/.hidden', 'nope');
  put('secret.txt', 'top secret');
  app = express();
  app.use('/assets', createAssetRouter(root));
  app.get('/assets/app-abc.js', (_req, res) => { res.type('js').send('client bundle'); });
  app.get('*', (_req, res) => { res.type('html').send('<!doctype html>SPA'); });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('asset routes', () => {
  it('serves index.json revalidated and untransformed', async () => {
    const res = await request(app).get('/assets/v1/index.json');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.body.schema).toBe('kth-asset-index/1');
  });

  it('serves files immutable with octet-stream, ETag and ranges', async () => {
    const res = await request(app).get('/assets/v1/tts-voice/v1/1/voice.onnx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable, no-transform');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers.etag).toBeTruthy();
  });

  it('answers Range with 206 and If-Range mismatch with 200', async () => {
    const r = await request(app).get('/assets/v1/data/n/1/sub/n.bin').set('Range', 'bytes=10-15').buffer(true)
      .parse((res, cb) => { const c: Buffer[] = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(206);
    expect(r.headers['content-range']).toBe('bytes 10-15/36');
    expect((r.body as Buffer).toString()).toBe('abcdef');
    const full = await request(app).get('/assets/v1/data/n/1/sub/n.bin').set('Range', 'bytes=10-15').set('If-Range', '"other"');
    expect(full.status).toBe(200);
  });

  it('416 for an unsatisfiable range', async () => {
    const res = await request(app).get('/assets/v1/data/n/1/sub/n.bin').set('Range', 'bytes=500-600');
    expect(res.status).toBe(416);
  });

  it('serves sidecars as text/plain', async () => {
    const res = await request(app).get('/assets/v1/tts-voice/v1/1/voice.onnx.sha256');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('supports HEAD and rejects other methods with 405', async () => {
    expect((await request(app).head('/assets/v1/index.json')).status).toBe(200);
    const post = await request(app).post('/assets/v1/index.json');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });

  it('404s as JSON (never the SPA shell) for misses, short paths and dotfiles', async () => {
    for (const p of ['/assets/v1/nope/x/1/f.bin', '/assets/v1/tts-voice/v1/1', '/assets/v1', '/assets/v1/data/n/1/.hidden']) {
      const res = await request(app).get(p);
      expect(res.status, p).toBe(404);
      expect(res.headers['content-type'], p).toContain('application/json');
    }
  });

  it('refuses traversal, including encoded forms', async () => {
    // (A literal `..` is normalised away by the HTTP client before it is sent.)
    for (const p of ['/assets/v1/data/n/1/%2e%2e/%2e%2e/%2e%2e/secret.txt', '/assets/v1/data/n/1/%2e%2e%2fsecret.txt']) {
      const res = await request(app).get(p);
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.text).not.toContain('top secret');
    }
    expect((await request(app).get('/assets/v1/data//n/1/sub/n.bin')).status).toBe(404);
  });

  it('lets non-v1 paths fall through to the client bundle handler', async () => {
    const res = await request(app).get('/assets/app-abc.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('client bundle');
  });

  it('404s everywhere when the directory is missing', async () => {
    const a = express();
    a.use('/assets', createAssetRouter(join(root, 'does-not-exist')));
    expect((await request(a).get('/assets/v1/index.json')).status).toBe(404);
  });
});
