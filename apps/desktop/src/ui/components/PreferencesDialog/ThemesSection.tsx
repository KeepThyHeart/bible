/**
 * ThemesSection.tsx
 *
 * "Themes" tab of the Preferences dialog: theme selection grid plus
 * a live preview pane. Extracted from PreferencesDialog.tsx as part
 * of the 2026-04-14 desktop cleanup (item 2.1).
 */

import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { tElements } from '../../utils/tElements';
import { AVAILABLE_THEMES, ThemeOption, usePreferencesStore } from '../../stores/usePreferencesStore';

interface ThemeCardProps {
  theme: ThemeOption;
  isSelected: boolean;
  onSelect: () => void;
}

const ThemeCard: React.FC<ThemeCardProps> = ({ theme, isSelected, onSelect }) => {
  // Resolved here, per render - not where AVAILABLE_THEMES is declared. A
  // module-load resolution would bake in whichever locale loaded first and
  // never update when the user switches language.
  const { t } = useI18n();
  return (
    <button
      onClick={onSelect}
      className="rounded-lg p-4 text-start transition-all"
      style={{
        border: isSelected
          ? '2px solid var(--theme-accent-primary)'
          : '2px solid var(--theme-border-primary)',
        backgroundColor: 'var(--theme-surface-secondary)',
        boxShadow: isSelected ? '0 0 0 1px var(--theme-accent-primary)' : 'none'
      }}
    >
      {/* Color preview block */}
      <div
        className="rounded-md mb-3 h-20 flex flex-col justify-between p-2 overflow-hidden"
        style={{
          backgroundColor: theme.preview.bg,
          border: `1px solid ${theme.preview.border}`
        }}
      >
        {/* Mini header bar */}
        <div className="flex items-center gap-1">
          <div
            className="w-8 h-1.5 rounded"
            style={{ backgroundColor: theme.preview.accent }}
          />
          <div
            className="w-5 h-1.5 rounded"
            style={{ backgroundColor: theme.preview.border }}
          />
        </div>
        {/* Mini text lines */}
        <div className="space-y-1">
          <div
            className="w-full h-1 rounded"
            style={{ backgroundColor: theme.preview.text, opacity: 0.6 }}
          />
          <div
            className="w-3/4 h-1 rounded"
            style={{ backgroundColor: theme.preview.text, opacity: 0.4 }}
          />
          <div
            className="w-5/6 h-1 rounded"
            style={{ backgroundColor: theme.preview.text, opacity: 0.5 }}
          />
        </div>
      </div>

      {/* Label and selection indicator */}
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-sm font-semibold"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {t(theme.labelKey)}
          </div>
          <div
            className="text-xs mt-0.5"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {t(theme.descriptionKey)}
          </div>
        </div>
        {isSelected && (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ms-2"
            style={{ backgroundColor: 'var(--theme-accent-primary)' }}
          >
            <svg className="w-3 h-3 text-text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        )}
      </div>
    </button>
  );
};

const ThemePreviewPane: React.FC = () => {
  const { t } = useI18n();
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--theme-border-primary)',
        backgroundColor: 'var(--theme-bg-primary)'
      }}
    >
      {/* Simulated pane header */}
      <div
        className="flex items-center gap-2 px-4 py-2"
        style={{
          backgroundColor: 'var(--theme-pane-header-bg)',
          borderBottom: '1px solid var(--theme-pane-header-border)'
        }}
      >
        <span
          className="text-xs font-medium px-2 py-1 rounded"
          style={{
            backgroundColor: 'var(--theme-tab-active-bg)',
            color: 'var(--theme-tab-active-text)',
            borderBottom: '2px solid var(--theme-tab-active-border)'
          }}
        >
          {t('ui.preferences.themePreviewTab1')}
        </span>
        <span
          className="text-xs px-2 py-1"
          style={{ color: 'var(--theme-tab-text)' }}
        >
          {t('ui.preferences.themePreviewTab2')}
        </span>
      </div>

      {/*
        Simulated Bible text. Both lines live in the catalog, and every locale
        must quote a PUBLIC-DOMAIN translation - see the "Scripture quoted
        inside UI strings" rule in locales/README.md and the per-locale
        `locale.notes` in meta.json. `hi` deliberately quotes no Scripture at
        all and uses plain sample prose here.

        The link phrase is an element placeholder inside the whole sentence
        rather than a fragment concatenated around it, so the translator
        controls where in the clause it falls - hardcoding the English clause
        order would render every non-English locale as
        "...but have <translated fragment>.".
      */}
      <div className="px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        <p style={{ color: 'var(--theme-text-primary)', fontSize: '16px', lineHeight: 1.7 }}>
          <span style={{ color: 'var(--theme-text-secondary)', fontWeight: 'bold', fontSize: '12px', marginInlineEnd: '4px' }}>16</span>
          {tElements(t, 'ui.preferences.themePreviewLine1', {
            link: (
              <span style={{ color: 'var(--theme-link-color)', textDecoration: 'underline', cursor: 'pointer' }}>
                {t('ui.preferences.themePreviewLink')}
              </span>
            ),
          })}
        </p>
        <p className="mt-2" style={{ color: 'var(--theme-text-primary)', fontSize: '16px', lineHeight: 1.7 }}>
          <span style={{ color: 'var(--theme-text-secondary)', fontWeight: 'bold', fontSize: '12px', marginInlineEnd: '4px' }}>17</span>
          {t('ui.preferences.themePreviewLine2')}
        </p>
      </div>
    </div>
  );
};

export const ThemesSection: React.FC = () => {
  const { theme, setTheme } = usePreferencesStore();
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <p
        className="text-xs"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        {t('ui.preferences.themesIntro')}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {AVAILABLE_THEMES.map((themeOption) => (
          <ThemeCard
            key={themeOption.id}
            theme={themeOption}
            isSelected={theme === themeOption.id}
            onSelect={() => setTheme(themeOption.id)}
          />
        ))}
      </div>

      {/* Visual preview */}
      <div>
        <label
          className="block text-xs font-medium mb-2"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          {t('ui.preferences.themePreviewLabel')}
        </label>
        <ThemePreviewPane />
      </div>
    </div>
  );
};
