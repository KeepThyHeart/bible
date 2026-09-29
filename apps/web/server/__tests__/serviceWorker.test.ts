import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServiceWorkerRoutes, pwaShell } from '../middleware/serviceWorker';

let dir: string;
let pwa: boolean;

function appFor() {
  const app = express();
  app.use(createServiceWorkerRoutes({ clientDir: dir, isPwaEnabled: () => pwa }));
  app.use(express.static(dir, { index: false }));
  return app;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-routes-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sw.js'), '/* REAL WORKER */');
  writeFileSync(join(dir, 'sw-kill.js'), '/* KILL WORKER */');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"x"}');
  pwa = true;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('service worker routes', () => {
  it('serves the real worker at /sw.js when features.pwa is on, never cached', async () => {
    const res = await request(appFor()).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('REAL WORKER');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toMatch(/javascript/);
  });

  it('serves the kill switch at /sw.js when features.pwa is off, never cached', async () => {
    pwa = false;
    const res = await request(appFor()).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('KILL WORKER');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('follows the flag per request', async () => {
    const app = appFor();
    expect((await request(app).get('/sw.js')).text).toContain('REAL');
    pwa = false;
    expect((await request(app).get('/sw.js')).text).toContain('KILL');
  });

  it('serves /sw-kill.js regardless of the flag', async () => {
    for (const flag of [true, false]) {
      pwa = flag;
      const res = await request(appFor()).get('/sw-kill.js');
      expect(res.text).toContain('KILL WORKER');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('withholds the manifest when the PWA is off', async () => {
    expect((await request(appFor()).get('/manifest.webmanifest')).status).toBe(200);
    pwa = false;
    expect((await request(appFor()).get('/manifest.webmanifest')).status).toBe(404);
  });

  it('falls through when a worker file is missing (no client build)', async () => {
    rmSync(join(dir, 'sw.js'));
    expect((await request(appFor()).get('/sw.js')).status).toBe(404);
  });
});

describe('pwaShell', () => {
  const html = '<head><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><title>x</title></head>';

  it('keeps the manifest link when the PWA is on', () => {
    expect(pwaShell(html, true)).toBe(html);
  });

  it('strips the manifest link (only) when the PWA is off', () => {
    expect(pwaShell(html, false)).toBe('<head><title>x</title></head>');
  });
});
