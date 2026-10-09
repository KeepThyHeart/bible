import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { serverModules } from './serverModules';
import { audioManifest } from './audio/manifest';
import { clearRouteRegistry } from '../routes/routeRegistry';
import { validateBuiltinManifest } from '../core';

// The route file registers itself on first import: reset the module graph and registry per test.
beforeEach(() => {
  clearRouteRegistry();
  vi.resetModules();
});

async function freshLoad(flags: (flag: string) => boolean, overrides: Record<string, boolean> = {}) {
  const loader = await import('./loadServerModules');
  const registry = await import('../routes/routeRegistry');
  registry.clearRouteRegistry();
  const handle = await loader.loadServerModules({ flags: { isEnabled: flags }, overrides: () => overrides });
  return { loader, registry, handle };
}

describe('audio server module', () => {
  it('manifest validates, is flagged and is in the table', () => {
    expect(validateBuiltinManifest(audioManifest)).toEqual([]);
    expect(audioManifest.flag).toBe('audio');
    expect(serverModules.map((m) => m.manifest.id)).toContain('audio');
    expect(audioManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/audio']);
  });

  it('enabled: /audio registers under moduleId audio and serves files from the configured directory', async () => {
    const { registry } = await freshLoad(() => true);
    const routes = registry.listRoutes('audio');
    expect(routes.map((r) => r.path)).toEqual(['/audio']);

    const dir = mkdtempSync(join(tmpdir(), 'audio-module-'));
    try {
      mkdirSync(join(dir, 'v1/KJV'), { recursive: true });
      writeFileSync(join(dir, 'v1/KJV/index.json'), '{"module":"KJV"}');
      const app = express();
      app.use('/audio', routes[0].createRoutes({ db: {} as never, siteSettings: null, extra: { audioDir: dir } }));
      const res = await request(app).get('/audio/v1/KJV/index.json');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ module: 'KJV' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['the feature flag is off', (f: string) => f !== 'audio', {}],
    ['the module is switched off', () => true, { audio: false }],
  ])('disabled (%s): the route file is never imported and /audio answers 404 not available', async (_n, flags, overrides) => {
    const imported = vi.fn();
    vi.doMock('./audio/routes', () => { imported(); return {}; });
    const { registry, loader } = await freshLoad(flags, overrides);
    expect(imported).not.toHaveBeenCalled();
    expect(registry.getRegisteredRoutes().filter((r) => r.path === '/audio')).toEqual([]);
    expect(loader.listServerModules().find((m) => m.id === 'audio')).toMatchObject({ enabled: false });

    const app = express();
    const unavailable = await import('./unavailableRoutes');
    app.use(unavailable.createUnavailableRoutes());
    app.get('*', (_req, res) => res.status(200).send('spa'));
    const json = await request(app).get('/audio/v1/KJV/index.json').set('Accept', 'application/json');
    expect(json.status).toBe(404);
    expect(json.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'audio' });
    const html = await request(app).get('/audio/tts/piper/index.json').set('Accept', 'text/html');
    expect(html.status).toBe(404);
    expect(html.text).toContain('not available');
    vi.doUnmock('./audio/routes');
  });
});
