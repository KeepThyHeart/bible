/**
 * App-level disable test (task 0113): the web app's real built-in module list,
 * registered through the real host with a dev override switching modules off,
 * the way a developer boots it with `localStorage['kth.modules'] = '-host-panes'`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolvePhoneView } from './host/panes';

async function boot(override: string) {
  vi.resetModules();
  localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('./builtinModules');
  const host = await import('./moduleHost');
  registerBuiltinModules();
  return host;
}

beforeEach(() => localStorage.clear());

describe('web app boot with a module disabled', () => {
  it('boots with every built-in module on by default', async () => {
    const { modulePoints, featureModules } = await boot('');
    expect(modulePoints.paneModes.list().map((p) => p.id)).toContain('study');
    expect(featureModules.list().every((m) => m.enabled || m.offReason)).toBe(true);
  });

  it('drops the disabled module\'s panes and phone views and keeps the rest', async () => {
    const { modulePoints, featureModules } = await boot('-host-panes');
    expect(modulePoints.paneModes.list()).toEqual([]);
    expect(modulePoints.newTabTiles.list().length).toBeGreaterThan(0); // host-ui is unaffected
    expect(featureModules.list().find((m) => m.id === 'host-panes')).toMatchObject({ enabled: false, offReason: 'override' });
    // The phone shell then has no study/commentary view: it lands on the reader, not on a blank screen.
    const phoneViews = new Set(modulePoints.paneModes.list().filter((p) => p.phoneView).map((p) => p.id));
    expect(resolvePhoneView('commentary', phoneViews)).toBe('bible');
  });
});
