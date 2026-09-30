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
  type SettingChange,
  type SettingsStore,
  type SettingsStoragePort,
} from '@bible/core/browser';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useKeywordMarkStore } from '../stores/useKeywordMarkStore';

export const DESKTOP_SETTINGS = defineSettings([
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
    group: 'keywords',
    labelKey: 'keywords.settings.colorSafe',
    label: 'Colour-safe marks (extra underline and symbol cues)',
  },
]);

/** Port over `usePreferencesStore` (session-persisted, per device). */
export const preferencesStoragePort: SettingsStoragePort = {
  read: () => ({
    advancedPaneManagerEnabled: usePreferencesStore.getState().advancedPaneManagerEnabled,
    keywordColorSafe: useKeywordMarkStore.getState().colorSafe,
  }),
  write: (changes: readonly SettingChange[]) => {
    for (const change of changes) {
      if (change.key === 'keywordColorSafe' && useKeywordMarkStore.getState().colorSafe !== change.value) {
        useKeywordMarkStore.getState().setColorSafe(change.value as boolean);
      }
      if (
        change.key === 'advancedPaneManagerEnabled' &&
        usePreferencesStore.getState().advancedPaneManagerEnabled !== change.value
      ) {
        usePreferencesStore.getState().setAdvancedPaneManagerEnabled(change.value as boolean);
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
    });
    useKeywordMarkStore.subscribe((state) => {
      store!.set('keywordColorSafe', state.colorSafe);
    });
  }
  return store;
}
