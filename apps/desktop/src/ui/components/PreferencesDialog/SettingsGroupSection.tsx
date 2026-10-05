/**
 * Generic preferences section for a contributed section that names a
 * `settingsGroup` instead of a custom view: renders that group of the desktop
 * settings registry through the shared `SettingsForm` (same as AdvancedSection).
 */
import React, { useMemo, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { DESKTOP_SETTINGS, getDesktopSettingsStore } from '../../settings/desktopSettings';
import { isEnabled } from '../../settings/featureFlags';

export const SettingsGroupSection: React.FC<{ group: string }> = ({ group }) => {
  const { t } = useI18n();
  const store = getDesktopSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => DESKTOP_SETTINGS.toFields(group, { translate: (key) => t(key), isEnabled, values }),
    [group, t, values],
  );
  return (
    <div data-testid={`settings-group-${group}`}>
      <SettingsForm fields={fields} values={values} idPrefix={`pref-${group}`} onChange={(key, value) => { store.set(key, value); }} />
    </div>
  );
};

export default SettingsGroupSection;
