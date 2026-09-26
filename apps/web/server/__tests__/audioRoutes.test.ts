import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createAudioRouter } from '../routes/audioRoutes';
import { contentSecurityPolicyDirectives } from '../cspDirectives';

let root: string;
let app: express.Express;

const AUDIO = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

function put(rel: string, body: Buffer | string) {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'audio-routes-'));
  put('v1/KJV/index.json', '{"schema":"kth-audio-index/1","module":"KJV","narrators":[]}');
  put('v1/KJV/n1/1/43/003.json', '{}');
  put('v1/KJV/n1/1/43/003.ogg', AUDIO);
  put('v1/KJV/n1/1/43/003.mp3', AUDIO);
  put('tts/piper/voice.onnx', 'model');
  put('tts/piper/runtime.wasm', 'wasm');
  put('secret.txt', 'top secret');
  put('v1/.hidden', 'nope');
  app = express();
  app.use('/audio', createAudioRouter(root));
  // What the real server has after it: the SPA catch-all.
  app.get('*', (_req, res) => { res.type('html').send('<!doctype html>SPA'); });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('audio routes', () => {
  it('serves a chapter file with an audio type, immutable caching and range support', async () => {
    const res = await request(app).get('/audio/v1/KJV/n1/1/43/003.ogg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/ogg');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('answers a Range request with 206 and the requested bytes', async () => {
    const res = await request(app).get('/audio/v1/KJV/n1/1/43/003.ogg').set('Range', 'bytes=10-15').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 10-15/36');
    expect((res.body as Buffer).toString()).toBe('abcdef');
  });

  it('serves mp3, manifests and the index, with a short cache only for the index', async () => {
    expect((await request(app).get('/audio/v1/KJV/n1/1/43/003.mp3')).headers['content-type']).toContain('audio/mpeg');
    const manifest = await request(app).get('/audio/v1/KJV/n1/1/43/003.json');
    expect(manifest.status).toBe(200);
    expect(manifest.headers['cache-control']).toContain('immutable');
    const index = await request(app).get('/audio/v1/KJV/index.json');
    expect(index.status).toBe(200);
    expect(index.headers['cache-control']).toBe('public, max-age=300');
  });

  it('serves engine files from tts/ without the immutable year', async () => {
    const res = await request(app).get('/audio/tts/piper/voice.onnx');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=604800');
  });

  it('answers 404 JSON, never the SPA shell, for missing files and translations', async () => {
    for (const url of ['/audio/v1/WEB/index.json', '/audio/v1/KJV/n1/1/43/999.ogg', '/audio/v1/KJV/n1/1/43/']) {
      const res = await request(app).get(url).set('Accept', 'text/html');
      expect(res.status, url).toBe(404);
      expect(res.text, url).not.toContain('SPA');
    }
  });

  it('serves nothing outside v1/ and tts/', async () => {
    expect((await request(app).get('/audio/secret.txt')).status).toBe(404);
    expect((await request(app).get('/audio/')).status).toBe(404);
  });

  it('refuses traversal and dotfiles, including encoded forms', async () => {
    for (const url of [
      '/audio/v1/../secret.txt',
      '/audio/v1/%2e%2e/secret.txt',
      '/audio/v1/KJV/..%2f..%2fsecret.txt',
      '/audio/tts/%2E%2E/secret.txt',
      '/audio/v1/.hidden',
      '/audio/v1/KJV/%2ehidden',
    ]) {
      const res = await request(app).get(url).set('Accept', 'text/html');
      expect([400, 404], url).toContain(res.status);
      expect(res.text, url).not.toContain('top secret');
    }
  });

  it('rejects malformed escapes with 400 and non-GET methods with 405', async () => {
    expect((await request(app).get('/audio/v1/%E0%A4%A')).status).toBe(400);
    const post = await request(app).post('/audio/v1/KJV/index.json');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });

  it('allows HEAD', async () => {
    expect((await request(app).head('/audio/v1/KJV/index.json')).status).toBe(200);
  });
});

describe('content security policy', () => {
  const header = async (opts?: Parameters<typeof contentSecurityPolicyDirectives>[0]) => {
    const a = express();
    a.use(helmet({ contentSecurityPolicy: { directives: contentSecurityPolicyDirectives(opts) } }));
    a.get('/', (_req, res) => { res.send('ok'); });
    return (await request(a).get('/')).headers['content-security-policy'] as string;
  };

  it('is exactly the strict default policy when audio is off, whatever origins are configured', async () => {
    const off = await header();
    expect(off).not.toContain('media-src');
    expect(off).not.toContain('blob:');
    expect(off).toContain("connect-src 'self'");
    expect(await header({ enabled: false, externalOrigins: ['https://audio.example.com'] })).toBe(off);
  });

  it('with audio on and same-origin files, only adds blob: for media', async () => {
    const on = await header({ enabled: true, externalOrigins: [] });
    expect(on).toContain("media-src 'self' blob:");
    expect(on).toContain("connect-src 'self';");
    expect(on).not.toContain('http');
  });

  it('adds only the configured origins to media-src and connect-src', async () => {
    const on = await header({ enabled: true, externalOrigins: ['https://audio.example.com'] });
    expect(on).toContain("media-src 'self' blob: https://audio.example.com");
    expect(on).toContain("connect-src 'self' https://audio.example.com");
    expect(on).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(on).toContain("default-src 'self'");
  });
});
