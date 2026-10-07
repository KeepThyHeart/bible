/**
 * Settings > Apps (task 0080, row S1): the app switcher mode and the order /
 * hide list, shared `@bible/ui` AppsPreferences wired to the web settings
 * registry. These are UI preferences (device scope), allowed on the read-only web.
 */
import { useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { useTranslation } from 'react-i18next';
import { appSwitcherFromSettings, STUDY_APP_ID } from '@bible/core/browser';
import type { AppSwitcherMode } from '@bible/core/browser';
import { AppsPreferences } from '@bible/ui';
import type { AppsPreferencesItem, AppsPreferencesLabels } from '@bible/ui';
import { webSettings } from '../../stores/settingsRegistry';
import { useAppsPreferenceItems } from '../../host/navPrefs';
import { renderAppIcon, resolveLabel } from '../../host/appNavEntries';

export function AppsSettingsTab() {
  const { t, i18n } = useTranslation();
  const settings = useSyncExternalStore(webSettings.subscribe, webSettings.getSnapshot);
  const entries = useAppsPreferenceItems();
  const mode = appSwitcherFromSettings((key) => settings[key]);

  const items = useMemo<AppsPreferencesItem[]>(
    () => entries.map((e) => ({
      id: e.id,
      title: resolveLabel((key, fallback) => t(key, fallback), e.title),
      icon: renderAppIcon(e.icon),
      hidden: e.hidden,
      locked: e.locked,
    })),
    // `t` changes identity with the language.
    [entries, i18n?.language, t],
  );

  const labels: AppsPreferencesLabels = {
    switcherLabel: t('settings.apps.switcher', 'App switcher'),
    switcherHint: t('settings.apps.switcherHint', 'Show the app rail always, never, or only when more than one app is available.'),
    modeAuto: t('settings.apps.switcherAuto', 'Automatic'),
    modeRail: t('settings.apps.switcherRail', 'Always show the rail'),
    modeNone: t('settings.apps.switcherNone', 'No rail'),
    listLabel: t('settings.apps.listLabel', 'Apps'),
    listHint: t('settings.apps.listHint', 'Reorder apps or hide the ones you do not use.'),
    moveUp: t('settings.apps.moveUp', 'Move up'),
    moveDown: t('settings.apps.moveDown', 'Move down'),
    show: t('settings.apps.show', 'Show'),
    alwaysShown: t('settings.apps.alwaysShown', 'Always shown'),
  };

  const onHiddenChange = (id: string, hide: boolean) => {
    if (id === STUDY_APP_ID) return;
    // Start from the stored list: it also holds apps that are not available right now.
    const next = new Set(webSettings.get<string[]>('appHidden'));
    if (hide) next.add(id); else next.delete(id);
    webSettings.set('appHidden', [...next]);
  };

  return (
    <div class="settings-panel__section" data-section="apps">
      <h4 class="settings-panel__section-title">{t('settings.apps.title', 'Apps')}</h4>
      <AppsPreferences
        mode={mode}
        onModeChange={(m: AppSwitcherMode) => { webSettings.set('appSwitcher', m); }}
        items={items}
        onOrderChange={(ids) => {
          const keep = webSettings.get<string[]>('appOrder').filter((id) => !ids.includes(id));
          webSettings.set('appOrder', [...ids, ...keep]); // keep ids of apps not available right now
        }}
        onHiddenChange={onHiddenChange}
        labels={labels}
        idPrefix="settings-apps"
      />
    </div>
  );
}
