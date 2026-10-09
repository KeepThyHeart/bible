/**
 * The colour-safe setting, shown at the end of the Advanced tab (a child `preferencesSections`
 * entry with `parent: 'advanced'`, no heading of its own). The value lives in the keyword-mark store
 * (and so in the session blob, key `keywordMarks`), as it did before the module existed.
 */
import React, { useMemo, useSyncExternalStore } from 'react';
import { SettingsForm } from '@bible/ui';
import { createSettingsStore, defineSettings, type SettingChange, type SettingsStore, type SettingsStoragePort } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { isEnabled } from '../../settings/featureFlags';
import { useModuleNamespace } from '../host/useModuleNamespace';
import { keywordSettings } from './manifest';
import { useKeywordMarkStore } from './useKeywordMarkStore';

const registry = defineSettings(keywordSettings.defs);

const port: SettingsStoragePort = {
  read: () => ({ keywordColorSafe: useKeywordMarkStore.getState().colorSafe }), // allow-getstate: settings port
  write: (changes: readonly SettingChange[]) => {
    for (const change of changes) {
      if (change.key === 'keywordColorSafe' && useKeywordMarkStore.getState().colorSafe !== change.value) {
        useKeywordMarkStore.getState().setColorSafe(change.value as boolean);
      }
    }
  },
};

let store: SettingsStore | null = null;

/** The settings store over the keyword-mark store, created on first use. */
export function getKeywordSettingsStore(): SettingsStore {
  if (!store) {
    store = createSettingsStore(registry, port);
    useKeywordMarkStore.subscribe((state) => {
      store!.set('keywordColorSafe', state.colorSafe);
    });
  }
  return store;
}

export const KeywordSettingsSection: React.FC = () => {
  const { t } = useI18n();
  const ready = useModuleNamespace('keywords');
  const settings = getKeywordSettingsStore();
  const values = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot);
  const fields = useMemo(
    () => registry.toFields('advanced', { translate: (key) => t(key), isEnabled, values }),
    // `ready` re-resolves the labels once the namespace is in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, values, ready],
  );
  if (!ready) return null;
  return (
    <SettingsForm
      fields={fields}
      values={values}
      idPrefix="pref"
      onChange={(key, value) => {
        settings.set(key, value);
      }}
    />
  );
};

export default KeywordSettingsSection;
