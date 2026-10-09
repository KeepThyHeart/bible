/**
 * MeasuresSection.tsx
 *
 * "Measures" tab of the Preferences dialog (the `preferences:measures` view of the measures module).
 * Rendered entirely from core's measure settings registry through the shared `SettingsForm`: adding a
 * setting to the "measures" group adds a row here with no further wiring. The values live in the
 * measure store (and so in the session blob, key `measures`), as before the module existed.
 */
import React, { useMemo, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { isEnabled } from '../../settings/featureFlags';
import { getMeasureSettingsStore, measureSettingsRegistry } from './measureSettings';

export const MeasuresSection: React.FC = () => {
  const { t } = useI18n();
  const store = getMeasureSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => measureSettingsRegistry.toFields('measures', { translate: (key, fallback) => { const v = t(key); return v === key ? fallback : v; }, isEnabled, values }),
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
