/**
 * Generic preferences section for a contributed section that names a
 * `settingsGroup` instead of a custom view: renders that group of the desktop
 * settings registry through the shared `SettingsForm` (same as AdvancedSection).
 */
import React, { useMemo, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { DESKTOP_SETTINGS, getContributedSettings, getDesktopSettingsStore } from '../../settings/desktopSettings';
import { fireActivation } from '../../modules/moduleHost';
import { isEnabled } from '../../settings/featureFlags';

export const SettingsGroupSection: React.FC<{ group: string }> = ({ group }) => {
  const { t } = useI18n();
  // A group a module contributed uses the contributed registry; otherwise the desktop one.
  const contributed = getContributedSettings();
  const isContributed = contributed.registry.toFields(group, { translate: (k) => k, isEnabled, values: {} }).length > 0;
  const registry = isContributed ? contributed.registry : DESKTOP_SETTINGS;
  const store = isContributed ? contributed.store : getDesktopSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => registry.toFields(group, { translate: (key) => t(key), isEnabled, values }),
    [registry, group, t, values],
  );
  return (
    <div data-testid={`settings-group-${group}`}>
      <SettingsForm fields={fields} values={values} idPrefix={`pref-${group}`} onChange={(key, value) => { store.set(key, value); fireActivation(`onSetting:${key}`); }} />
    </div>
  );
};

export default SettingsGroupSection;
