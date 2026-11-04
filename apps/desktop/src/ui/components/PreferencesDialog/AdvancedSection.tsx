/**
 * AdvancedSection.tsx
 *
 * "Advanced" tab of the Preferences dialog. Rendered entirely from the settings
 * registry (`../../settings/desktopSettings.ts`) through the shared `SettingsForm`:
 * adding a setting to the "advanced" group of the registry adds a row here with no
 * further wiring.
 */
import React, { useMemo, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { DESKTOP_SETTINGS, getDesktopSettingsStore } from '../../settings/desktopSettings';
import { isEnabled } from '../../settings/featureFlags';
import { useBackupStore } from '../../stores/useBackupStore';

export const AdvancedSection: React.FC = () => {
  const { t } = useI18n();
  const store = getDesktopSettingsStore();
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const fields = useMemo(
    () => DESKTOP_SETTINGS.toFields('advanced', { translate: (key) => t(key), isEnabled, values }),
    [t, values],
  );

  return (
    <div data-testid="advanced-section">
      <SettingsForm
        fields={fields}
        values={values}
        idPrefix="pref"
        onChange={(key, value) => {
          store.set(key, value);
        }}
      />
      <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--theme-border-primary)' }}>
        <p className="text-sm mb-2" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('backupRestoreDialog.preferencesHint')}
        </p>
        <button
          type="button"
          onClick={() => useBackupStore.getState().openDialog()}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ border: '1px solid var(--theme-accent-primary)', color: 'var(--theme-accent-primary)' }}
          data-testid="preferences-open-backup"
        >
          {t('backupRestoreDialog.openFromPreferences')}
        </button>
      </div>
    </div>
  );
};

export default AdvancedSection;
