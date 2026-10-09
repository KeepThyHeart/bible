/**
 * Live access to settings that feature modules contribute (`contributes.settings`,
 * task 0127). The registry grows and shrinks as modules switch on and off, and
 * `contributedSettingsStore` makes a new store whenever it does, so a module reads
 * through these helpers instead of holding one store: they follow the current one.
 * All stores share the one `bible-reader-settings` blob, so values carry across.
 */
import { useSyncExternalStore } from 'preact/compat';
import type { SettingValue } from '@bible/core/browser';
import { contributedSettings, contributedSettingsStore } from '../../stores/settingsRegistry';
import { modulePoints } from '../moduleHost';

/** The settings store over the registry as it is now. */
export function currentSettingsStore(): ReturnType<typeof contributedSettingsStore> {
  return contributedSettingsStore(modulePoints.settings);
}

/** Current values of every setting (defaults for registered keys; a key nobody contributes is absent). */
export function currentSettings(): Readonly<Record<string, SettingValue>> {
  return currentSettingsStore().getSnapshot();
}

/** Subscribe to value changes and to registry changes (a module on or off). */
export function subscribeSettings(listener: () => void): () => void {
  let unsubscribe = currentSettingsStore().subscribe(listener);
  const offPoint = modulePoints.settings.subscribe(() => {
    unsubscribe();
    unsubscribe = currentSettingsStore().subscribe(listener);
    listener();
  });
  return () => {
    unsubscribe();
    offPoint();
  };
}

/** Re-renders on any settings change; returns the current values. */
export function useSettings(): Readonly<Record<string, SettingValue>> {
  return useSyncExternalStore(subscribeSettings, currentSettings);
}

/** Set a setting if some enabled module contributes it (ignored otherwise). */
export function setSetting(key: string, value: SettingValue): void {
  if (contributedSettings(modulePoints.settings).has(key)) currentSettingsStore().set(key, value);
}
