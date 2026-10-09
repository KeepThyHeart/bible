/**
 * The measures settings store: core's `measures*` registry over the measure store (session-persisted,
 * per device). It used to be part of the desktop settings registry; the module owns it now.
 */
import {
  createSettingsStore,
  measureSettingsRegistry,
  MEASURE_SETTINGS,
  type SettingChange,
  type SettingsStore,
  type SettingsStoragePort,
} from '@bible/core/browser';
import { useMeasureStore } from './useMeasureStore';

export { measureSettingsRegistry };

const MEASURE_KEYS: ReadonlySet<string> = new Set(MEASURE_SETTINGS.map((d) => d.key));

const port: SettingsStoragePort = {
  read: () => ({ ...useMeasureStore.getState().values }), // allow-getstate: settings port
  write: (changes: readonly SettingChange[]) => {
    for (const change of changes) {
      if (MEASURE_KEYS.has(change.key)) useMeasureStore.getState().setValue(change.key, change.value);
    }
  },
};

let store: SettingsStore | null = null;

/** The shared measures settings store, created on first use. */
export function getMeasureSettingsStore(): SettingsStore {
  if (!store) {
    store = createSettingsStore(measureSettingsRegistry, port);
    // Session restore fills the values after the store exists.
    useMeasureStore.subscribe((state, prev) => {
      if (state.values === prev.values) return;
      for (const [key, value] of Object.entries(state.values)) store!.set(key, value);
    });
  }
  return store;
}
