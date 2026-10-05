/**
 * Desktop settings registry (task 0087).
 *
 * New desktop settings are declared here (or in a registry merged in with
 * `mergeSettings`) and render through `@bible/ui`'s `SettingsForm`; nothing else needs
 * wiring. Persistence stays where it always was: `usePreferencesStore`, whose fields are
 * saved in the session blob. The port below is the adapter between the two, so the
 * registry store is a typed, validated view over the preferences store rather than a
 * second copy of the data.
 *
 * Migrated as the proof: `advancedPaneManagerEnabled`, which had no UI before.
 */
import {
  createSettingsStore,
  defineSettings,
  mergeSettings,
  measureSettingsRegistry,
  MEASURE_SETTINGS,
  APP_NAV_SETTINGS,
  type SettingChange,
  type SettingsStore,
  type SettingsRegistry,
  type SettingsStoragePort,
  type AppSwitcherMode,
} from '@bible/core/browser';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useKeywordMarkStore } from '../stores/useKeywordMarkStore';
import { modulePoints } from '../modules/moduleHost';
import { useMeasureStore } from '../stores/useMeasureStore';

const DESKTOP_OWN_SETTINGS = defineSettings([
  {
    key: 'advancedPaneManagerEnabled',
    type: 'boolean',
    default: false,
    scope: 'device',
    group: 'advanced',
    labelKey: 'preferencesDialog.advancedPaneManagerLabel',
    label: 'Allow rearranging panes by drag and drop',
    descriptionKey: 'preferencesDialog.advancedPaneManagerDescription',
    description: 'When off, dragging a pane asks for confirmation before it moves.',
  },
  {
    key: 'keywordColorSafe',
    type: 'boolean',
    default: true,
    scope: 'device',
    group: 'advanced',
    labelKey: 'keywords.settings.colorSafe',
    label: 'Colour-safe marks (extra underline and symbol cues)',
  },
  {
    key: 'readingPlanRolloverHour',
    type: 'integer',
    default: 3,
    min: 0,
    max: 12,
    scope: 'device',
    group: 'readingPlans',
    labelKey: 'readingPlans.settings.rolloverHour',
    label: 'New reading day starts at (hour)',
    descriptionKey: 'readingPlans.settings.rolloverHourDescription',
    description:
      'Reading after midnight but before this hour counts for the previous day. Change it if you work nights.',
  },
  {
    key: 'readingPlanShowStreak',
    type: 'boolean',
    default: false,
    scope: 'device',
    group: 'readingPlans',
    labelKey: 'readingPlans.settings.showStreak',
    label: 'Show reading streaks',
  },
]);

/**
 * The settings feature modules contribute (`contributes.settings`, task 0113), as a
 * registry. Computed on each call from the live contribution point, so a disabled
 * module's settings are absent. The hand-merged registries below stay as they are;
 * merge this one in where modules should be able to add settings:
 * `mergeSettings(DESKTOP_SETTINGS, contributedSettings())`.
 */
export function contributedSettings(): SettingsRegistry {
  return defineSettings(modulePoints.settings.list().flatMap((group) => group.defs.map((d) => ({ ...d, group: d.group ?? group.id }))));
}

/** Desktop's own settings plus the weights-and-measures group (task 0069, declared in core). */
export const DESKTOP_SETTINGS = mergeSettings(DESKTOP_OWN_SETTINGS, measureSettingsRegistry, APP_NAV_SETTINGS);

const MEASURE_KEYS: ReadonlySet<string> = new Set(MEASURE_SETTINGS.map((d) => d.key));

function sameIds(a: readonly string[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Port over `usePreferencesStore` (session-persisted, per device). */
export const preferencesStoragePort: SettingsStoragePort = {
  read: () => ({
    advancedPaneManagerEnabled: usePreferencesStore.getState().advancedPaneManagerEnabled,
    keywordColorSafe: useKeywordMarkStore.getState().colorSafe,
    readingPlanRolloverHour: usePreferencesStore.getState().readingPlanRolloverHour,
    readingPlanShowStreak: usePreferencesStore.getState().readingPlanShowStreak,
    appSwitcher: usePreferencesStore.getState().appSwitcher,
    appOrder: usePreferencesStore.getState().appOrder,
    appHidden: usePreferencesStore.getState().appHidden,
    ...useMeasureStore.getState().values,
  }),
  write: (changes: readonly SettingChange[]) => {
    for (const change of changes) {
      if (change.key === 'keywordColorSafe' && useKeywordMarkStore.getState().colorSafe !== change.value) {
        useKeywordMarkStore.getState().setColorSafe(change.value as boolean);
      }
      if (MEASURE_KEYS.has(change.key)) useMeasureStore.getState().setValue(change.key, change.value);
      if (
        change.key === 'advancedPaneManagerEnabled' &&
        usePreferencesStore.getState().advancedPaneManagerEnabled !== change.value
      ) {
        usePreferencesStore.getState().setAdvancedPaneManagerEnabled(change.value as boolean);
      }
      if (
        change.key === 'readingPlanRolloverHour' &&
        usePreferencesStore.getState().readingPlanRolloverHour !== change.value
      ) {
        usePreferencesStore.getState().setReadingPlanRolloverHour(change.value as number);
      }
      if (change.key === 'appSwitcher' && usePreferencesStore.getState().appSwitcher !== change.value) {
        usePreferencesStore.getState().setAppSwitcher(change.value as AppSwitcherMode);
      }
      if (change.key === 'appOrder' && Array.isArray(change.value) && !sameIds(usePreferencesStore.getState().appOrder, change.value)) {
        usePreferencesStore.getState().setAppOrder(change.value as string[]);
      }
      if (change.key === 'appHidden' && Array.isArray(change.value) && !sameIds(usePreferencesStore.getState().appHidden, change.value)) {
        usePreferencesStore.getState().setAppHidden(change.value as string[]);
      }
      if (
        change.key === 'readingPlanShowStreak' &&
        usePreferencesStore.getState().readingPlanShowStreak !== change.value
      ) {
        usePreferencesStore.getState().setReadingPlanShowStreak(change.value as boolean);
      }
    }
  },
};

let store: SettingsStore | null = null;

/** The shared desktop settings store, created on first use. */
export function getDesktopSettingsStore(): SettingsStore {
  if (!store) {
    store = createSettingsStore(DESKTOP_SETTINGS, preferencesStoragePort);
    // The preferences store also changes from session restore and the pane-manager gate
    // dialog; mirror those in so the settings view never shows a stale value.
    usePreferencesStore.subscribe((state) => {
      store!.set('advancedPaneManagerEnabled', state.advancedPaneManagerEnabled);
      store!.set('readingPlanRolloverHour', state.readingPlanRolloverHour);
      store!.set('readingPlanShowStreak', state.readingPlanShowStreak);
      store!.set('appSwitcher', state.appSwitcher);
      store!.set('appOrder', state.appOrder);
      store!.set('appHidden', state.appHidden);
    });
    useKeywordMarkStore.subscribe((state) => {
      store!.set('keywordColorSafe', state.colorSafe);
    });
    // Session restore fills the measures values after the store exists.
    useMeasureStore.subscribe((state, prev) => {
      if (state.values === prev.values) return;
      for (const [key, value] of Object.entries(state.values)) store!.set(key, value);
    });
  }
  return store;
}
