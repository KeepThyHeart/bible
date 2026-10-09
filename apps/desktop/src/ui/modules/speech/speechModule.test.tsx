/**
 * The Speech module (task 0151) through the real desktop host: gated by the `recite` flag, one
 * preferences section with a lazy view, and no engine code loaded at registration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { speechManifest } from './manifest';

async function boot(flags: string) {
  vi.resetModules();
  window.localStorage.setItem('kth.flags', flags);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const services = await import('../host/hostServices');
  registerBuiltinModules();
  const loadNamespace = vi.fn().mockResolvedValue(undefined);
  host.bindNamespaceLoader(loadNamespace);
  services.bindModuleHostServices({ registry: { register: vi.fn() } as never, i18n: { loadNamespace } });
  return { ...host, loadNamespace };
}

beforeEach(() => window.localStorage.clear());

describe('speech manifest', () => {
  it('validates, is flag-gated and declares the section at order 36', () => {
    expect(validateBuiltinManifest(speechManifest)).toEqual([]);
    expect(speechManifest.flag).toBe('recite');
    expect(speechManifest.activationEvents).toEqual(['onStartupFinished']);
    expect(speechManifest.contributes.preferencesSections).toEqual([
      { id: 'speech', title: { key: 'preferencesDialog.sectionSpeech', fallback: 'Speech' }, order: 36 },
    ]);
  });
});

describe('recite flag', () => {
  it('off by default: no section', async () => {
    const { modulePoints, featureModules } = await boot('');
    expect(modulePoints.preferencesSections.has('speech')).toBe(false);
    expect(featureModules.list().find((m) => m.id === 'speech')).toMatchObject({ enabled: false, offReason: 'flag' });
  }, 120_000);

  it('on: the section and lazy view exist and no module code ran', async () => {
    const { modulePoints, moduleTimings } = await boot('recite');
    expect(modulePoints.preferencesSections.has('speech')).toBe(true);
    expect(modulePoints.i18nNamespace.has('speech')).toBe(true);
    expect(modulePoints.views.resolve('preferences:speech')).toBeTypeOf('function');
    expect(moduleTimings.list()).toEqual([]);
  }, 120_000);
});
