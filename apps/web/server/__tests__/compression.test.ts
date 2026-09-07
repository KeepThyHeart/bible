import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCompression } from '../middleware/compression';

/**
 * The web server shipped for a long time with no compression at all, so these
 * tests pin down both halves of the behaviour: that ordinary text responses now
 * come back encoded, and that the binaries we deliberately exclude still do not.
 */
function appWith(routes: (app: express.Express) => void): express.Express {
  const app = express();
  app.use(createCompression());
  routes(app);
  return app;
}

/** A body long enough to clear `compression`'s default 1 KB threshold. */
const BIG_JSON = { verses: Array.from({ length: 200 }, (_, i) => ({ verse_id: i, text: 'For God so loved the world '.repeat(4) })) };

describe('response compression', () => {
  it('gzips a JSON API response', async () => {
    const app = appWith(a => a.get('/api/bible/kjv/43/3', (_req, res) => { res.json(BIG_JSON); }));

    const res = await request(app).get('/api/bible/kjv/43/3').set('Accept-Encoding', 'gzip');

    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('materially shrinks a chapter-sized payload', async () => {
    // supertest transparently gunzips and offers no way off that path, so this
    // one goes over a real socket and counts the bytes as they arrive.
    const app = appWith(a => a.get('/big', (_req, res) => { res.json(BIG_JSON); }));
    const raw = Buffer.byteLength(JSON.stringify(BIG_JSON));

    const server = await new Promise<Server>((resolveServer) => {
      const s = app.listen(0, () => resolveServer(s));
    });
    const { port } = server.address() as AddressInfo;

    try {
      const { encoding, bytes } = await new Promise<{ encoding?: string; bytes: number }>((resolveGet, rejectGet) => {
        http.get(
          { host: '127.0.0.1', port, path: '/big', headers: { 'Accept-Encoding': 'gzip' } },
          (res) => {
            let bytes = 0;
            res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
            res.on('end', () => resolveGet({ encoding: res.headers['content-encoding'], bytes }));
          },
        ).on('error', rejectGet);
      });

      expect(encoding).toBe('gzip');
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThan(raw / 2);
    } finally {
      server.close();
    }
  });

  it('gzips HTML and CSS', async () => {
    const app = appWith(a => {
      a.get('/index.html', (_req, res) => { res.type('html').send('<div>hello</div>'.repeat(200)); });
      a.get('/index.css', (_req, res) => { res.type('css').send('.a { color: red; }'.repeat(200)); });
    });

    const html = await request(app).get('/index.html').set('Accept-Encoding', 'gzip');
    const css = await request(app).get('/index.css').set('Accept-Encoding', 'gzip');

    expect(html.headers['content-encoding']).toBe('gzip');
    expect(css.headers['content-encoding']).toBe('gzip');
  });

  it('does NOT compress the ONNX runtime wasm', async () => {
    // ~21 MB, fetched about once per client and then held by an immutable cache
    // header. Compressing it per cold request costs more CPU than it saves.
    const app = appWith(a => a.get('/ort.wasm', (_req, res) => {
      res.type('application/wasm').send(Buffer.alloc(64 * 1024, 1));
    }));

    const res = await request(app).get('/ort.wasm').set('Accept-Encoding', 'gzip');

    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('does NOT compress octet-stream embedding vectors served under /data', async () => {
    // `compressible` answers true for application/octet-stream, so the default
    // filter would gzip the ~180 MB int8 vector files on every cold request.
    const app = appWith(a => a.get('/data/vectors.bin', (_req, res) => {
      res.type('application/octet-stream').send(Buffer.alloc(64 * 1024, 2));
    }));

    const res = await request(app).get('/data/vectors.bin').set('Accept-Encoding', 'gzip');

    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('honours the x-no-compression opt-out', async () => {
    const app = appWith(a => a.get('/big', (_req, res) => { res.json(BIG_JSON); }));

    const res = await request(app)
      .get('/big')
      .set('Accept-Encoding', 'gzip')
      .set('x-no-compression', '1');

    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('leaves the body intact and parseable', async () => {
    const app = appWith(a => a.get('/big', (_req, res) => { res.json(BIG_JSON); }));

    const res = await request(app).get('/big').set('Accept-Encoding', 'gzip');

    expect(res.body.verses).toHaveLength(200);
    expect(res.body.verses[0].text).toContain('For God so loved the world');
  });
});
