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
    // Only the host's panel types are gone; migrated feature modules keep theirs.
    expect(modulePoints.panelTypes.has('bible')).toBe(false);
    for (const id of ['genealogy', 'timeline', 'reading-plans', 'quiz']) expect(modulePoints.panelTypes.has(id)).toBe(true);
    expect(modulePoints.newTabTiles.list().length).toBeGreaterThan(0);
    expect(featureModules.list().find((m) => m.id === 'host')).toMatchObject({ enabled: false, offReason: 'override' });
  }, 60_000);
});

describe('desktop dev runtime off switch', () => {
  it('window.kthModules.disable removes a module\'s app and commands and enable restores them', async () => {
    vi.resetModules();
    const { registerBuiltinModules } = await import('./builtinModules');
    const host = await import('./moduleHost');
    const { appRegistry } = await import('../apps/appHost');
    registerBuiltinModules();
    expect(appRegistry.has('quiz')).toBe(true);
    const k = (window as unknown as { kthModules: { disable(id: string): void; enable(id: string): void } }).kthModules;
    k.disable('quiz');
    expect(appRegistry.has('quiz')).toBe(false);
    k.enable('quiz');
    expect(appRegistry.has('quiz')).toBe(true);
    expect(host.featureModules.isEnabled('quiz')).toBe(true);
  }, 60_000);
});
