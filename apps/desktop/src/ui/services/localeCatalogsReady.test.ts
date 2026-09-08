import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The signal is a module-level singleton with no reset - deliberately, since a
 * renderer loads catalogs exactly once. So each test re-imports the module
 * fresh via `vi.resetModules()` to get an unresolved instance.
 */
async function freshModule() {
  vi.resetModules();
  return import('./localeCatalogsReady');
}

describe('localeCatalogsReady', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts unready', async () => {
    const mod = await freshModule();
    expect(mod.areLocaleCatalogsReady()).toBe(false);
  });

  it('does not resolve before the marker is called', async () => {
    const mod = await freshModule();
    let resolved = false;
    void mod.whenLocaleCatalogsReady().then(() => {
      resolved = true;
    });
    // Two microtask turns is enough for an already-resolved promise to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  it('resolves waiters registered before the marker', async () => {
    const mod = await freshModule();
    const waiter = mod.whenLocaleCatalogsReady();
    mod.markLocaleCatalogsReady();
    await expect(waiter).resolves.toBeUndefined();
    expect(mod.areLocaleCatalogsReady()).toBe(true);
  });

  it('resolves immediately for waiters that arrive after the marker', async () => {
    const mod = await freshModule();
    mod.markLocaleCatalogsReady();
    await expect(mod.whenLocaleCatalogsReady()).resolves.toBeUndefined();
  });

  it('is idempotent', async () => {
    const mod = await freshModule();
    mod.markLocaleCatalogsReady();
    mod.markLocaleCatalogsReady();
    expect(mod.areLocaleCatalogsReady()).toBe(true);
    await expect(mod.whenLocaleCatalogsReady()).resolves.toBeUndefined();
  });

  it('hands every waiter the same promise', async () => {
    const mod = await freshModule();
    expect(mod.whenLocaleCatalogsReady()).toBe(mod.whenLocaleCatalogsReady());
  });
});
