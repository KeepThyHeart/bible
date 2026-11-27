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
import { FontOptions } from './FontOptions';
import type { PickableFont } from '../../hooks/useOfferedFonts';
import type { ColumnWidth, TypographyPrefs, VerseLabelMode } from '../../stores/usePreferencesStore';

/** The Typography list in the shape the shared font picker takes (id as the stored value). */
const FONT_PICKER_ENTRIES: PickableFont[] = AVAILABLE_FONT_FAMILIES.map(f => ({ ...f, value: f.id }));

/** The display modes that have a text width, in the order the Bible toolbar's mode menu lists them. */
const TEXT_WIDTH_ROWS: { key: keyof Pick<TypographyPrefs, 'standardWidth' | 'readingWidth' | 'studyWidth'>; modeLabelKey: string }[] = [
  { key: 'standardWidth', modeLabelKey: 'biblePane.displayModeStandard' },
  { key: 'readingWidth', modeLabelKey: 'biblePane.displayModeReading' },
  { key: 'studyWidth', modeLabelKey: 'biblePane.displayModeStudy' },
];

/** The four text widths, shared with the Bible toolbar's settings panel. */
export const TextWidthOptions: React.FC = () => {
  const { t } = useI18n();
  return (
    <>
      <option value="narrow">{t('preferencesDialog.textWidthNarrow')}</option>
      <option value="medium">{t('preferencesDialog.textWidthMedium')}</option>
      <option value="wide">{t('preferencesDialog.textWidthWide')}</option>
      <option value="full">{t('preferencesDialog.textWidthFull')}</option>
    </>
  );
};

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
  const { t, localizer } = useI18n();
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
            <FontOptions fonts={FONT_PICKER_ENTRIES} value={typography.bibleFontFamily} />
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
            <FontOptions fonts={FONT_PICKER_ENTRIES} value={typography.studyFontFamily} />
          </select>
        </div>

        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {t('preferencesDialog.fontInstallNote')}
        </p>
      </section>

      {/* --- Reading layout --- */}
      <section className="space-y-4" aria-labelledby="typography-layout-heading">
        <h4
          id="typography-layout-heading"
          className="text-sm font-semibold"
          style={{ color: 'var(--theme-text-heading)' }}
        >
          {t('preferencesDialog.readingLayoutHeading')}
        </h4>

        {/* Text width, one per display mode */}
        <div role="group" aria-labelledby="typography-text-width-label" aria-describedby="typography-text-width-description">
          <div
            id="typography-text-width-label"
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {t('preferencesDialog.textWidthLabel')}
          </div>
          <p
            id="typography-text-width-description"
            className="text-xs mb-2"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {t('preferencesDialog.textWidthDescription')}
          </p>
          <div className="grid gap-2 items-center" style={{ gridTemplateColumns: 'auto 1fr' }}>
            {TEXT_WIDTH_ROWS.map(({ key, modeLabelKey }) => (
              <React.Fragment key={key}>
                <label
                  htmlFor={`typography-text-width-${key}`}
                  className="text-sm"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {t(modeLabelKey)}
                </label>
                <select
                  id={`typography-text-width-${key}`}
                  value={typography[key]}
                  onChange={(e) => setTypography({ [key]: e.target.value as ColumnWidth })}
                  className="w-full px-3 py-2 rounded text-sm focus:outline-none"
                  style={{
                    backgroundColor: 'var(--theme-input-bg)',
                    border: '1px solid var(--theme-input-border)',
                    color: 'var(--theme-input-text)'
                  }}
                >
                  <TextWidthOptions />
                </select>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Verse labels */}
        <div>
          <label
            htmlFor="typography-verse-labels"
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            {t('preferencesDialog.verseLabelsLabel')}
          </label>
          <p
            id="typography-verse-labels-description"
            className="text-xs mb-2"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            {t('preferencesDialog.verseLabelsDescription')}
          </p>
          <select
            id="typography-verse-labels"
            aria-describedby="typography-verse-labels-description"
            value={typography.verseLabelMode}
            onChange={(e) => setTypography({ verseLabelMode: e.target.value as VerseLabelMode })}
            className="w-full px-3 py-2 rounded text-sm focus:outline-none"
            style={{
              backgroundColor: 'var(--theme-input-bg)',
              border: '1px solid var(--theme-input-border)',
              color: 'var(--theme-input-text)'
            }}
          >
            <option value="number">{t('preferencesDialog.verseLabelsNumber')}</option>
            <option value="chapterVerse">{t('preferencesDialog.verseLabelsChapterVerse')}</option>
            <option value="bookChapterVerse">{t('preferencesDialog.verseLabelsBookChapterVerse')}</option>
          </select>
        </div>
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
          displayValue={localizer.formatNumber(typography.bibleLineHeight, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          displayValue={localizer.formatNumber(typography.studyLineHeight, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          displayValue={localizer.formatNumber(typography.uiLineHeight, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
