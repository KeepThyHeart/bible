import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore, DEFAULT_TYPOGRAPHY, AVAILABLE_THEMES, getFontFamilyStack } from './usePreferencesStore';
import { useTextSettingsStore } from './useTextSettingsStore';
import { THEME_TOKENS } from '../styles/themeTokens';

/**
 * Regression tests for the "font settings have no visible effect" bug.
 *
 * Root causes fixed:
 *  1. `--global-font-scale` was set on document.documentElement but nothing
 *     ever multiplied it into a rendered font-size (globals.css / themes.css
 *     now do, via calc() - not exercisable from a store-only test, so this
 *     file only asserts the CSS variable itself lands correctly).
 *  2. `--ui-font-size` / `--ui-font-family` / `--ui-line-height` were set but
 *     never consumed anywhere in CSS (now consumed by `body` in globals.css).
 *  3. useTextSettingsStore's per-pane settings always had a concrete numeric
 *     value present from first render, so the CSS fallback chain
 *     `var(--pane-font-size-bible, var(--bible-font-size, 20px))` always
 *     resolved to the pane override and the Typography section's sliders/
 *     font-family picker could never be seen. See useTextSettingsSync.test.ts
 *     for the store-to-store sync that fixes this.
 */
describe('usePreferencesStore - DOM application', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
    usePreferencesStore.setState({
      theme: 'light',
      globalFontScale: 1.0,
      uiControlFontSize: 14,
      typography: { ...DEFAULT_TYPOGRAPHY },
      advancedPaneManagerEnabled: false
    });
  });

  it('setTheme sets data-theme on the document root', () => {
    usePreferencesStore.getState().setTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('advancedPaneManagerEnabled defaults to false and setAdvancedPaneManagerEnabled updates it', () => {
    // KAN QA 4.5: drag-and-drop pane rearranging is opt-in, off by default.
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(false);

    usePreferencesStore.getState().setAdvancedPaneManagerEnabled(true);
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(true);

    usePreferencesStore.getState().setAdvancedPaneManagerEnabled(false);
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(false);
  });

  it('setGlobalFontScale writes --global-font-scale live', () => {
    usePreferencesStore.getState().setGlobalFontScale(1.25);
    expect(document.documentElement.style.getPropertyValue('--global-font-scale')).toBe('1.25');
  });

  it('setUiControlFontSize writes --ui-control-font-size live', () => {
    usePreferencesStore.getState().setUiControlFontSize(18);
    expect(document.documentElement.style.getPropertyValue('--ui-control-font-size')).toBe('18px');
  });

  it('setTypography writes every --bible-*/--study-*/--ui-* custom property live', () => {
    usePreferencesStore.getState().setTypography({
      bibleFontSize: 28,
      studyFontSize: 22,
      uiFontSize: 17,
      bibleLineHeight: 2.0,
      studyLineHeight: 1.9,
      uiLineHeight: 1.8,
      bibleFontFamily: 'lora',
      studyFontFamily: 'merriweather',
      uiFontFamily: 'garamond'
    });

    const root = document.documentElement.style;
    expect(root.getPropertyValue('--bible-font-size')).toBe('28px');
    expect(root.getPropertyValue('--study-font-size')).toBe('22px');
    expect(root.getPropertyValue('--ui-font-size')).toBe('17px');
    expect(root.getPropertyValue('--bible-line-height')).toBe('2');
    expect(root.getPropertyValue('--study-line-height')).toBe('1.9');
    expect(root.getPropertyValue('--ui-line-height')).toBe('1.8');
    expect(root.getPropertyValue('--bible-font-family')).toBe(getFontFamilyStack('lora'));
    expect(root.getPropertyValue('--study-font-family')).toBe(getFontFamilyStack('merriweather'));
    expect(root.getPropertyValue('--ui-font-family')).toBe(getFontFamilyStack('garamond'));
  });

  // Regression: chrome text in StudyPane/NoteEditor/NoteViewer used hardcoded
  // px literals that ignored the font preferences entirely. `--ui-font-scale`
  // is the ratio consumers multiply their own literal px values by (see
  // StudyPane.tsx's `uiScaled()`), mirroring the web app's own
  // `--ui-font-scale` (apps/web/src/stores/settingsStore.ts).
  it('setTypography derives --ui-font-scale as a ratio of uiFontSize to its default', () => {
    usePreferencesStore.getState().setTypography({ uiFontSize: DEFAULT_TYPOGRAPHY.uiFontSize * 2 });
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('2');

    usePreferencesStore.getState().setTypography({ uiFontSize: DEFAULT_TYPOGRAPHY.uiFontSize });
    expect(document.documentElement.style.getPropertyValue('--ui-font-scale')).toBe('1');
  });

  it('is a live update: a second setTypography call after the dialog has already applied one change still lands on the DOM', () => {
    usePreferencesStore.getState().setTypography({ bibleFontSize: 24 });
    expect(document.documentElement.style.getPropertyValue('--bible-font-size')).toBe('24px');

    usePreferencesStore.getState().setTypography({ bibleFontSize: 32 });
    expect(document.documentElement.style.getPropertyValue('--bible-font-size')).toBe('32px');
  });

  it('resetTypography restores DEFAULT_TYPOGRAPHY to both the store and the DOM', () => {
    usePreferencesStore.getState().setTypography({ bibleFontSize: 40 });
    usePreferencesStore.getState().resetTypography();

    expect(usePreferencesStore.getState().typography).toEqual(DEFAULT_TYPOGRAPHY);
    expect(document.documentElement.style.getPropertyValue('--bible-font-size'))
      .toBe(`${DEFAULT_TYPOGRAPHY.bibleFontSize}px`);
  });

  it('setTypography keeps useTextSettingsStore panes that are NOT customized in sync (the core fix)', () => {
    // A pane that has never been touched via the Fonts section must follow
    // the Typography section's Bible/Study sliders live.
    usePreferencesStore.getState().setTypography({ bibleFontSize: 30, bibleFontFamily: 'lora' });

    const bibleSettings = useTextSettingsStore.getState().getSettings('bible');
    expect(bibleSettings.fontSize).toBe(30);
    expect(bibleSettings.fontFamily).toBe(getFontFamilyStack('lora'));
  });
});

describe('DEFAULT_TYPOGRAPHY', () => {
  // The Study tab's default text was reported too small even though the
  // desktop/web defaults already matched (15px) - the actual fix was wiring
  // hardcoded chrome literals to the font preferences (see the
  // '--ui-font-scale' tests above and StudyPane.test.tsx), plus this small
  // bump to the shared default itself.
  it('studyFontSize defaults to 16', () => {
    expect(DEFAULT_TYPOGRAPHY.studyFontSize).toBe(16);
  });
});

describe('AVAILABLE_THEMES', () => {
  it('is generated from THEME_TOKENS and includes every theme (3 core + 12 ported)', () => {
    expect(AVAILABLE_THEMES).toHaveLength(THEME_TOKENS.length);
    expect(AVAILABLE_THEMES.length).toBe(15);
    const ids = AVAILABLE_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    expect(ids).toEqual(expect.arrayContaining(['light', 'dark', 'sepia']));
  });

  it('every theme carries labelKey/descriptionKey (never inline English)', () => {
    for (const theme of AVAILABLE_THEMES) {
      expect(theme.labelKey).toMatch(/^ui\.preferences\.theme[A-Za-z]+Label$/);
      expect(theme.descriptionKey).toMatch(/^ui\.preferences\.theme[A-Za-z]+Description$/);
    }
  });
});
