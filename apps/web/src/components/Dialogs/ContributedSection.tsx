/**
 * A settings-panel section contributed by a feature module (task 0113): the
 * module's lazy view `preferences:<id>` when it bound one, otherwise a generic
 * form over its `settingsGroup`. Built-in tabs render inline in SettingsPanel.
 */
import { useEffect, useState } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import type { ComponentType } from 'preact';
import { useTranslation } from 'react-i18next';
import { SettingsForm } from '@bible/ui';
import type { PreferencesSectionContribution } from '@bible/core/browser';
import { modulePoints } from '../../modules/moduleHost';
import { contributedSettings, contributedSettingsStore } from '../../stores/settingsRegistry';
import { isEnabled } from '../../utils/featureFlags';

function GenericGroup({ group, id }: { group: string; id: string }) {
  const { t } = useTranslation();
  const store = contributedSettingsStore(modulePoints.settings);
  const values = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const fields = contributedSettings(modulePoints.settings).toFields(group, {
    translate: (key, fallback) => t(key, fallback),
    isEnabled,
    values,
  });
  return (
    <SettingsForm
      fields={fields}
      values={values}
      idPrefix={`settings-${id}`}
      onChange={(key, value) => { store.set(key, value); }}
    />
  );
}

export function ContributedSection({ section }: { section: PreferencesSectionContribution }) {
  const { t } = useTranslation();
  const [View, setView] = useState<ComponentType | null>(null);
  useEffect(() => {
    let live = true;
    const loader = modulePoints.views.resolve<{ default?: ComponentType } | ComponentType>(`preferences:${section.id}`);
    if (loader) {
      void loader().then((mod) => {
        const comp = typeof mod === 'function' ? mod : mod?.default;
        if (live && comp) setView(() => comp);
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [section.id]);

  if (View) return <View />;
  const title = 'key' in section.title ? t(section.title.key, section.title.fallback) : '';
  return (
    <div class="settings-panel__section" data-section={section.id}>
      <h4 class="settings-panel__section-title">{title}</h4>
      {section.settingsGroup && <GenericGroup group={section.settingsGroup} id={section.id} />}
    </div>
  );
}
