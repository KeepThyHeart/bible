/**
 * Shared navigation selection for the desktop surfaces (rail, tiles, menu,
 * commands) and the Preferences > Apps section: one place that turns the app
 * registry and the user's order/hide/switcher preferences into nav items.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { selectNavItems, shouldShowRail, STUDY_APP_ID } from '@bible/core/browser';
import type { AppIcon, AppRegistryState, AppSwitcherMode, LabelRef, NavItem, NavPrefs, NavSurface } from '@bible/core/browser';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { whenContextService } from '../services/WhenContextService';
import { appRegistry } from './appHost';

/** Pure: nav items for the desktop, given the registry state and prefs. */
export function selectDesktopNavItems(
  state: AppRegistryState,
  prefs: NavPrefs,
  surface: NavSurface,
  evalWhen: (expr: string) => boolean = (expr) => whenContextService.evaluate(expr),
): NavItem[] {
  return selectNavItems(state.apps, { platform: 'desktop', prefs, evalWhen, surface });
}

function useRegistryState(): AppRegistryState {
  return useSyncExternalStore(appRegistry.state.subscribe, appRegistry.state.getSnapshot);
}

/** Visible apps for a surface, in the user's order, reactive to the registry and preferences. */
export function useNavItems(surface: NavSurface): NavItem[] {
  const state = useRegistryState();
  const order = usePreferencesStore((s) => s.appOrder);
  const hidden = usePreferencesStore((s) => s.appHidden);
  return useMemo(
    () => selectDesktopNavItems(state, { order, hidden }, surface),
    [state, order, hidden, surface],
  );
}

/** The `shell.appSwitcher` mode. */
export function useRailMode(): AppSwitcherMode {
  return usePreferencesStore((s) => s.appSwitcher);
}

/** Whether the rail shows for this item count, under the current mode. */
export function useShowRail(itemCount: number): boolean {
  return shouldShowRail(useRailMode(), itemCount);
}

/** Non-hook read, for commands and the menu push. */
export function currentNavItems(surface: NavSurface): NavItem[] {
  const { appOrder, appHidden } = usePreferencesStore.getState(); // allow-getstate: non-hook accessor for commands/menu
  return selectDesktopNavItems(appRegistry.state.getSnapshot(), { order: appOrder, hidden: appHidden }, surface);
}

/** One row of Preferences > Apps: an available app, hidden ones included. */
export interface AppsPreferenceItem {
  id: string;
  title: LabelRef;
  icon: AppIcon;
  hidden: boolean;
  /** Study cannot be hidden. */
  locked: boolean;
}

/** Pure: every available app in the user's order, with a `hidden` flag. */
export function selectAppsPreferenceItems(
  state: AppRegistryState,
  prefs: NavPrefs,
  evalWhen?: (expr: string) => boolean,
): AppsPreferenceItem[] {
  const hidden = new Set(prefs.hidden ?? []);
  return selectDesktopNavItems(state, { order: prefs.order }, 'tiles', evalWhen).map((n) => ({
    id: n.id,
    title: n.title,
    icon: n.icon,
    hidden: n.id !== STUDY_APP_ID && hidden.has(n.id),
    locked: n.id === STUDY_APP_ID,
  }));
}

/** Preferences > Apps rows, reactive to the registry and preferences. */
export function useAppsPreferenceItems(): AppsPreferenceItem[] {
  const state = useRegistryState();
  const order = usePreferencesStore((s) => s.appOrder);
  const hidden = usePreferencesStore((s) => s.appHidden);
  return useMemo(() => selectAppsPreferenceItems(state, { order, hidden }), [state, order, hidden]);
}
