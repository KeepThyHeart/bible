/**
 * GeneralSection.tsx
 *
 * "General" tab of the Preferences dialog: UI language, global font scale and
 * UI control font size sliders. Extracted from PreferencesDialog.tsx as
 * part of the 2026-04-14 desktop cleanup (item 2.1).
 *
 * The language picker is the app's ONLY entry point into `setLocale()`. It is
 * driven by `i18n.availableLocaleInfos`, i.e. by whichever locale folders
 * happen to be present - built-in ones plus anything a user dropped into
 * `<userData>/locales/` - passed through `selectableLocales()` below, which is
 * the single gate on which of the *shipped* catalogs are offered.
 */

import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import type { LocaleMetadata } from '../../services/II18nService';

/**
 * True when a locale code is a real BCP-47 tag that assistive tech can act on.
 *
 * The catalog set includes `xx-pseudo`, a development pseudo-locale. Its
 * primary subtag is not a registered language, so it must never reach a `lang`
 * attribute.
 */
function isRealLocale(code: string): boolean {
  return !code.startsWith('xx');
}

/**
 * Locale codes whose catalogs ship inside the app bundle
 * (`apps/desktop/locales/`).
 *
 * This exists only so `selectableLocales()` can tell an app-supplied catalog
 * apart from one a user dropped into `<userData>/locales/`: `LocaleMetadata`
 * carries no provenance field, and the IPC bridge deliberately merges both
 * sources into one list. Adding a provenance field would mean changing
 * `I18nService` and every other consumer of that list for the sake of one
 * picker, so the built-in set is named here instead.
 *
 * Keep in step with the folder listing when a catalog is added or removed. A
 * code missing from this list is simply treated as user-supplied and shown,
 * which is the safe direction to fail: it can never hide a language a user
 * installed themselves.
 */
const BUILT_IN_LOCALES: readonly string[] = [
  'ar', 'en', 'es', 'hi', 'pt-BR', 'ru', 'xx-pseudo', 'zh-Hans',
];

/**
 * >> THE ONE PLACE TO WIDEN WHEN ANOTHER LANGUAGE IS READY TO SHIP. <<
 *
 * Which of the BUILT-IN catalogs the app offers as a UI language. Every
 * shipped catalog other than `en` is machine-drafted and has never been
 * through native-speaker review, so offering them invites a user to switch the
 * whole interface into a translation we cannot stand behind - and, once
 * switched, to a UI they may not be able to read well enough to switch back.
 *
 * Add a code here (and nowhere else) to make that language selectable; the two
 * pickers - this section and `onboarding/LanguageFirstRun.tsx` - both go
 * through `selectableLocales()`, so there is nothing else to change.
 *
 * This deliberately does NOT gate user-supplied locales: a folder dropped into
 * `<userData>/locales/` is the user's own translation and keeps working with
 * no code change, which is the whole point of that mechanism.
 */
export const SELECTABLE_BUILT_IN_LOCALES: readonly string[] = ['en'];

/**
 * The locales a picker may offer: every user-supplied one, plus the built-in
 * ones named in `SELECTABLE_BUILT_IN_LOCALES`.
 *
 * `activeLocale` is always kept, so a user who selected a language before it
 * was withdrawn still sees their current choice in the list rather than a
 * radiogroup with nothing checked.
 */
export function selectableLocales(
  infos: readonly LocaleMetadata[],
  activeLocale?: string,
): LocaleMetadata[] {
  return infos.filter(
    (info) =>
      info.code === activeLocale ||
      !BUILT_IN_LOCALES.includes(info.code) ||
      SELECTABLE_BUILT_IN_LOCALES.includes(info.code),
  );
}

/**
 * One selectable language.
 *
 * `status !== 'complete'` MUST render the draft badge. Draft locales are
 * machine-drafted and unreviewed; the badge is the app's only honest signal
 * of that, and hiding it would imply a native-speaker review that never
 * happened. See locales/README.md.
 */
