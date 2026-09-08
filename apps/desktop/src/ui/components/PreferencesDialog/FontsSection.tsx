/**
 * FontsSection.tsx
 *
 * "Fonts" tab of the Preferences dialog: a list of collapsible
 * per-pane font settings panels. Extracted from PreferencesDialog.tsx
 * as part of the 2026-04-14 desktop cleanup (item 2.1).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PaneType, useTextSettingsStore } from '../../stores/useTextSettingsStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { useI18n } from '../../contexts/useI18n';
import { PANE_NAME_KEYS } from '../../utils/paneNames';
import { PaneFontSettings } from './PaneFontSettings';

/**
 * The panes that get their own font panel, and the catalog key for each one's
 * sample text.
 *
 * Everything user-visible here is a **key**, resolved with `t()` inside the
 * component: this array is evaluated once at import, so a label resolved here
 * would freeze the locale that happened to be active first.
 *
 * The pane label is assembled from two keys rather than one - the bare noun
 * from `PANE_NAME_KEYS` placed into `preferencesDialog.paneFontLabel`
 * (`"{paneName} Pane"`) - so the word for *pane* stays inside the message and
 * an inflecting language can frame it (`Панель «Библия»`, `جزء «الكتاب المقدس»`).
 * See the Pane names table in `locales/GLOSSARY.md`.
 *
 * The Bible sample quotes John 3:16. Every locale must quote a **public-domain**
 * translation there and each locale's `meta.json` `locale.notes` records which
 * edition it uses and which copyrighted edition must not be substituted; `hi`
 * deliberately quotes no Scripture at all. See `locales/README.md`.
 */
const PANE_CONFIGS: Array<{ type: PaneType; sampleKey: string }> = [
  { type: 'bible', sampleKey: 'preferencesDialog.fontSampleBible' },
  { type: 'commentary', sampleKey: 'preferencesDialog.fontSampleCommentary' },
  { type: 'book', sampleKey: 'preferencesDialog.fontSampleBook' },
  { type: 'dictionary', sampleKey: 'preferencesDialog.fontSampleDictionary' }
];

export const FontsSection: React.FC<{ initialPane?: PaneType }> = ({ initialPane }) => {
  const { t } = useI18n();
  const { settings, updateSettings, resetSettings } = useTextSettingsStore();
  const { globalFontScale } = usePreferencesStore();
  const [expandedPane, setExpandedPane] = useState<PaneType | null>(initialPane ?? null);

  // When the section opens with a specific pane, expand it
  useEffect(() => {
    if (initialPane) {
      setExpandedPane(initialPane);
    }
  }, [initialPane]);

  const togglePane = useCallback((paneType: PaneType) => {
    setExpandedPane((prev) => (prev === paneType ? null : paneType));
  }, []);

  return (
    <div className="space-y-3">
      <p
        className="text-xs mb-4"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        {t('preferencesDialog.fontsIntro', { percent: Math.round(globalFontScale * 100) })}
      </p>

      {PANE_CONFIGS.map((config) => (
        <PaneFontSettings
          key={config.type}
          paneType={config.type}
          label={t('preferencesDialog.paneFontLabel', {
            // A nested catalog reference: `I18nService.resolveParams` flattens
            // `{ key }` to a string before ICU sees it.
            paneName: { key: PANE_NAME_KEYS[config.type] },
          })}
          sampleText={t(config.sampleKey)}
          settings={settings[config.type]}
          isExpanded={expandedPane === config.type}
          onToggle={() => togglePane(config.type)}
          onUpdate={(newSettings) => updateSettings(config.type, newSettings)}
          onReset={() => resetSettings(config.type)}
          globalFontScale={globalFontScale}
        />
      ))}
    </div>
  );
};
