/**
 * AppsSection.tsx
 *
 * "Apps" tab of the Preferences dialog (task 0080, row S1): the app switcher
 * mode and the order / hide list, through the shared `@bible/ui`
 * AppsPreferences. Writes the preferences store (the persisted source of
 * truth); the settings registry mirrors it.
 */
import React, { useMemo } from 'react';
import { AppsPreferences } from '@bible/ui';
import type { AppsPreferencesItem, AppsPreferencesLabels } from '@bible/ui';
import { STUDY_APP_ID } from '@bible/core/browser';
import { useI18n } from '../../contexts/useI18n';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { useAppsPreferenceItems } from '../../apps/navPrefs';
import { resolveLabelRef } from '../../apps/navEntries';
import { AppIconGlyph } from '../../apps/AppIconGlyph';
import { translateWithDefault } from '../../utils/translateWithDefault';

export const AppsSection: React.FC = () => {
  const { t, i18n } = useI18n();
  const entries = useAppsPreferenceItems();
  const mode = usePreferencesStore((s) => s.appSwitcher);
  const setAppSwitcher = usePreferencesStore((s) => s.setAppSwitcher);
  const setAppOrder = usePreferencesStore((s) => s.setAppOrder);
  const setAppHidden = usePreferencesStore((s) => s.setAppHidden);

  const items = useMemo<AppsPreferencesItem[]>(
    () => entries.map((e) => ({
      id: e.id,
      title: resolveLabelRef(e.title, t, i18n),
      icon: <AppIconGlyph icon={e.icon} />,
      hidden: e.hidden,
      locked: e.locked,
    })),
    [entries, t, i18n],
  );

  const labels: AppsPreferencesLabels = {
    switcherLabel: translateWithDefault(t, 'settings.apps.switcher', 'App switcher'),
    switcherHint: translateWithDefault(t, 'settings.apps.switcherHint', 'Show the app rail always, never, or only when more than one app is available.'),
    modeAuto: translateWithDefault(t, 'settings.apps.switcherAuto', 'Automatic'),
    modeRail: translateWithDefault(t, 'settings.apps.switcherRail', 'Always show the rail'),
    modeNone: translateWithDefault(t, 'settings.apps.switcherNone', 'No rail'),
    listLabel: translateWithDefault(t, 'settings.apps.listLabel', 'Apps'),
    listHint: translateWithDefault(t, 'settings.apps.listHint', 'Reorder apps or hide the ones you do not use.'),
    moveUp: translateWithDefault(t, 'settings.apps.moveUp', 'Move up'),
    moveDown: translateWithDefault(t, 'settings.apps.moveDown', 'Move down'),
    show: translateWithDefault(t, 'settings.apps.show', 'Show'),
    alwaysShown: translateWithDefault(t, 'settings.apps.alwaysShown', 'Always shown'),
  };

  const onHiddenChange = (id: string, hide: boolean) => {
    if (id === STUDY_APP_ID) return;
    // Start from the stored list: it also holds apps that are not available right now.
    const next = new Set(usePreferencesStore.getState().appHidden); // allow-getstate: event handler reads the current stored list
    if (hide) next.add(id); else next.delete(id);
    setAppHidden([...next]);
  };

  return (
    <div data-testid="apps-section">
      <AppsPreferences
        mode={mode}
        onModeChange={setAppSwitcher}
        items={items}
        onOrderChange={(ids) => {
          const keep = usePreferencesStore.getState().appOrder.filter((id) => !ids.includes(id)); // allow-getstate: event handler
          setAppOrder([...ids, ...keep]); // keep ids of apps not available right now
        }}
        onHiddenChange={onHiddenChange}
        labels={labels}
        idPrefix="pref-apps"
      />
    </div>
  );
};

export default AppsSection;
