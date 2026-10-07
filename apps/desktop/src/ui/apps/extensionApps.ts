/**
 * Extension apps on desktop (task 0080, M3 row 11). The main process announces an extension's declared
 * apps over the `ext-bridge:ui` channel (`appRegistered`, `appUnregistered`, `appBadge`, `appOpen`); the
 * renderer bridge forwards them here and this module turns them into `appRegistry` descriptors plus a
 * binding whose view is `ExtensionAppView` (host app bar + the extension's sandboxed iframe).
 *
 * Re-registration of the same app is idempotent: an identical payload is a no-op, a changed one replaces
 * the registration (and re-opens the app when it was on screen).
 */
import React from 'react';
import type { AppBadge, AppDescriptor, AppIcon, Disposable, LabelRef } from '@bible/core/browser';

type LocalizedString = Extract<LabelRef, { text: unknown }>['text'];
import { addAppBinding, appHost, appRegistry, openApp } from './appHost';
import type { AppView } from './appHost';
import { ExtensionAppView } from './ExtensionAppView';

/** What main sends per app (`ExtensionAppInfo` in `RendererUiBridge`). */
export interface ExtensionAppInfo {
  /** Qualified id: `<extensionId>.<shortId>`. */
  id: string;
  shortId: string;
  title: LocalizedString;
  shortTitle?: LocalizedString;
  iconUrl?: string;
  /** 0..900, inside the extension band. */
  order: number;
  mobile?: 'sheet' | 'hidden';
  publisher: string;
  extensionName: LocalizedString;
  hasSettings: boolean;
}

interface Registered {
  extensionId: string;
  key: string;
  registration: Disposable;
  binding: Disposable;
}

const registered = new Map<string, Registered>();

const ORDER_BASE = 100;
const ORDER_MAX = 900;

function clampOrder(order: unknown): number {
  const n = typeof order === 'number' && Number.isFinite(order) ? Math.floor(order) : 0;
  return ORDER_BASE + Math.min(ORDER_MAX, Math.max(0, n));
}

function toDescriptor(extensionId: string, info: ExtensionAppInfo): AppDescriptor {
  const icon: AppIcon = info.iconUrl
    ? { kind: 'image', src: info.iconUrl }
    : { kind: 'builtin', name: 'app' };
  return {
    id: info.id,
    title: { extensionId, text: info.title },
    ...(info.shortTitle !== undefined ? { shortTitle: { extensionId, text: info.shortTitle } } : {}),
    icon,
    order: clampOrder(info.order),
    lifecycle: { keepAlive: 'never', restore: 'reopen' },
    platforms: ['desktop'],
    ...(info.mobile ? { mobile: info.mobile } : {}),
  };
}

function makeView(extensionId: string, info: ExtensionAppInfo): AppView {
  const View: AppView = () => React.createElement(ExtensionAppView, { extensionId, info });
  View.displayName = `ExtensionApp(${info.id})`;
  return View;
}

function remove(id: string): void {
  const entry = registered.get(id);
  if (!entry) return;
  registered.delete(id);
  entry.registration.dispose();
  entry.binding.dispose();
}

export function registerExtensionApp(extensionId: string, info: ExtensionAppInfo): void {
  if (!info || typeof info.id !== 'string' || !info.id.startsWith(`${extensionId}.`)) return;
  const key = JSON.stringify([extensionId, info]);
  const prev = registered.get(info.id);
  if (prev?.key === key) return;
  const wasActive = prev !== undefined && appHost.getSnapshot().activeId === info.id;
  if (prev) remove(info.id);
  // The binding goes in before the descriptor: a pending session restore opens the app the moment
  // the descriptor appears, and it needs the view to load.
  const View = makeView(extensionId, info);
  const binding = addAppBinding({ id: info.id, load: async () => ({ View }) });
  let registration: Disposable;
  try {
    registration = appRegistry.register(toDescriptor(extensionId, info), { kind: 'extension', extensionId });
  } catch (err) {
    binding.dispose();
    console.warn(`[ExtensionApps] could not register "${info.id}":`, err);
    return;
  }
  registered.set(info.id, { extensionId, key, registration, binding });
  if (wasActive) void openApp(info.id, { source: 'api' });
}

export function unregisterExtensionApp(extensionId: string, appId: string): void {
  if (registered.get(appId)?.extensionId !== extensionId) return;
  remove(appId);
}

export function setExtensionAppBadge(extensionId: string, appId: string, badge: AppBadge | null | undefined): void {
  if (registered.get(appId)?.extensionId !== extensionId) return;
  appRegistry.setBadge(appId, badge ?? undefined);
}

export function openExtensionApp(extensionId: string, appId: string): void {
  if (registered.get(appId)?.extensionId !== extensionId) return;
  void openApp(appId, { source: 'api' });
}

/** Test helper. */
export function resetExtensionAppsForTest(): void {
  for (const id of [...registered.keys()]) remove(id);
}
