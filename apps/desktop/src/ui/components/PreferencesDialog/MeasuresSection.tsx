/**
 * MeasuresSection.tsx
 *
 * "Measures" tab of the Preferences dialog. Rendered entirely from the settings
 * registry (`../../settings/desktopSettings.ts`) through the shared `SettingsForm`:
 * adding a setting to the "measures" group of the registry adds a row here with no
 * further wiring.
 */
import React, { useMemo, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { DESKTOP_SETTINGS, getDesktopSettingsStore } from '../../settings/desktopSettings';
import { isEnabled } from '../../settings/featureFlags';

export const MeasuresSection: React.FC = () => {
  const { t } = useI18n();
  const store = getDesktopSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => DESKTOP_SETTINGS.toFields('measures', { translate: (key, fallback) => { const v = t(key); return v === key ? fallback : v; }, isEnabled, values }),
    [t, values],
  );

  return (
    <div data-testid="measures-section">
      <SettingsForm
        fields={fields}
        values={values}
        idPrefix="pref"
        onChange={(key, value) => {
          store.set(key, value);
        }}
      />
    </div>
  );
};

export default MeasuresSection;
