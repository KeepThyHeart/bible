import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverModules } from '../../serverModules';
import { xrefGraphManifest } from '../manifest';
import { validateBuiltinManifest } from '../../../core';

beforeEach(() => vi.resetModules());

async function freshLoad(overrides: Record<string, boolean> = {}) {
  const loader = await import('../../loadServerModules');
  const registry = await import('../../../routes/routeRegistry');
  registry.clearRouteRegistry();
  await loader.loadServerModules({ flags: { isEnabled: () => true } as never, overrides: () => overrides });
  return { loader, registry };
}

describe('xref-graph server module', () => {
  it('manifest validates, is in the table and declares the graph route', () => {
    expect(validateBuiltinManifest(xrefGraphManifest)).toEqual([]);
    expect(xrefGraphManifest.id).toBe('xref-graph');
    expect(serverModules.map((m) => m.manifest.id)).toContain('xref-graph');
    expect(xrefGraphManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/api/xref-graph']);
  });

  it('on by default: /api/xref-graph registers under moduleId xref-graph', async () => {
    const { registry } = await freshLoad();
    expect(registry.listRoutes('xref-graph').map((r) => r.path)).toEqual(['/api/xref-graph']);
  });

  it('switched off: the route file is never imported and the path answers 404 not available', async () => {
    const imported = vi.fn();
    vi.doMock('../routes', () => { imported(); return {}; });
    const { registry } = await freshLoad({ 'xref-graph': false });
    expect(imported).not.toHaveBeenCalled();
    expect(registry.listRoutes('xref-graph')).toEqual([]);
    const unavailable = await import('../../unavailableRoutes');
    const app = express();
    app.use(unavailable.createUnavailableRoutes());
    const res = await request(app).get('/api/xref-graph/sources').set('Accept', 'application/json');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', feature: 'xref-graph' });
    vi.doUnmock('../routes');
  });
});
