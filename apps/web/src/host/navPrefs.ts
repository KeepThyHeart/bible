/**
 * Web navigation selection: which apps the rail, tiles and phone sheet show.
 * Registry state + the Preferences > Apps settings, through core's pure
 * `selectNavItems` / `shouldShowRail`.
 */
import { useMemo } from 'preact/hooks';
import {
  appSwitcherFromSettings, navPrefsFromSettings, selectNavItems, shouldShowRail,
} from '@bible/core/browser';
import type { AppSwitcherMode, NavItem, NavPrefs, NavSurface } from '@bible/core/browser';
import { webSettings } from '../stores/settingsRegistry';
import { appRegistry } from './appHost';
import { evalAppWhen } from './verseActionWhen';
import { useIsMobile } from './useIsMobile';
import { useReadable } from './useReadable';

function getSetting(key: string): unknown {
  return webSettings.getSnapshot()[key];
}

/** Stable identity while the stored order/hidden lists do not change. */
function prefsKey(p: NavPrefs): string {
  return JSON.stringify([p.order ?? [], p.hidden ?? []]);
}

/** The apps a surface shows, in the user's order, hidden ones and unavailable ones removed. */
export function useNavItems(surface: NavSurface): NavItem[] {
  const registry = useReadable(appRegistry.state);
  const settings = useReadable(webSettings);
  const prefs = navPrefsFromSettings((key) => settings[key]);
  const key = prefsKey(prefs);
  return useMemo(
    () => selectNavItems(registry.apps, { platform: 'web', prefs, evalWhen: evalAppWhen, surface }),
    // `prefs` is rebuilt per render; its content key is what matters.
    [registry, key, surface],
  );
}

/** One-shot selection (shortcuts, tests): same rules as the hook. */
export function selectWebNavItems(surface: NavSurface): NavItem[] {
  return selectNavItems(appRegistry.state.getSnapshot().apps, {
    platform: 'web',
    prefs: navPrefsFromSettings(getSetting),
    evalWhen: evalAppWhen,
    surface,
  });
}

/** The `shell.appSwitcher` setting: auto, rail or none. */
export function useRailMode(): AppSwitcherMode {
  const settings = useReadable(webSettings);
  return appSwitcherFromSettings((key) => settings[key]);
}

/** True while the wide-screen rail shows (never on the phone layout). */
export function useRailVisible(): boolean {
  const mode = useRailMode();
  const items = useNavItems('rail');
  const mobile = useIsMobile();
  return !mobile && shouldShowRail(mode, items.length);
}
