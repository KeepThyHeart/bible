import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverModules } from './serverModules';
import { wordStudyManifest } from './word-study/manifest';
import { clearRouteRegistry } from '../routes/routeRegistry';
import { validateBuiltinManifest } from '../core';

// The route file registers itself on first import: reset the module graph and registry per test.
beforeEach(() => {
  clearRouteRegistry();
  vi.resetModules();
});

async function freshLoad(overrides: Record<string, boolean> = {}) {
  const loader = await import('./loadServerModules');
  const registry = await import('../routes/routeRegistry');
  registry.clearRouteRegistry();
  const handle = await loader.loadServerModules({ flags: { isEnabled: () => true }, overrides: () => overrides });
  return { loader, registry, handle };
}

describe('word-study server module', () => {
  it('manifest validates, is unflagged and is in the table', () => {
    expect(validateBuiltinManifest(wordStudyManifest)).toEqual([]);
    expect(wordStudyManifest.flag).toBeUndefined();
    expect(serverModules.map((m) => m.manifest.id)).toContain('word-study');
    expect(wordStudyManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/api/word-study']);
  });

  it('enabled: /api/word-study registers under moduleId word-study', async () => {
    const { registry } = await freshLoad();
    expect(registry.listRoutes('word-study').map((r) => r.path)).toEqual(['/api/word-study']);
  });

  it('disabled: the route file is never imported and /api/word-study answers 404 JSON and HTML', async () => {
    const imported = vi.fn();
    vi.doMock('./word-study/routes', () => { imported(); return {}; });
    const { registry, loader } = await freshLoad({ 'word-study': false });
    expect(imported).not.toHaveBeenCalled();
    expect(registry.getRegisteredRoutes().filter((r) => r.path === '/api/word-study')).toEqual([]);
    expect(loader.listServerModules().find((m) => m.id === 'word-study')).toMatchObject({ enabled: false });

    const app = express();
    const unavailable = await import('./unavailableRoutes');
    app.use(unavailable.createUnavailableRoutes());
    app.get('*', (_req, res) => res.status(200).send('spa'));
    const json = await request(app).get('/api/word-study/resolve?q=G25').set('Accept', 'application/json');
    expect(json.status).toBe(404);
    expect(json.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'word-study' });
    const html = await request(app).get('/api/word-study/resolve?q=G25').set('Accept', 'text/html');
    expect(html.status).toBe(404);
    expect(html.text).toContain('not available');
    vi.doUnmock('./word-study/routes');
  });
});
