/**
 * The Notifications module through the REAL web host (task 0128): its Settings tab and namespace,
 * the off switch, the boot probe and activation (which start the web reminders).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { notificationsManifest } from './manifest';

const start = vi.fn(async () => {});
const stop = vi.fn();
const setFetcher = vi.fn();

vi.mock('../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../i18n')>()),
  loadNamespace: async () => {},
}));

async function boot(opts: { override?: string; notification?: boolean } = {}) {
  vi.resetModules();
  vi.doMock('./webReminders', () => ({
    startWebReminders: start,
    getWebReminders: () => ({ stop }),
    setVerseOfTheDayFetcher: setFetcher,
  }));
  localStorage.setItem('kth.modules', opts.override ?? '');
  if (opts.notification === false) delete (window as unknown as Record<string, unknown>).Notification;
  else (window as unknown as Record<string, unknown>).Notification = class {};
  const { setClientConfig } = await import('../../utils/clientConfig');
  setClientConfig({});
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  registerBuiltinModules();
  return host;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('manifest', () => {
  it('validates and keeps the tab id, order and label key', () => {
    expect(validateBuiltinManifest(notificationsManifest)).toEqual([]);
    expect(notificationsManifest.contributes.preferencesSections).toEqual([
      { id: 'notifications', title: { key: 'settings.tabs.notifications', fallback: 'Notifications' }, icon: { kind: 'builtin', name: 'fa-bell' }, order: 60 },
    ]);
    expect(notificationsManifest.contributes.i18nNamespace).toBe('notifications');
  });
});

describe('on by default', () => {
  it('contributes the tab (between Audio and Apps) and its view, and loads no code at boot', async () => {
    const h = await boot();
    const ids = h.modulePoints.preferencesSections.list().map((s) => s.id);
    expect(ids).toContain('notifications');
    expect(ids.indexOf('notifications')).toBeGreaterThan(ids.indexOf('audio'));
    expect(ids.indexOf('notifications')).toBeLessThan(ids.indexOf('apps'));
    expect(h.modulePoints.views.resolve('preferences:notifications')).toBeDefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).toContain('notifications');
    expect(h.featureModules.isActive('notifications')).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('the host manifest no longer declares the tab', async () => {
    const { SETTINGS_SECTIONS } = await import('../host/ui');
    expect(SETTINGS_SECTIONS.map((s) => s.id)).not.toContain('notifications');
  });
});

describe('the boot probe and activation', () => {
  it('asks for activation where the browser has the Notifications API, and activation starts the reminders', async () => {
    const h = await boot();
    const intents = h.runBootProbes();
    expect(intents.activate).toContain('notifications');
    await h.featureModules.activateNow('notifications', 'onBootProbe');
    expect(h.featureModules.isActive('notifications')).toBe(true);
    expect(setFetcher).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not ask without the Notifications API (the tab stays)', async () => {
    const h = await boot({ notification: false });
    expect(h.runBootProbes().activate).not.toContain('notifications');
    expect(h.modulePoints.preferencesSections.get('notifications')).toBeDefined();
  });

  it('deactivating stops the reminders', async () => {
    const h = await boot();
    await h.featureModules.activateNow('notifications', 'onBootProbe');
    localStorage.setItem('kth.modules', '-notifications');
    h.reconcileModules();
    expect(stop).toHaveBeenCalled();
  });
});

describe('the dev override', () => {
  it('-notifications removes the tab, view and namespace, runs no probe and starts nothing', async () => {
    const h = await boot({ override: '-notifications' });
    expect(h.modulePoints.preferencesSections.get('notifications')).toBeUndefined();
    expect(h.modulePoints.views.resolve('preferences:notifications')).toBeUndefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('"notifications"');
    expect(h.runBootProbes().activate).not.toContain('notifications');
    expect(start).not.toHaveBeenCalled();
    expect(h.modulePoints.preferencesSections.get('about')).toBeDefined();
  });

  it('switched off at runtime, the tab disappears', async () => {
    const h = await boot();
    expect(h.modulePoints.preferencesSections.get('notifications')).toBeDefined();
    localStorage.setItem('kth.modules', '-notifications');
    h.reconcileModules();
    expect(h.modulePoints.preferencesSections.get('notifications')).toBeUndefined();
  });
});
