/**
 * Shared navigation selection for the desktop surfaces (rail, tiles, menu,
 * commands) and the Preferences > Apps section: one place that turns the app
 * registry and the user's order/hide/switcher preferences into nav items.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { selectNavItems, shouldShowRail } from '@bible/core/browser';
import type { AppRegistryState, AppSwitcherMode, NavItem, NavPrefs, NavSurface } from '@bible/core/browser';
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
