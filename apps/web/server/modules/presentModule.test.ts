import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadServerModules, listServerModules } from './loadServerModules';
import { serverModules } from './serverModules';
import { presentManifest } from './present/manifest';
import { createUnavailableRoutes } from './unavailableRoutes';
import { clearRouteRegistry, getRegisteredRoutes, getRegisteredBodyParsers, listRoutes } from '../routes/routeRegistry';
import { validateBuiltinManifest } from '../core';

const flags = { isEnabled: () => true };

// Spies on the route files' side effects: module-level registration runs on first import only,
// so each test resets the module graph and clears the registry.
beforeEach(() => {
  clearRouteRegistry();
  vi.resetModules();
});

async function freshLoad(overrides: Record<string, boolean>) {
  const loader = await import('./loadServerModules');
  const registry = await import('../routes/routeRegistry');
  registry.clearRouteRegistry();
  const handle = await loader.loadServerModules({ flags, overrides: () => overrides });
  return { loader, registry, handle };
}

describe('present server module', () => {
  it('manifest validates and the table has present', () => {
    expect(validateBuiltinManifest(presentManifest)).toEqual([]);
    expect(serverModules.map((m) => m.manifest.id)).toContain('present');
    expect(presentManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual([
      '/api/present', '/api/hymns', '/present', '/watch',
    ]);
  });

  it('enabled: routes, pages and the notes body parser register under moduleId present', async () => {
    const { registry } = await freshLoad({});
    const paths = registry.listRoutes('present').map((r) => r.path).sort();
    expect(paths).toEqual(['/api/hymns', '/api/present', '/present', '/watch']);
    expect(registry.getRegisteredBodyParsers()).toEqual([
      { path: '/api/present/s/:sessionId/notes', limit: '300kb', moduleId: 'present' },
    ]);
  });

  it('disabled: no presenter file is imported and nothing is registered', async () => {
    const imported = vi.fn();
    vi.doMock('./present/presentRoutes', () => { imported('presentRoutes'); return {}; });
    vi.doMock('./present/hymnRoutes', () => { imported('hymnRoutes'); return {}; });
    vi.doMock('./present/presentPages', () => { imported('presentPages'); return {}; });
    const { registry, loader } = await freshLoad({ present: false });
    expect(imported).not.toHaveBeenCalled();
    expect(registry.getRegisteredRoutes().filter((r) => r.path.startsWith('/api/present') || r.path.startsWith('/api/hymns'))).toEqual([]);
    expect(registry.getRegisteredRoutes()).toEqual([]);
    expect(registry.getRegisteredBodyParsers()).toEqual([]);
    expect(loader.listServerModules().find((m) => m.id === 'present')).toMatchObject({ enabled: false });
    vi.doUnmock('./present/presentRoutes');
    vi.doUnmock('./present/hymnRoutes');
    vi.doUnmock('./present/presentPages');
  });

  it('disabled: declared paths answer FEATURE_UNAVAILABLE (JSON for API, HTML for navigation)', async () => {
    const { loader } = await freshLoad({ present: false });
    const unavailable = await import('./unavailableRoutes');
    const app = express();
    app.use(unavailable.createUnavailableRoutes());
    app.get('*', (_req, res) => res.status(200).send('spa'));

    const api = await request(app).get('/api/present/j/ABCD2345/stream').set('Accept', 'text/event-stream');
    expect(api.status).toBe(404);
    expect(api.body).toEqual({
      error: { code: 'FEATURE_UNAVAILABLE', message: 'This feature is not available on this server.', feature: 'present' },
    });
    const hymns = await request(app).get('/api/hymns/search?q=x').set('Accept', 'application/json');
    expect(hymns.status).toBe(404);
    expect(hymns.body.error.code).toBe('FEATURE_UNAVAILABLE');

    for (const url of ['/present/v/ABCD2345', '/watch', '/present/f/ABCD2345']) {
      const page = await request(app).get(url).set('Accept', 'text/html');
      expect(page.status).toBe(404);
      expect(page.headers['content-type']).toMatch(/html/);
      expect(page.text).toContain('This feature is not available on this server.');
    }
    expect((await request(app).get('/other').set('Accept', 'text/html')).text).toBe('spa');
    expect(loader.listServerModules()[0].enabled).toBe(false);
  });

  describe('pages (enabled)', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'present-pages-'));
      mkdirSync(join(dir, 'present'));
      writeFileSync(join(dir, 'present', 'viewer.html'), '<p>viewer</p>');
      writeFileSync(join(dir, 'present', 'watch.html'), '<p>watch</p>');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('serves viewer and watch no-store, solo reports not built, nothing without clientDir', async () => {
      const { registry } = await freshLoad({});
      const build = (clientDir?: string) => {
        const app = express();
        for (const reg of registry.getRegisteredRoutes().filter((r) => r.path === '/present' || r.path === '/watch')) {
          app.use(reg.path, reg.createRoutes({ db: {} as never, siteSettings: null, extra: { clientDir } }));
        }
        return app;
      };
      const app = build(dir);
      const viewer = await request(app).get('/present/v/ABCD2345');
      expect(viewer.status).toBe(200);
      expect(viewer.headers['cache-control']).toBe('no-store');
      expect(viewer.text).toBe('<p>viewer</p>');
      expect((await request(app).get('/watch')).text).toBe('<p>watch</p>');
      const solo = await request(app).get('/present/solo');
      expect(solo.status).toBe(404);
      expect(solo.body).toEqual({ error: 'The solo viewer is not built' });
      expect((await request(build(undefined)).get('/watch')).status).toBe(404);
    });
  });
});
