/**
 * TypographySection.tsx
 *
 * "Typography" tab of the Preferences dialog. Provides fine-grained
 * sliders for Bible / Study / UI text sizes and line heights (task #7)
 * and a font-family selector applied to Bible + Study text (task #8).
 *
 * All values are wired through usePreferencesStore, which sets CSS
 * variables (--bible-font-size, --bible-line-height, --bible-font-family,
 * --study-*, --ui-*) on document.documentElement. Those variables are
 * consumed by .pane-content-* rules in globals.css.
 */

import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import {
  AVAILABLE_FONT_FAMILIES,
  DEFAULT_TYPOGRAPHY,
  getFontFamilyStack,
  usePreferencesStore
} from '../../stores/usePreferencesStore';

interface SliderRowProps {
  /** DOM id for the range input; the label points at it with `htmlFor`. */
  id: string;
  /** Id of the section heading, so the slider's name says which group it is in. */
  groupLabelId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (n: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  id,
  groupLabelId,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange
}) => (
  <div>
    {/*
      `htmlFor` is what makes this a label rather than decoration. The slider is
      then named by its section heading *and* its own label, because "Bible
      text" alone appears three times in this panel - under Text Size, under
      Line Height, and in Font Family - and a bare repeated name tells a screen
      reader user nothing about which one they have landed on.
    */}
    <label
      id={`${id}-label`}
      htmlFor={id}
      className="block text-sm font-medium mb-1"
      style={{ color: 'var(--theme-text-primary)' }}
    >
      {label}: <span style={{ color: 'var(--theme-text-secondary)' }}>{displayValue}</span>
    </label>
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="text-xs w-8 text-end" style={{ color: 'var(--theme-text-muted)' }}>
        {min}
      </span>
      <input
        id={id}
        aria-labelledby={`${groupLabelId} ${id}-label`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
      />
      <span aria-hidden="true" className="text-xs w-8" style={{ color: 'var(--theme-text-muted)' }}>
        {max}
      </span>
    </div>
  </div>
);

export const TypographySection: React.FC = () => {
  const { t } = useI18n();
  const { typography, setTypography, resetTypography } = usePreferencesStore();

  // Shared between the Text Size and Line Height groups; the group heading is
  // what disambiguates them in the accessible name.
  const bibleTextLabel = t('preferencesDialog.sliderBibleText');
  const studyTextLabel = t('preferencesDialog.sliderStudyText');
  const uiTextLabel = t('preferencesDialog.sliderUiText');

  return (
    <div className="space-y-6">
      <p
        className="text-xs"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        {t('preferencesDialog.typographyIntro')}
      </p>

      {/* --- Font Family --- */}
      <section className="space-y-4" aria-labelledby="typography-font-family-heading">
        <h4
          id="typography-font-family-heading"
          className="text-sm font-semibold"
          style={{ color: 'var(--theme-text-heading)' }}
        >
          {t('preferencesDialog.fontFamilyHeading')}
        </h4>

        {/* Bible font */}
        <div>
          <label
            htmlFor="typography-bible-font-family"
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {t('preferencesDialog.bibleTextLabel')}
          </label>
          <select
            id="typography-bible-font-family"
            value={typography.bibleFontFamily}
            onChange={(e) => setTypography({ bibleFontFamily: e.target.value })}
            className="w-full px-3 py-2 rounded text-sm focus:outline-none"
            style={{
              backgroundColor: 'var(--theme-input-bg)',
              border: '1px solid var(--theme-input-border)',
              color: 'var(--theme-input-text)',
              fontFamily: getFontFamilyStack(typography.bibleFontFamily)
            }}
          >
            {AVAILABLE_FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                {f.labelKey ? t(f.labelKey, { fontName: f.label }) : f.label}
              </option>
            ))}
          </select>
          <div
            className="mt-2 rounded p-3"
            style={{
              backgroundColor: 'var(--theme-bg-primary)',
              border: '1px solid var(--theme-border-primary)',
              color: 'var(--theme-text-primary)',
              fontFamily: getFontFamilyStack(typography.bibleFontFamily),
              fontSize: `${typography.bibleFontSize}px`,
              lineHeight: typography.bibleLineHeight
            }}
          >
            {/*
              Scripture in the UI must come from the catalog so each locale can
              quote a public-domain edition of its own language - see
              locales/README.md. The English fallback here is the KJV, which is
              public domain.
            */}
            {t('preferencesDialog.typographyPreviewLine')}
          </div>
        </div>

        {/* Study font */}
        <div>
          <label
            htmlFor="typography-study-font-family"
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {t('preferencesDialog.studyPaneTextLabel')}
          </label>
          <select
            id="typography-study-font-family"
            value={typography.studyFontFamily}
            onChange={(e) => setTypography({ studyFontFamily: e.target.value })}
            className="w-full px-3 py-2 rounded text-sm focus:outline-none"
            style={{
              backgroundColor: 'var(--theme-input-bg)',
              border: '1px solid var(--theme-input-border)',
              color: 'var(--theme-input-text)',
              fontFamily: getFontFamilyStack(typography.studyFontFamily)
            }}
          >
            {AVAILABLE_FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                {f.labelKey ? t(f.labelKey, { fontName: f.label }) : f.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {t('preferencesDialog.fontInstallNote')}
        </p>
      </section>

      {/* --- Text Size --- */}
      <section className="space-y-4" aria-labelledby="typography-text-size-heading">
        <h4
          id="typography-text-size-heading"
          className="text-sm font-semibold"
          style={{ color: 'var(--theme-text-heading)' }}
        >
          {t('preferencesDialog.textSizeHeading')}
        </h4>

        <SliderRow
          id="typography-bible-font-size"
          groupLabelId="typography-text-size-heading"
          label={bibleTextLabel}
          value={typography.bibleFontSize}
          min={12}
          max={48}
          step={1}
          displayValue={`${typography.bibleFontSize}px`}
          onChange={(n) => setTypography({ bibleFontSize: n })}
        />

        <SliderRow
          id="typography-study-font-size"
          groupLabelId="typography-text-size-heading"
          label={studyTextLabel}
          value={typography.studyFontSize}
          min={12}
          max={36}
          step={1}
          displayValue={`${typography.studyFontSize}px`}
          onChange={(n) => setTypography({ studyFontSize: n })}
        />

        <SliderRow
          id="typography-ui-font-size"
          groupLabelId="typography-text-size-heading"
          label={uiTextLabel}
          value={typography.uiFontSize}
          min={10}
          max={24}
          step={1}
          displayValue={`${typography.uiFontSize}px`}
          onChange={(n) => setTypography({ uiFontSize: n })}
        />
      </section>

      {/* --- Line Height --- */}
      <section className="space-y-4" aria-labelledby="typography-line-height-heading">
        <h4
          id="typography-line-height-heading"
          className="text-sm font-semibold"
          style={{ color: 'var(--theme-text-heading)' }}
        >
          {t('preferencesDialog.lineHeightHeading')}
        </h4>

        <SliderRow
          id="typography-bible-line-height"
          groupLabelId="typography-line-height-heading"
          label={bibleTextLabel}
          value={typography.bibleLineHeight}
          min={1.2}
          max={2.5}
          step={0.05}
          displayValue={typography.bibleLineHeight.toFixed(2)}
          onChange={(n) => setTypography({ bibleLineHeight: n })}
        />

        <SliderRow
          id="typography-study-line-height"
          groupLabelId="typography-line-height-heading"
          label={studyTextLabel}
          value={typography.studyLineHeight}
          min={1.2}
          max={2.5}
          step={0.05}
          displayValue={typography.studyLineHeight.toFixed(2)}
          onChange={(n) => setTypography({ studyLineHeight: n })}
        />

        <SliderRow
          id="typography-ui-line-height"
          groupLabelId="typography-line-height-heading"
          label={uiTextLabel}
          value={typography.uiLineHeight}
          min={1.2}
          max={2.5}
          step={0.05}
          displayValue={typography.uiLineHeight.toFixed(2)}
          onChange={(n) => setTypography({ uiLineHeight: n })}
        />
      </section>

      {/* Reset */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={resetTypography}
          className="text-xs px-3 py-1.5 rounded transition-colors"
          style={{
            color: 'var(--theme-text-secondary)',
            border: '1px solid var(--theme-border-primary)'
          }}
          title={t(
            'preferencesDialog.resetTypographyTitle',
            { bible: DEFAULT_TYPOGRAPHY.bibleFontSize, study: DEFAULT_TYPOGRAPHY.studyFontSize, ui: DEFAULT_TYPOGRAPHY.uiFontSize, },
          )}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--theme-bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {t('preferencesDialog.resetToDefaults')}
        </button>
      </div>
    </div>
  );
};