const LocaleOption: React.FC<{
  info: LocaleMetadata;
  selected: boolean;
  draftLabel: string;
  onSelect: (code: string) => void;
}> = ({ info, selected, draftLabel, onSelect }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    /*
      Only tag real BCP-47 locales. `xx-pseudo` is a development pseudo-locale
      whose primary subtag is not a registered language, and announcing it as
      one makes a screen reader try to switch voices to a language that does
      not exist (WCAG 3.1.2 / axe `valid-lang`).
    */
    lang={isRealLocale(info.code) ? info.code : undefined}
    data-testid={`locale-option-${info.code}`}
    onClick={() => onSelect(info.code)}
    className="w-full flex items-center gap-3 px-3 py-2 rounded text-start transition-colors"
    style={{
      backgroundColor: selected ? 'var(--theme-accent-soft)' : 'transparent',
      border: `1px solid ${selected ? 'var(--theme-accent-primary)' : 'var(--theme-border-primary)'}`,
    }}
  >
    {/* <bdi> around the endonym: العربية must not reorder the row it sits in
        while the UI is still English, and "English" must not reorder the row
        once the UI is Arabic. Isolation (rather than dir="auto") keeps every
        row aligned to the same edge, so the list reads as a column. */}
    <span className="flex-1 min-w-0">
      <bdi
        className="block text-sm font-medium truncate"
        style={{ color: 'var(--theme-text-primary)' }}
      >
        {info.nativeName}
      </bdi>
      <bdi
        className="block text-xs truncate"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        {info.name} ({info.code})
      </bdi>
    </span>
    {info.status !== 'complete' && (
      <span
        data-testid={`locale-draft-badge-${info.code}`}
        className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded"
        style={{
          backgroundColor: 'var(--theme-bg-tertiary)',
          color: 'var(--theme-text-secondary)',
          border: '1px solid var(--theme-border-primary)',
        }}
      >
        {draftLabel}
      </span>
    )}
    {selected && (
      /* aria-checked already carries this; the glyph is decoration. */
      <span aria-hidden="true" className="flex-shrink-0 text-sm" style={{ color: 'var(--theme-accent-primary)' }}>
        {'✓'}
      </span>
    )}
  </button>
);

