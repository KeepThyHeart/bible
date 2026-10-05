/**
 * The desktop app host (task 0080): the registry of apps, the host state (which
 * app is shown, which are mounted), the bindings that load each app's view, and
 * the verse-action registry. Module singletons, as on web.
 *
 * Desktop stays eager: bindings import their view statically and only keep the
 * `load()` shape. There is no router, so opening an app is just an activation.
 */
import { useSyncExternalStore } from 'react';
import type React from 'react';
import {
  AppRegistry,
  VerseActionRegistry,
  createAppBindingController,
  createAppHostState,
} from '@bible/core/browser';
import type { ActivateOptions, ActivateResult, AppBinding, AppId, Disposable } from '@bible/core/browser';

export type AppView = React.ComponentType<Record<string, never>>;
export type DesktopAppBinding = AppBinding<AppView>;

export const appRegistry = new AppRegistry();
export const appHost = createAppHostState({ registry: appRegistry });
export const verseActions = new VerseActionRegistry();

/** The host as a store for `useSyncExternalStore` (class methods need their receiver). */
export const appHostStore = {
  subscribe: (listener: () => void) => appHost.subscribe(listener),
  getSnapshot: () => appHost.getSnapshot(),
};

/** `verseActions` as a store for `useSyncExternalStore` (the registry's methods need their receiver). */
export const verseActionsStore = {
  subscribe: (listener: () => void) => verseActions.subscribe(listener),
  getSnapshot: () => verseActions.getSnapshot(),
};

const controller = createAppBindingController<AppView>({
  host: appHost,
  onError: (err, id, phase) => console.warn(`[AppHost] ${phase} of "${id}" failed:`, err),
});

export function addAppBinding(binding: DesktopAppBinding): Disposable {
  return controller.add(binding);
}

export function prefetchApp(id: AppId): void {
  controller.prefetch(id);
}

export function getAppView(id: AppId): AppView | undefined {
  return controller.getView(id);
}

export function getAppCompanion(id: AppId) {
  return controller.getCompanion(id);
}

/** Open an app. A failed activation is logged; the host keeps showing the current app. */
export async function openApp(id: AppId, options: ActivateOptions = {}): Promise<ActivateResult> {
  const result = await appHost.activate(id, { source: 'nav', ...options });
  if (result.status === 'failed') console.error(`[AppHost] "${id}" failed to start:`, result.error);
  return result;
}

export function isAppActive(id: AppId): boolean {
  return appHost.getSnapshot().activeId === id;
}

export function useActiveAppId(): AppId | null {
  return useSyncExternalStore(appHostStore.subscribe, () => appHost.getSnapshot().activeId);
}

export function useIsAppActive(id: AppId): boolean {
  return useSyncExternalStore(appHostStore.subscribe, () => appHost.getSnapshot().activeId === id);
}

/**
 * Restore the persisted active app after the session loaded. Study is always
 * mounted first at boot, so only another app needs a further activation.
 */
export function restoreActiveApp(persisted: unknown): void {
  const id = appHost.restore(persisted);
  if (id !== 'study' && appRegistry.has(id)) void openApp(id, { source: 'restore' });
}

/** Test helper: forget every registration and binding (the hosts are module singletons). */
export function resetAppHostForTest(): void {
  for (const d of [...appRegistry.list()]) appRegistry.unregister(d.id);
  for (const e of [...verseActions.getSnapshot()]) verseActions.unregister(e.item.id);
}
