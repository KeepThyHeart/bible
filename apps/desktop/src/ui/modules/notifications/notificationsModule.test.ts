/**
 * The Notifications module through the real desktop host (task 0128; the full `registerBuiltinModules` list is covered by `builtinModules.test.ts`): its Preferences section and
 * namespace exist after boot without loading any module code, `onStartupFinished` activates it (it
 * routes notification clicks), and the dev override removes everything.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { notificationsManifest } from './manifest';

// Booting the real module graph is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const dispose = vi.fn();
const startRouting = vi.fn(() => ({ dispose }));

async function boot(override: string) {
  vi.resetModules();
  vi.doMock('./openTarget', () => ({ startNotificationOpenTargetRouting: startRouting }));
  window.localStorage.setItem('kth.modules', override);
  const host = await import('../moduleHost');
  const { notificationsModule } = await import('./binding');
  host.addDesktopModule(notificationsModule);
  host.reconcileModules();
  return host;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('manifest', () => {
  it('validates and keeps the section id, order and label key the host declared', () => {
    expect(validateBuiltinManifest(notificationsManifest)).toEqual([]);
    expect(notificationsManifest.platforms).toEqual(['desktop']);
    expect(notificationsManifest.contributes.preferencesSections).toEqual([
      { id: 'notifications', title: { key: 'preferencesDialog.sectionNotifications', fallback: 'Notifications' }, icon: { kind: 'builtin', name: 'notifications' }, order: 30 },
    ]);
    expect(notificationsManifest.contributes.i18nNamespace).toBe('notifications');
  });
});

describe('on by default', () => {
  it('is in the built-in list (a source check: importing the whole list is slow)', () => {
    const list = readFileSync(resolve(__dirname, '../builtinModules.ts'), 'utf8');
    expect(list).toMatch(/import \{ notificationsModule \} from '\.\/notifications\/binding';/);
    expect(list).toMatch(/^\s+notificationsModule,$/m);
  });

  it('contributes the section, its view and namespace, and loads no code until startup finishes', async () => {
    const { modulePoints, featureModules } = await boot('');
    expect(modulePoints.preferencesSections.has('notifications')).toBe(true);
    expect(modulePoints.views.resolve('preferences:notifications')).toBeDefined();
    expect(modulePoints.i18nNamespace.has('notifications')).toBe(true);
    expect(featureModules.isActive('notifications')).toBe(false);
    expect(startRouting).not.toHaveBeenCalled();
  });

  it('onStartupFinished activates it, which starts routing notification clicks', async () => {
    const { featureModules } = await boot('');
    await featureModules.fire('onStartupFinished');
    expect(featureModules.isActive('notifications')).toBe(true);
    expect(startRouting).toHaveBeenCalledTimes(1);
  });
});

describe('off switch', () => {
  it('-notifications removes the section, view and namespace and never starts routing', async () => {
    const { modulePoints, featureModules } = await boot('-notifications');
    expect(modulePoints.preferencesSections.has('notifications')).toBe(false);
    expect(modulePoints.views.resolve('preferences:notifications')).toBeUndefined();
    expect(modulePoints.i18nNamespace.has('notifications')).toBe(false);
    await featureModules.fire('onStartupFinished');
    expect(startRouting).not.toHaveBeenCalled();
  });

  it('switching it off at runtime removes the section and stops the routing', async () => {
    const { modulePoints, featureModules, reconcileModules } = await boot('');
    await featureModules.fire('onStartupFinished');
    window.localStorage.setItem('kth.modules', '-notifications');
    reconcileModules();
    expect(modulePoints.preferencesSections.has('notifications')).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
