import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useOverlayDismissal } from '../../hooks/useOverlayDismissal';
import { BIBLE_FONT_MAX, BIBLE_FONT_MIN, updateBibleText } from '../../hooks/useCtrlWheelBibleSize';
import type { PickableFont } from '../../hooks/useOfferedFonts';
import {
  AVAILABLE_FONT_FAMILIES,
  usePreferencesStore,
} from '../../stores/usePreferencesStore';
import type { ColumnWidth, ScrollbarSize, TypographyPrefs, VerseLabelMode } from '../../stores/usePreferencesStore';
import type { DisplayMode } from '../../stores/bible/types';
import { AVAILABLE_FONTS, useTextSettingsStore } from '../../stores/useTextSettingsStore';
import { FontOptions } from '../PreferencesDialog/FontOptions';
import { TextWidthOptions } from '../PreferencesDialog/TypographySection';
import { useBiblePaneContext } from '../BiblePaneContext';
import { GearIcon } from './PassageSettingsMenu';
import ToolbarPopover from './ToolbarPopover';

/** Preferences > Typography's list (font id as the value) and Preferences > Fonts' list (face name). */
const TYPOGRAPHY_FONTS: PickableFont[] = AVAILABLE_FONT_FAMILIES.map(f => ({ ...f, value: f.id }));
const PANE_FONTS: PickableFont[] = AVAILABLE_FONTS.map(f => ({ ...f, value: f.name, stack: f.css }));

/** Which Typography width each display mode reads, and the mode's name for the label. */
const WIDTH_FOR_MODE: Record<DisplayMode, { key: keyof Pick<TypographyPrefs, 'standardWidth' | 'readingWidth' | 'studyWidth'>; modeLabelKey: string }> = {
  standard: { key: 'standardWidth', modeLabelKey: 'biblePane.displayModeStandard' },
  reading: { key: 'readingWidth', modeLabelKey: 'biblePane.displayModeReading' },
  study: { key: 'studyWidth', modeLabelKey: 'biblePane.displayModeStudy' },
};

/** Same range and step as the Typography slider. */
const LINE_HEIGHT_MIN = 1.2;
const LINE_HEIGHT_MAX = 2.5;

