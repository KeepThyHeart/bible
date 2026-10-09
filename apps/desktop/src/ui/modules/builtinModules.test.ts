/**
 * App-level disable test (task 0113): the desktop renderer's real built-in module
 * list, registered through the real host with a dev override switching a module
 * off, the way a developer boots it with `localStorage['kth.modules'] = '-host'`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function boot(override: string) {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('./builtinModules');
  const host = await import('./moduleHost');
  registerBuiltinModules();
  return host;
}

beforeEach(() => window.localStorage.clear());

describe('desktop renderer boot with a module disabled', () => {
  it('registers panels and tiles by default', async () => {
    const { modulePoints } = await boot('');
    expect(modulePoints.panelTypes.list().length).toBeGreaterThan(0);
    expect(modulePoints.newTabTiles.list().length).toBeGreaterThan(0);
  }, 60_000);

  it('drops the disabled module\'s contributions and keeps the other module\'s', async () => {
    const { modulePoints, featureModules } = await boot('-host');
    // genealogy and timeline are their own modules, so they stay when `host` is off
    expect(modulePoints.panelTypes.list().map((p) => p.id)).toEqual(['genealogy', 'timeline']);
    expect(modulePoints.newTabTiles.list().length).toBeGreaterThan(0);
    expect(featureModules.list().find((m) => m.id === 'host')).toMatchObject({ enabled: false, offReason: 'override' });
  }, 60_000);
});
