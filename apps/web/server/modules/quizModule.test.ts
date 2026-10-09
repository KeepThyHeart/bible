import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverModules } from './serverModules';
import { quizManifest } from './quiz/manifest';
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

describe('quiz server module', () => {
  it('manifest validates, is flagged and is in the table', () => {
    expect(validateBuiltinManifest(quizManifest)).toEqual([]);
    expect(quizManifest.flag).toBe('quiz');
    expect(serverModules.map((m) => m.manifest.id)).toContain('quiz');
    expect(quizManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/api/quiz']);
  });

  it('enabled: /api/quiz registers under moduleId quiz', async () => {
    const { registry } = await freshLoad(() => true);
    expect(registry.listRoutes('quiz').map((r) => r.path)).toEqual(['/api/quiz']);
  });

  it.each([
    ['the feature flag is off', (f: string) => f !== 'quiz', {}],
    ['the module is switched off', () => true, { quiz: false }],
  ])('disabled (%s): the route file is never imported and /api/quiz answers 404 JSON', async (_n, flags, overrides) => {
    const imported = vi.fn();
    vi.doMock('./quiz/routes', () => { imported(); return {}; });
    const { registry, loader } = await freshLoad(flags, overrides);
    expect(imported).not.toHaveBeenCalled();
    expect(registry.getRegisteredRoutes().filter((r) => r.path === '/api/quiz')).toEqual([]);
    expect(loader.listServerModules().find((m) => m.id === 'quiz')).toMatchObject({ enabled: false });

    const app = express();
    const unavailable = await import('./unavailableRoutes');
    app.use(unavailable.createUnavailableRoutes());
    app.get('*', (_req, res) => res.status(200).send('spa'));
    const res = await request(app).get('/api/quiz/questions?range=41001001-41001999').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'quiz' });
    vi.doUnmock('./quiz/routes');
  });
});
