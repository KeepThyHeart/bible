import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadServerModules, listServerModules } from './loadServerModules';
import type { ServerModuleEntry } from './serverModules';
import { registerRoute, listRoutes, clearRouteRegistry, getRegisteredRoutes, unregisterRoutesByModule } from '../routes/routeRegistry';
import { validateBuiltinManifest } from '../core';
import type { FeatureModuleManifest } from '../core';
import { Router } from 'express';

function manifest(id: string, extra: Partial<FeatureModuleManifest> = {}): FeatureModuleManifest {
  return {
    id,
    title: id,
    activationEvents: ['onStartupFinished'],
    contributes: { serverRoutes: [{ id: `${id}-routes`, path: `/api/${id}` }] },
    ...extra,
  } as FeatureModuleManifest;
}

function entry(m: FeatureModuleManifest) {
  const load = vi.fn(async () => {
    registerRoute({ path: `/api/${m.id}`, createRoutes: () => Router() });
  });
  return { manifest: m, load } satisfies ServerModuleEntry;
}

const flagsOn = { isEnabled: () => true };
const flagsOff = { isEnabled: () => false };

beforeEach(() => clearRouteRegistry());

describe('loadServerModules', () => {
  it('manifest validates', () => {
    expect(validateBuiltinManifest(manifest('quiz', { flag: 'quiz' } as Partial<FeatureModuleManifest>))).toEqual([]);
  });

  it('empty table changes nothing', async () => {
    await loadServerModules({ flags: flagsOn, overrides: () => ({}), modules: [] });
    expect(getRegisteredRoutes()).toEqual([]);
  });

  it('enabled: loads once and tags the route', async () => {
    const e = entry(manifest('alpha'));
    await loadServerModules({ flags: flagsOn, overrides: () => ({}), modules: [e] });
    expect(e.load).toHaveBeenCalledTimes(1);
    expect(listRoutes('alpha').map((r) => r.path)).toEqual(['/api/alpha']);
    expect(listServerModules()[0]).toMatchObject({ id: 'alpha', enabled: true, active: true, routes: ['/api/alpha'] });
    expect(unregisterRoutesByModule('alpha')).toBe(1);
    expect(listRoutes()).toEqual([]);
  });

  it('disabled by flag: never loaded', async () => {
    const e = entry(manifest('beta', { flag: 'quiz' } as Partial<FeatureModuleManifest>));
    await loadServerModules({ flags: flagsOff, overrides: () => ({}), modules: [e] });
    expect(e.load).not.toHaveBeenCalled();
    expect(listRoutes()).toEqual([]);
    expect(listServerModules()[0].offReason).toBe('flag');
  });

  it('disabled by BIBLE_MODULES override: never loaded', async () => {
    const e = entry(manifest('gamma'));
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BIBLE_MODULES', '-gamma');
    try {
      await loadServerModules({ flags: flagsOn, modules: [e] });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(e.load).not.toHaveBeenCalled();
    expect(listRoutes()).toEqual([]);
  });

  it('override env is ignored in production', async () => {
    const e = entry(manifest('delta'));
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BIBLE_MODULES', '-delta');
    try {
      await loadServerModules({ flags: flagsOn, modules: [e] });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(e.load).toHaveBeenCalledTimes(1);
  });

  it('requires chain: B off when A is off', async () => {
    const a = entry(manifest('a', { flag: 'quiz' } as Partial<FeatureModuleManifest>));
    const b = entry(manifest('b', { requires: ['a'] } as Partial<FeatureModuleManifest>));
    await loadServerModules({ flags: flagsOff, overrides: () => ({}), modules: [a, b] });
    expect(a.load).not.toHaveBeenCalled();
    expect(b.load).not.toHaveBeenCalled();
    expect(listRoutes()).toEqual([]);
    expect(listServerModules().find((m) => m.id === 'b')?.offReason).toBe('requires');
  });

  it('reconcile drops routes of newly disabled modules', async () => {
    const e = entry(manifest('eps'));
    let on = true;
    const handle = await loadServerModules({ flags: flagsOn, overrides: (): Record<string, boolean> => (on ? {} : { eps: false }), modules: [e] });
    expect(listRoutes('eps')).toHaveLength(1);
    on = false;
    handle.reconcile();
    expect(listRoutes('eps')).toHaveLength(0);
  });
});
