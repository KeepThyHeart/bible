/**
 * The three shell settings behind Preferences > Apps (task 0080, row S1),
 * declared once for both platforms and merged into each platform's settings
 * registry (task 0087). Keys avoid dots (path separators in the field model).
 *
 * - `appSwitcher`: `auto` (rail only when more than one app is available),
 *   `rail` (always), `none` (no rail; the other surfaces stay).
 * - `appOrder` / `appHidden`: app ids; edited through the Apps section's
 *   order/hide list, not as plain text, so the registry group is `apps` and
 *   the generic form skips the two array keys (`APP_NAV_CUSTOM_KEYS`).
 */
import { defineSettings } from '../Settings/SettingsRegistry';
import type { NavPrefs } from './NavItems';
import { normalizeNavPrefs } from './NavItems';

export type AppSwitcherMode = 'auto' | 'rail' | 'none';
export const APP_SWITCHER_MODES: readonly AppSwitcherMode[] = ['auto', 'rail', 'none'];

export const APP_NAV_CUSTOM_KEYS: readonly string[] = ['appOrder', 'appHidden'];

export const APP_NAV_SETTINGS = defineSettings([
  {
    key: 'appSwitcher',
    type: 'enum',
    values: APP_SWITCHER_MODES,
    default: 'auto',
    scope: 'device',
    group: 'apps',
    order: 1,
    labelKey: 'settings.apps.switcher',
    label: 'App switcher',
    descriptionKey: 'settings.apps.switcherHint',
    description: 'Show the app rail always, never, or only when more than one app is available.',
    valueLabelKeys: {
      auto: 'settings.apps.switcherAuto',
      rail: 'settings.apps.switcherRail',
      none: 'settings.apps.switcherNone',
    },
  },
  {
    key: 'appOrder',
    type: 'string-array',
    default: [],
    scope: 'device',
    group: 'apps',
    order: 2,
    labelKey: 'settings.apps.order',
    label: 'App order',
  },
  {
    key: 'appHidden',
    type: 'string-array',
    default: [],
    scope: 'device',
    group: 'apps',
    order: 3,
    labelKey: 'settings.apps.hidden',
    label: 'Hidden apps',
  },
]);

/** Read the nav prefs out of a settings snapshot (any platform). */
export function navPrefsFromSettings(get: (key: string) => unknown): NavPrefs {
  return normalizeNavPrefs({ order: get('appOrder'), hidden: get('appHidden') });
}

export function appSwitcherFromSettings(get: (key: string) => unknown): AppSwitcherMode {
  const v = get('appSwitcher');
  return v === 'rail' || v === 'none' ? v : 'auto';
}

/** Whether a rail shows, given the mode and the number of visible items. */
export function shouldShowRail(mode: AppSwitcherMode, itemCount: number): boolean {
  return mode === 'rail' || (mode === 'auto' && itemCount > 1);
}
