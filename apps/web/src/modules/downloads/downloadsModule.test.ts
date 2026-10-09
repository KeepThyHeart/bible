/**
 * The Downloads module through the REAL web host (task 0128): the Settings "Offline" tab and its
 * lazy view appear with the module on, vanish with it off, and no module code loads at boot.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { downloadsManifest } from './manifest';

async function boot(override = '') {
  vi.resetModules();
  localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  registerBuiltinModules();
  return host;
}

beforeEach(() => {
  localStorage.clear();
});

describe('downloads manifest', () => {
  it('validates and keeps the persisted tab id, order and label key', () => {
    expect(validateBuiltinManifest(downloadsManifest)).toEqual([]);
    expect(downloadsManifest.contributes.preferencesSections).toEqual([
      { id: 'offline', title: { key: 'settings.tabs.offline', fallback: 'Offline' }, icon: { kind: 'builtin', name: 'fa-cloud-arrow-down' }, order: 70 },
    ]);
  });
});

describe('downloads module in the web host', () => {
  it('is on by default: the tab sits between Notifications and Apps, with a lazy view', async () => {
    const h = await boot();
    const ids = h.modulePoints.preferencesSections.list().map((s) => s.id);
    expect(ids).toEqual(['text-size', 'theme', 'modules', 'gestures', 'notifications', 'offline', 'apps', 'about', 'keyword-marks', 'measures']);
    expect(h.modulePoints.views.resolve('preferences:offline')).toBeTypeOf('function');
  });

  it('switched off by the dev override: no tab, no view, other tabs untouched', async () => {
    const h = await boot('-downloads');
    const ids = h.modulePoints.preferencesSections.list().map((s) => s.id);
    expect(ids).toEqual(['text-size', 'theme', 'modules', 'gestures', 'notifications', 'apps', 'about', 'keyword-marks', 'measures']);
    expect(h.modulePoints.views.resolve('preferences:offline')).toBeUndefined();
  });

  it('switching off at runtime removes the tab (reconcile)', async () => {
    const h = await boot();
    expect(h.modulePoints.preferencesSections.has('offline')).toBe(true);
    localStorage.setItem('kth.modules', '-downloads');
    h.reconcileModules();
    expect(h.modulePoints.preferencesSections.has('offline')).toBe(false);
    expect(h.modulePoints.views.resolve('preferences:offline')).toBeUndefined();
  });
});
