import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Router } from 'express';
import { getRegisteredRoutes } from '../routes/routeRegistry';
import '../modules/present/presentPages';
import '../modules/games/gamesPages';

const PAGE = '<html><head><link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"></head><body>x</body></html>';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pages-'));
  for (const [sub, name] of [['present', 'viewer.html'], ['present', 'solo.html'], ['present', 'watch.html'], ['games', 'play.html']]) {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, name), PAGE);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function appFor(pwa: boolean) {
  const app = express();
  for (const route of getRegisteredRoutes()) {
    if (!['/present', '/watch', '/games'].includes(route.path)) continue;
    const router = route.createRoutes({ extra: { clientDir: dir, pwaEnabled: () => pwa } } as never) as Router;
    app.use(route.path, router);
  }
  return app;
}

const URLS = ['/present/v/ABC', '/present/solo', '/watch', '/games/play', '/games/play/XYZ'];

describe('Presenter and games pages and the PWA manifest link', () => {
  for (const url of URLS) {
    it(`${url} has no manifest link when the PWA is off (it would be a 404)`, async () => {
      const res = await request(appFor(false)).get(url);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('rel="manifest"');
    });
    it(`${url} keeps it when the PWA is on`, async () => {
      const res = await request(appFor(true)).get(url);
      expect(res.text).toContain('rel="manifest"');
    });
  }
});