const selectClass = 'w-full px-2 py-1.5 rounded text-sm focus:outline-none';
const selectStyle: React.CSSProperties = {
  backgroundColor: 'var(--theme-input-bg)',
  border: '1px solid var(--theme-input-border)',
  color: 'var(--theme-input-text)',
};
const labelClass = 'block text-xs font-medium mb-1 text-text-secondary';
const stepButtonClass =
  'w-8 h-8 flex items-center justify-center rounded border border-border text-base hover:bg-background-hover disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * The Bible toolbar's gear: a panel with everything about how the Bible text
 * looks, changed in place while the text stays in view, plus a link to the full
 * Preferences page.
 *
 * Every control writes the same setting as its Preferences counterpart, so the
 * two never disagree:
 *
 *   - Text size and line height go where the Bible pane's values actually come
 *     from (`updateBibleText`): the pane's own override if Preferences > Fonts
 *     has customized it, otherwise Preferences > Typography. The font does the
 *     same, with the list that setting stores (font ids vs face names).
 *   - Red letters is the Bible pane setting from Preferences > Fonts.
 *   - Text width (for the display mode on screen; Parallel has none) and verse
 *     labels are Preferences > Typography > Reading layout.
 *   - Scrollbar size is Preferences > General (it applies app-wide; it is here
 *     because the Bible pane's scrollbar is the one most often reached for).
 *
 * Other reading panes keep the plain gear (`PassageSettingsMenu`), which opens
 * their font settings directly: they have nothing else to put in a panel.
 */
const BibleSettingsMenu: React.FC = () => {
  const { t, localizer } = useI18n();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const gearRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const { displayMode, isParallelViewMode } = useBiblePaneContext();
  const width = isParallelViewMode ? null : WIDTH_FOR_MODE[displayMode as DisplayMode] ?? WIDTH_FOR_MODE.standard;

  const close = React.useCallback(() => setOpen(false), []);
  useOverlayDismissal(open, close);

  const pane = useTextSettingsStore(s => s.settings.bible);
  const customized = useTextSettingsStore(s => s.customized.bible);
  const updatePane = useTextSettingsStore(s => s.updateSettings);
  const typography = usePreferencesStore(s => s.typography);
  const setTypography = usePreferencesStore(s => s.setTypography);
  const scrollbarSize = usePreferencesStore(s => s.scrollbarSize);
  const setScrollbarSize = usePreferencesStore(s => s.setScrollbarSize);

  // A dialog-style popover: focus goes into it on open and back to the gear on
  // close, unless the reader has already moved focus somewhere on purpose.
  const firstControlRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => firstControlRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      const active = document.activeElement;
      if (!active || active === document.body) gearRef.current?.focus();
    };
  }, [open]);

  const size = Math.round(pane.fontSize);
  const lineHeight = pane.lineHeight;

  const openAllSettings = () => {
    setOpen(false);
    // The section where this pane's font values live: Fonts once the Bible pane
    // has its own override there, Typography otherwise.
    if (customized) {
      window.dispatchEvent(new CustomEvent('open-preferences-fonts', { detail: 'bible' }));
    } else {
      window.dispatchEvent(new CustomEvent('open-preferences-section', { detail: 'typography' }));
    }
  };

  return (
    <div className="relative flex items-stretch" ref={anchorRef}>
      <button
        ref={gearRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        // Keep the document-level dismissal from closing the panel a beat
        // before this button's own click would toggle it back open.
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center px-2.5 text-text-secondary hover:bg-background-active transition-colors"
        style={{ borderInlineStart: '2px solid var(--theme-border-primary)', borderRadius: 0 }}
        title={t('biblePane.settingsPanelTitle')}
        aria-label={t('biblePane.settingsPanelTitle')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="passage-settings"
      >
        <GearIcon />
      </button>

      {open && (
        <ToolbarPopover
          anchorRef={anchorRef}
          align="end"
          minWidth={288}
          role="dialog"
          aria-label={t('biblePane.settingsPanelTitle')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div id={panelId} className="px-3 py-2 space-y-3" data-testid="bible-settings-panel">
            {/* Text size */}
            <div>
              <div id={`${panelId}-size`} className={labelClass}>
                {t('preferencesDialog.textSizeHeading')}
              </div>
              <div className="flex items-center gap-2" role="group" aria-labelledby={`${panelId}-size`}>
                <button
                  ref={firstControlRef}
                  type="button"
                  className={stepButtonClass}
                  onClick={() => updateBibleText({ fontSize: Math.max(BIBLE_FONT_MIN, size - 1) })}
                  disabled={size <= BIBLE_FONT_MIN}
                  aria-label={t('biblePane.settingsPanel.smallerText')}
                  title={t('biblePane.settingsPanel.smallerText')}
                  data-testid="bible-settings-smaller"
                >
                  <span aria-hidden="true">A−</span>
                </button>
                <output
                  className="flex-1 text-center text-sm tabular-nums"
                  aria-live="polite"
                  data-testid="bible-settings-size"
                >
                  {t('biblePane.settingsPanel.sizeValue', { size: localizer.formatNumber(size) })}
                </output>
                <button
                  type="button"
                  className={stepButtonClass}
                  onClick={() => updateBibleText({ fontSize: Math.min(BIBLE_FONT_MAX, size + 1) })}
                  disabled={size >= BIBLE_FONT_MAX}
                  aria-label={t('biblePane.settingsPanel.largerText')}
                  title={t('biblePane.settingsPanel.largerText')}
                  data-testid="bible-settings-larger"
                >
                  <span aria-hidden="true">A+</span>
                </button>
              </div>
            </div>

            {/* Font */}
            <div>
              <label htmlFor={`${panelId}-font`} className={labelClass}>
                {t('ui.preferences.fontFamilyLabel')}
              </label>
              {customized ? (
                <select
                  id={`${panelId}-font`}
                  value={pane.fontFamily}
                  onChange={(e) => updatePane('bible', { fontFamily: e.target.value })}
                  className={selectClass}
                  style={selectStyle}
                >
                  <FontOptions fonts={PANE_FONTS} value={pane.fontFamily} />
                </select>
              ) : (
                <select
                  id={`${panelId}-font`}
                  value={typography.bibleFontFamily}
                  onChange={(e) => setTypography({ bibleFontFamily: e.target.value })}
                  className={selectClass}
                  style={selectStyle}
                >
                  <FontOptions fonts={TYPOGRAPHY_FONTS} value={typography.bibleFontFamily} />
                </select>
              )}
            </div>

            {/* Line height */}
            <div>
              <label htmlFor={`${panelId}-line-height`} className={labelClass}>
                {t('preferencesDialog.lineHeightHeading')}:{' '}
                <span className="text-text-primary">
                  {localizer.formatNumber(lineHeight, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </label>
              <input
                id={`${panelId}-line-height`}
                type="range"
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={0.05}
                value={lineHeight}
                onChange={(e) => updateBibleText({ lineHeight: Number(e.target.value) })}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Red letters */}
            <label className="flex items-center gap-2 cursor-pointer" title={t('ui.preferences.showRedLetterHint')}>
              <input
                type="checkbox"
                checked={pane.showRedLetter ?? true}
                onChange={(e) => updatePane('bible', { showRedLetter: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--theme-accent-primary)' }}
              />
              <span className="text-sm text-text-primary">{t('ui.preferences.showRedLetter')}</span>
            </label>

            {/* Text width for the view on screen; Parallel fills the pane and has none. */}
            {width && (
              <div>
                <label htmlFor={`${panelId}-width`} className={labelClass}>
                  {t('biblePane.settingsPanel.textWidthForMode', { mode: t(width.modeLabelKey) })}
                </label>
                <select
                  id={`${panelId}-width`}
                  value={typography[width.key]}
                  onChange={(e) => setTypography({ [width.key]: e.target.value as ColumnWidth })}
                  className={selectClass}
                  style={selectStyle}
                  data-testid="bible-settings-width"
                >
                  <TextWidthOptions />
                </select>
              </div>
            )}

            {/* Verse labels */}
            <div>
              <label htmlFor={`${panelId}-labels`} className={labelClass}>
                {t('preferencesDialog.verseLabelsLabel')}
              </label>
              <select
                id={`${panelId}-labels`}
                value={typography.verseLabelMode}
                onChange={(e) => setTypography({ verseLabelMode: e.target.value as VerseLabelMode })}
                className={selectClass}
                style={selectStyle}
              >
                <option value="number">{t('preferencesDialog.verseLabelsNumber')}</option>
                <option value="chapterVerse">{t('preferencesDialog.verseLabelsChapterVerse')}</option>
                <option value="bookChapterVerse">{t('preferencesDialog.verseLabelsBookChapterVerse')}</option>
              </select>
            </div>

            {/* Scrollbar size (app-wide) */}
            <div>
              <label htmlFor={`${panelId}-scrollbar`} className={labelClass}>
                {t('preferencesDialog.scrollbarSizeLabel')}
              </label>
              <select
                id={`${panelId}-scrollbar`}
                value={scrollbarSize}
                onChange={(e) => setScrollbarSize(e.target.value as ScrollbarSize)}
                className={selectClass}
                style={selectStyle}
                data-testid="bible-settings-scrollbar"
              >
                <option value="standard">{t('preferencesDialog.scrollbarSizeStandard')}</option>
                <option value="large">{t('preferencesDialog.scrollbarSizeLarge')}</option>
              </select>
            </div>
          </div>

          <div className="border-t border-border mt-1 pt-1">
            <button
              type="button"
              onClick={openAllSettings}
              className="w-full text-start px-3 py-2 text-sm text-accent hover:bg-background-hover"
              data-testid="bible-settings-all"
            >
              {t('biblePane.settingsPanel.allSettings')}
            </button>
          </div>
        </ToolbarPopover>
      )}
    </div>
  );
};

export default BibleSettingsMenu;
