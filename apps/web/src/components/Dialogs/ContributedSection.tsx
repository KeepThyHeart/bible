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

/** A generic form over one contributed settings group. A module's own section view reuses it for its fields. */
export function SettingsGroupForm({ group, idPrefix }: { group: string; idPrefix: string }) {
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
      idPrefix={idPrefix}
      onChange={(key, value) => { store.set(key, value); }}
    />
  );
}

/**
 * `embedded`: the section sits inside another tab (its `parent`), so it renders
 * only its own view, or a heading and the generic form, and not the tab's wrapper.
 */
export function ContributedSection({ section, embedded }: { section: PreferencesSectionContribution; embedded?: boolean }) {
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
  const form = section.settingsGroup && <SettingsGroupForm group={section.settingsGroup} idPrefix={`settings-${section.id}`} />;
  if (embedded) {
    return (
      <>
        <div class="settings-panel__section-header">
          <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{title}</h4>
        </div>
        {form}
      </>
    );
  }
  return (
    <div class="settings-panel__section" data-section={section.id}>
      <h4 class="settings-panel__section-title">{title}</h4>
      {form}
    </div>
  );
}