export const GeneralSection: React.FC = () => {
  const { t, i18n, locale } = useI18n();
  const {
    globalFontScale, setGlobalFontScale,
    uiControlFontSize, setUiControlFontSize,
    advancedPaneManagerEnabled, setAdvancedPaneManagerEnabled,
  } = usePreferencesStore();

  const scalePercent = Math.round(globalFontScale * 100);

  const localeInfos = selectableLocales(i18n.availableLocaleInfos, locale);
  const draftLabel = t('preferencesDialog.localeDraftBadge');

  // Collapsed by default: language is the one setting in this dialog that can
  // make every other setting unreadable, and this section is the first thing
  // in the first tab, so left expanded a stray click on a row would switch
  // the whole UI. A disclosure makes that a deliberate act.
  const [languageExpanded, setLanguageExpanded] = React.useState(false);

  // The endonym of the active locale, resolved from the UNFILTERED list so it
  // is still nameable if the user is on a locale that is no longer offered.
  const activeLocaleName =
    i18n.availableLocaleInfos.find((info) => info.code === locale)?.nativeName ?? locale;

  // The draft badge and its footnote only mean something when a draft locale
  // is actually on offer; with English alone they are noise.
  const anyDraftListed = localeInfos.some((info) => info.status !== 'complete');

  return (
    <div className="space-y-8">
      {/* -- UI Language --------------------------------------------- */}
      {/*
        Same disclosure shape as PaneFontSettings.tsx (the dialog's only other
        collapsible): chevron rotated when open, mirrored under RTL, content
        mounted only while expanded. The header keeps naming the active
        language, so the disclosure hides the *choice*, never the state.
      */}
      <div
        className="rounded-lg overflow-hidden"
        style={{
          border: '1px solid var(--theme-border-primary)',
          backgroundColor: languageExpanded ? 'var(--theme-surface-secondary)' : 'transparent',
        }}
      >
        <button
          type="button"
          onClick={() => setLanguageExpanded((expanded) => !expanded)}
          aria-expanded={languageExpanded}
          aria-controls="preferences-language-panel"
          data-testid="language-disclosure"
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors"
          style={{ color: 'var(--theme-text-primary)' }}
          onMouseEnter={(e) => {
            if (!languageExpanded) {
              e.currentTarget.style.backgroundColor = 'var(--theme-bg-hover)';
            }
          }}
          onMouseLeave={(e) => {
            if (!languageExpanded) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <span id="preferences-language-label" className="flex items-center gap-2 min-w-0">
            <svg
              className={`w-4 h-4 flex-shrink-0 transition-transform ${languageExpanded ? 'rotate-90' : ''} rtl-mirror`}
              aria-hidden="true"
              focusable="false"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            {t('preferencesDialog.languageLabel')}
          </span>
          {/* <bdi> for the same reason as the rows below: an endonym in another
              script must not reorder the header it sits in. */}
          <bdi
            className="text-xs truncate"
            style={{ color: 'var(--theme-text-muted)' }}
            data-testid="language-current"
          >
            {activeLocaleName}
          </bdi>
        </button>

        {languageExpanded && (
          <div className="px-4 pb-4" id="preferences-language-panel">
            <p
              id="preferences-language-description"
              className="text-xs mb-3"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {t('preferencesDialog.languageDescription')}
            </p>
            {/*
              The radiogroup is labelled by the disclosure header's own label
              span - a bare <label> would point at no control, since this is a
              radiogroup rather than a form field.
            */}
            <div
              role="radiogroup"
              aria-labelledby="preferences-language-label"
              aria-describedby="preferences-language-description"
              className="space-y-1.5 max-h-64 overflow-y-auto"
              data-testid="language-picker"
            >
              {localeInfos.map((info) => (
                <LocaleOption
                  key={info.code}
                  info={info}
                  selected={info.code === locale}
                  draftLabel={draftLabel}
                  onSelect={(code) => { void i18n.setLocale(code); }}
                />
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--theme-text-muted)' }}>
              {anyDraftListed
                ? t('preferencesDialog.languageDraftNote')
                : t('preferencesDialog.languageMoreComingNote')}
            </p>
          </div>
        )}
      </div>

      {/* Global Font Scale */}
      <div>
        <label
          htmlFor="preferences-global-font-scale"
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--theme-text-primary)' }}
        >
          {t('preferencesDialog.globalFontScaleLabel', { percent: scalePercent, })}
        </label>
        <p
          id="preferences-global-font-scale-description"
          className="text-xs mb-3"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          {t('preferencesDialog.globalFontScaleDescription')}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={t('preferencesDialog.decreaseFontScale')}
            onClick={() => setGlobalFontScale(Math.max(0.7, globalFontScale - 0.05))}
            className="w-8 h-8 rounded flex items-center justify-center text-lg font-bold transition-colors"
            style={{
              backgroundColor: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-primary)',
              border: '1px solid var(--theme-border-primary)'
            }}
            title={t('preferencesDialog.decreaseFontScale')}
          >
            -
          </button>
          <input
            id="preferences-global-font-scale"
            aria-describedby="preferences-global-font-scale-description"
            type="range"
            min="70"
            max="150"
            step="5"
            value={scalePercent}
            onChange={(e) => setGlobalFontScale(Number(e.target.value) / 100)}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
          />
          <button
            type="button"
            aria-label={t('preferencesDialog.increaseFontScale')}
            onClick={() => setGlobalFontScale(Math.min(1.5, globalFontScale + 0.05))}
            className="w-8 h-8 rounded flex items-center justify-center text-lg font-bold transition-colors"
            style={{
              backgroundColor: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-primary)',
              border: '1px solid var(--theme-border-primary)'
            }}
            title={t('preferencesDialog.increaseFontScale')}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setGlobalFontScale(1.0)}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{
              color: 'var(--theme-accent-primary)',
              border: '1px solid var(--theme-border-primary)'
            }}
            title={t('preferencesDialog.resetTo100')}
            aria-label={t('preferencesDialog.resetTo100')}
          >
            {t('preferencesDialog.reset')}
          </button>
        </div>
        {/* Scale ticks - the slider already reports its value and range. */}
        <div
          aria-hidden="true"
          className="flex justify-between text-xs mt-1"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <span>70%</span>
          <span>100%</span>
          <span>150%</span>
        </div>
      </div>

      {/* UI Control Font Size */}
      <div>
        <label
          htmlFor="preferences-ui-control-font-size"
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--theme-text-primary)' }}
        >
          {t('preferencesDialog.uiControlFontSizeLabel', { size: uiControlFontSize, })}
        </label>
        <p
          id="preferences-ui-control-font-size-description"
          className="text-xs mb-3"
          style={{ color: 'var(--theme-text-secondary)' }}
        >
          {t('preferencesDialog.uiControlFontSizeDescription')}
        </p>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>11px</span>
          <input
            id="preferences-ui-control-font-size"
            aria-describedby="preferences-ui-control-font-size-description"
            type="range"
            min="11"
            max="20"
            step="1"
            value={uiControlFontSize}
            onChange={(e) => setUiControlFontSize(Number(e.target.value))}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
          />
          <span aria-hidden="true" className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>20px</span>
          <button
            type="button"
            onClick={() => setUiControlFontSize(14)}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{
              color: 'var(--theme-accent-primary)',
              border: '1px solid var(--theme-border-primary)'
            }}
            title={t('preferencesDialog.resetTo14')}
            aria-label={t('preferencesDialog.resetTo14')}
          >
            {t('preferencesDialog.reset')}
          </button>
        </div>
        {/* Preview of UI control size */}
        <div
          className="mt-3 p-3 rounded"
          style={{
            backgroundColor: 'var(--theme-surface-secondary)',
            border: '1px solid var(--theme-border-primary)'
          }}
        >
          <span
            className="font-medium"
            style={{ color: 'var(--theme-text-secondary)', fontSize: `${uiControlFontSize}px` }}
          >
            {t('preferencesDialog.uiControlPreview')}
          </span>
        </div>
      </div>

      {/* Advanced Pane Manager (KAN QA 4.5) */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={advancedPaneManagerEnabled}
            onChange={(e) => setAdvancedPaneManagerEnabled(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--theme-accent-primary)' }}
            data-testid="advanced-pane-manager-checkbox"
          />
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            {t('preferencesDialog.advancedPaneManagerLabel')}
          </span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('preferencesDialog.advancedPaneManagerDescription')}
        </p>
      </div>
    </div>
  );
};
