/**
 * The Downloads module (task 0128) through the real desktop host: the "Downloads & storage"
 * preferences section exists after boot without loading module code, activates (and loads its
 * strings) when the section is shown, and is gone with the off switch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { downloadsManifest } from './manifest';

async function boot(override: string) {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const services = await import('../host/hostServices');
  registerBuiltinModules();
  const loadNamespace = vi.fn().mockResolvedValue(undefined);
  host.bindNamespaceLoader(loadNamespace);
  services.bindModuleHostServices({ registry: { register: vi.fn() } as never, i18n: { loadNamespace } });
  return { ...host, loadNamespace };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('downloads manifest', () => {
  it('validates and keeps the old section id, order and label key', () => {
    expect(validateBuiltinManifest(downloadsManifest)).toEqual([]);
    expect(downloadsManifest.platforms).toEqual(['desktop']);
    expect(downloadsManifest.contributes.preferencesSections).toEqual([
      { id: 'downloads', title: { key: 'preferencesDialog.sectionDownloads', fallback: 'Downloads & storage' }, icon: { kind: 'builtin', name: 'downloads' }, order: 35 },
    ]);
    expect(downloadsManifest.contributes.i18nNamespace).toBe('downloads');
  });
});

describe('on by default', () => {
  it('keeps the section between Notifications and Extensions, with a lazy view and no code loaded', async () => {
    const { modulePoints, moduleTimings } = await boot('');
    const ids = modulePoints.preferencesSections.list().map((s) => s.id);
    expect(ids).toEqual(['general', 'typography', 'fonts', 'themes', 'privacy', 'notifications', 'downloads', 'extensions', 'apps', 'measures', 'advanced', 'keyword-marks', 'diagnostics']);
    expect(modulePoints.i18nNamespace.has('downloads')).toBe(true);
    expect(modulePoints.views.resolve('preferences:downloads')).toBeTypeOf('function');
    expect(moduleTimings.list()).toEqual([]);
  }, 60_000);

  it('showing the section activates the module and loads its namespace', async () => {
    const { featureModules, loadNamespace } = await boot('');
    await featureModules.fire('onView:preferences.downloads');
    expect(loadNamespace).toHaveBeenCalledWith('downloads');
  }, 60_000);
});

describe('off switch', () => {
  it('-downloads removes the section, view and namespace; the other sections stay', async () => {
    const { modulePoints, featureModules, loadNamespace } = await boot('-downloads');
    expect(modulePoints.preferencesSections.has('downloads')).toBe(false);
    expect(modulePoints.i18nNamespace.has('downloads')).toBe(false);
    expect(modulePoints.views.resolve('preferences:downloads')).toBeUndefined();
    await featureModules.fire('onView:preferences.downloads');
    expect(loadNamespace).not.toHaveBeenCalled();
    expect(modulePoints.preferencesSections.has('notifications')).toBe(true);
    expect(modulePoints.preferencesSections.has('extensions')).toBe(true);
  }, 60_000);

  it('switching off at runtime removes the section (reconcile)', async () => {
    const { modulePoints, reconcileModules } = await boot('');
    expect(modulePoints.preferencesSections.has('downloads')).toBe(true);
    window.localStorage.setItem('kth.modules', '-downloads');
    reconcileModules();
    expect(modulePoints.preferencesSections.has('downloads')).toBe(false);
  }, 60_000);
});
