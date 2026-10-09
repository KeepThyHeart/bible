import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerseHoverMount } from '../middleware/verseHoverMount';
import { createCompression } from '../middleware/compression';
import { createPasswordGate, hashPassword } from '../middleware/passwordGate';

let root: string;
let distDir: string;
let dataDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'vh-mount-'));
  distDir = join(root, 'dist');
  dataDir = join(root, 'vh-data');
  mkdirSync(join(distDir, 'locales'), { recursive: true });
  mkdirSync(join(dataDir, 'KJV', 'john'), { recursive: true });
  writeFileSync(join(distDir, 'verse-hover.min.js'), 'window.vh=1;');
  writeFileSync(join(distDir, 'verse-hover-1.2.3.min.js'), 'window.vh=2;');
  writeFileSync(join(distDir, 'verse-hover.css'), '.vh{}');
  writeFileSync(join(distDir, 'locales', 'es.js'), 'x');
  writeFileSync(join(distDir, '.secret'), 'nope');
  writeFileSync(join(root, 'package.json'), '{"secret":true}');
  const big = JSON.stringify({ verses: Array.from({ length: 300 }, (_, i) => ({ i, t: 'For God so loved the world' })) });
  writeFileSync(join(dataDir, 'KJV', 'manifest.json'), big);
  writeFileSync(join(dataDir, 'KJV', 'john', '3.json'), big);
  writeFileSync(join(dataDir, 'KJV', 'john', '3.json.gz'), gzipSync(big));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function build(opts: { public?: boolean; password?: boolean } = {}) {
  const app = express();
  app.use(createCompression());
  app.use(helmet({ hsts: false }));
  const mount = createVerseHoverMount({ distDir, dataDir });
  if (mount && opts.public) app.use('/vh', mount);
  if (opts.password) app.use(createPasswordGate({ passwordHash: hashPassword('pw') }));
  if (mount && !opts.public) app.use('/vh', mount);
  app.get('*', (_req, res) => { res.send('spa'); });
  return app;
}

describe('verse-hover /vh mount', () => {
  it('serves files with CORS, CORP override, nosniff and day-long caching', async () => {
    const res = await request(build()).get('/vh/verse-hover.min.js');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('serves css and locale files', async () => {
    const app = build();
    expect((await request(app).get('/vh/verse-hover.css')).status).toBe(200);
    expect((await request(app).get('/vh/locales/es.js')).status).toBe(200);
  });

  it('marks semver-named files immutable', async () => {
    const res = await request(build()).get('/vh/verse-hover-1.2.3.min.js');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('answers OPTIONS with 204 and CORS headers', async () => {
    const res = await request(build()).options('/vh/verse-hover.min.js');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('rejects POST with 405', async () => {
    const res = await request(build()).post('/vh/verse-hover.min.js');
    expect(res.status).toBe(405);
  });

  it('404s a missing file, a directory and a dotfile instead of falling to the SPA', async () => {
    const app = build();
    for (const p of ['/vh/missing.js', '/vh/locales', '/vh/locales/', '/vh/.secret']) {
      const res = await request(app).get(p);
      expect(res.status, p).toBe(404);
      expect(res.text).not.toBe('spa');
    }
  });

  it('does not allow directory traversal', async () => {
    const app = build();
    for (const p of ['/vh/..%2f..%2fpackage.json', '/vh/..%2fpackage.json', '/vh/%2e%2e/package.json', '/vh/data/..%2f..%2fpackage.json']) {
      const res = await request(app).get(p);
      // A client may normalise `%2e%2e` away so the request never reaches /vh (and
      // lands on the SPA stub); either way the file outside dist must not leak.
      expect(res.text, p).not.toContain('secret');
      if (!p.includes('%2e')) expect(res.status, p).toBeGreaterThanOrEqual(400);
    }
  });

  it('serves data json and json.gz with the right types', async () => {
    const app = build();
    const json = await request(app).get('/vh/data/KJV/manifest.json');
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toMatch(/^application\/json/);
    const gz = await request(app).get('/vh/data/KJV/john/3.json.gz').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(gz.status).toBe(200);
    expect(gz.headers['content-type']).toMatch(/^application\/gzip/);
    expect(gz.headers['content-encoding']).toBeUndefined();
    const body = gz.body as Buffer;
    expect(body[0]).toBe(0x1f);
    expect(body[1]).toBe(0x8b);
  });

  it('compresses .json but not .json.gz', async () => {
    const app = build();
    const json = await request(app).get('/vh/data/KJV/john/3.json').set('Accept-Encoding', 'gzip');
    expect(json.headers['content-encoding']).toBe('gzip');
    const gz = await request(app).get('/vh/data/KJV/john/3.json.gz').set('Accept-Encoding', 'gzip');
    expect(gz.headers['content-encoding']).toBeUndefined();
  });

  it('is skipped when dist is missing', () => {
    expect(createVerseHoverMount({ distDir: join(root, 'nope'), dataDir })).toBeNull();
  });

  describe('password gate', () => {
    it('is gated like any other path when not public', async () => {
      const res = await request(build({ password: true })).get('/vh/data/KJV/manifest.json');
      expect(res.status).toBe(401);
    });

    it('bypasses the gate when public', async () => {
      const res = await request(build({ password: true, public: true })).get('/vh/data/KJV/manifest.json');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('still gates the rest of the site when /vh is public', async () => {
      const res = await request(build({ password: true, public: true })).get('/bible').set('Accept', 'application/json');
      expect(res.status).toBe(401);
    });
  });
});
