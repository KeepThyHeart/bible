/**
 * Navigation selection (task 0080): what the rail, tiles, menu and phone sheet
 * show, derived from the app registry snapshot. Pure functions, no I/O.
 */

import type { HostPlatform, LabelRef } from '../Modules/types';
import { STUDY_APP_ID } from './AppDescriptor';
import type { AppBadge, AppIcon, AppId } from './AppDescriptor';
import type { AppRegistryEntry } from './AppRegistry';

export interface NavPrefs {
  order?: readonly AppId[];
  hidden?: readonly AppId[];
}

export type NavSurface = 'rail' | 'tiles' | 'menu' | 'sheet';

export interface NavItem {
  id: AppId;
  title: LabelRef;
  shortTitle?: LabelRef;
  icon: AppIcon;
  badge?: AppBadge;
  busy: boolean;
  /** 1-based Ctrl+Shift+N slot, set for the first 9 shown items by the final order, else undefined. */
  shortcutSlot?: number;
}

export interface SelectNavItemsOptions {
  platform: HostPlatform;
  prefs?: NavPrefs;
  /** Evaluates a descriptor's `when` expression; default: always true. Called only when `when` is set. */
  evalWhen?: (expr: string) => boolean;
  surface?: NavSurface;
}

const MAX_SHORTCUT_SLOTS = 9;

export function selectNavItems(
  apps: readonly AppRegistryEntry[],
  opts: SelectNavItemsOptions,
): NavItem[] {
  const hidden = new Set(opts.prefs?.hidden ?? []);
  hidden.delete(STUDY_APP_ID);
  const shown = apps.filter(({ item }) => {
    if (item.platforms && !item.platforms.includes(opts.platform)) return false;
    if (item.when && opts.evalWhen && !opts.evalWhen(item.when)) return false;
    if (hidden.has(item.id)) return false;
    if (opts.surface === 'sheet' && item.mobile === 'hidden') return false;
    return true;
  });

  const byId = new Map(shown.map((e) => [e.item.id, e]));
  const ordered: AppRegistryEntry[] = [];
  for (const id of opts.prefs?.order ?? []) {
    const entry = byId.get(id);
    if (entry) {
      ordered.push(entry);
      byId.delete(id);
    }
  }
  for (const entry of shown) if (byId.has(entry.item.id)) ordered.push(entry);

  return ordered.map(({ item, badge, busy }, i) => {
    const nav: NavItem = { id: item.id, title: item.title, icon: item.icon, busy };
    if (item.shortTitle !== undefined) nav.shortTitle = item.shortTitle;
    if (badge) nav.badge = badge;
    if (i < MAX_SHORTCUT_SLOTS) nav.shortcutSlot = i + 1;
    return nav;
  });
}

/** True when there is more than one app to switch between (a single app hides the rail). */
export function hasMultipleApps(items: readonly unknown[]): boolean {
  return items.length > 1;
}

function idList(raw: unknown): AppId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) if (typeof v === 'string' && v !== '') seen.add(v);
  return [...seen];
}

/** Tolerant parse of stored prefs: garbage in, a valid (possibly empty) value out. */
export function normalizeNavPrefs(raw: unknown): NavPrefs {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    order: idList(obj.order),
    hidden: idList(obj.hidden).filter((id) => id !== STUDY_APP_ID),
  };
}
