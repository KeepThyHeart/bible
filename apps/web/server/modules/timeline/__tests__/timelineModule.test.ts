import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverModules } from '../../serverModules';
import { timelineManifest } from '../manifest';
import { validateBuiltinManifest } from '../../../core';

beforeEach(() => vi.resetModules());

async function freshLoad(flags: { isEnabled(f: string): boolean }, overrides: Record<string, boolean> = {}) {
  const loader = await import('../../loadServerModules');
  const registry = await import('../../../routes/routeRegistry');
  registry.clearRouteRegistry();
  await loader.loadServerModules({ flags: flags as never, overrides: () => overrides });
  return { loader, registry };
}

describe('timeline server module', () => {
  it('manifest validates, is in the table and declares the dataset route', () => {
    expect(validateBuiltinManifest(timelineManifest)).toEqual([]);
    expect(serverModules.map((m) => m.manifest.id)).toContain('timeline');
    expect(timelineManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/api/timeline']);
  });

  it('flag on: /api/timeline registers under moduleId timeline', async () => {
    const { registry } = await freshLoad({ isEnabled: () => true });
    expect(registry.listRoutes('timeline').map((r) => r.path)).toEqual(['/api/timeline']);
  });

  it('flag off (the default): the route file is never imported and the path answers 404 not available', async () => {
    const imported = vi.fn();
    vi.doMock('../timelineRoutes', () => { imported(); return {}; });
    const { registry } = await freshLoad({ isEnabled: (f) => f !== 'timeline' });
    expect(imported).not.toHaveBeenCalled();
    expect(registry.listRoutes('timeline')).toEqual([]);
    const unavailable = await import('../../unavailableRoutes');
    const app = express();
    app.use(unavailable.createUnavailableRoutes());
    const res = await request(app).get('/api/timeline').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'timeline' });
    vi.doUnmock('../timelineRoutes');
  });

  it('dev override -timeline turns it off even with the flag on', async () => {
    const { registry } = await freshLoad({ isEnabled: () => true }, { timeline: false });
    expect(registry.listRoutes('timeline')).toEqual([]);
  });
});
