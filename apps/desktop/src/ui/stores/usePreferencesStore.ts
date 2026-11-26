import { create } from 'zustand';
import { whenContextService } from '../services/WhenContextService';
import { preferencesChanged } from '../modules/host/readerHooks';
import { useTextSettingsStore } from './useTextSettingsStore';
import type { SearchResultsPlacement } from './useLayoutStore';
import type { AppSwitcherMode, FontKind, FontOrigin } from '@bible/core/browser';
import { FONT_CATALOG } from '@bible/core/browser';
import { THEME_TOKENS, isValidThemeId, type ThemeId } from '../styles/themeTokens';

/**
 * Theme type - the available visual themes.
 *
 * Re-exported from styles/themeTokens.ts, which is the single list of
 * selectable themes (id, order, dark/light polarity, catalog keys, preview
 * swatch) that both this store's `AVAILABLE_THEMES` and `styles/themes.css`'s
 * `[data-theme="<id>"]` blocks are meant to agree with. See that file's doc
 * comment for why the *palette* itself still lives in themes.css rather than
 * here.
 */
export type { ThemeId };
export { isValidThemeId };

/**
 * Typography font family option shown in the font-family picker.
 *
 * Fonts that are not universally installed (Lora, Merriweather,
 * EB Garamond) are declared in styles/fonts.css with sensible
 * fallback stacks; the OS resolves them to the nearest available
 * face if the primary is missing. Actual @font-face web-font files
 * are NOT bundled today - see PORTING NOTE in fonts.css.
 */
export interface FontFamilyOption {
  id: string;
  /**
   * The typeface's own name. A proper noun - never translated, and shown as-is
   * unless `labelKey` says otherwise.
   */
  label: string;
  /**
   * Catalog key for options whose label is prose rather than a typeface name
   * ("System Default"). Resolve with `t()` at render time - resolving here, at
   * module load, would freeze whichever locale was active first. Receives
   * `{ fontName }` so a key may wrap the face name.
   */
  labelKey?: string;
  /** CSS font-family stack (with fallbacks) */
  stack: string;
  /** Serif or sans, for grouping the picker. Absent on System Default. */
  kind?: FontKind;
  /** The family looked for on this machine (catalogue entries only). */
  family?: string;
  /** `bundled` faces are always offered; the rest only where installed. */
  origin?: FontOrigin;
}

/**
 * Every font the Typography pickers can store: System Default plus the whole curated catalogue
 * (`FONT_CATALOG` in `@bible/core`, shared with the per-pane list and the web app). This list is what saved
 * settings are validated against, so it is deliberately NOT filtered by what is installed - a choice made on
 * another machine survives. The pickers filter with `useOfferedFonts`.
 */
export const AVAILABLE_FONT_FAMILIES: FontFamilyOption[] = [
  { id: 'system', label: 'System Default', labelKey: 'preferencesDialog.fontSystemDefault', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  ...FONT_CATALOG.map((f): FontFamilyOption => ({ id: f.id, label: f.label, stack: f.stack, kind: f.kind, family: f.family, origin: f.origin })),
];

export function getFontFamilyStack(id: string): string {
  const opt = AVAILABLE_FONT_FAMILIES.find(f => f.id === id);
  return opt?.stack ?? AVAILABLE_FONT_FAMILIES[0].stack;
}

/**
 * Theme definition for display purposes.
 *
 * The name and description are **catalog keys, not text**. Plain English
 * strings in this module would mean every locale renders "Light / Clean,
 * bright interface with white backgrounds" verbatim. Storing the key and
 * resolving it with `t()` at render time is what makes a locale change
 * re-render the theme cards: resolving to a string here - at module load -
 * would freeze whichever locale happened to be active first.
 */
export interface ThemeOption {
  id: ThemeId;
  /** Catalog key for the theme's display name. Resolve with `t()` at render time. */
  labelKey: string;
  /** Catalog key for the one-line description. Resolve with `t()` at render time. */
  descriptionKey: string;
  /** Preview colors for the theme card */
  preview: {
    bg: string;
    text: string;
    accent: string;
    border: string;
  };
}

/**
 * Available themes with their display metadata.
 *
 * Generated from `styles/themeTokens.ts` - the single list of selectable
 * themes - rather than hand-duplicated here, so adding a theme to that file
 * (plus its `[data-theme]` block in themes.css) is the only place-to-edit for
 * a new theme to show up in the Themes section.
 */
export const AVAILABLE_THEMES: ThemeOption[] = THEME_TOKENS.map((token) => ({
  id: token.id,
  labelKey: token.labelKey,
  descriptionKey: token.descriptionKey,
  preview: token.preview
}));

import { markSessionDirty } from './helpers/sessionNotifier';
import { registerSessionSerializer } from './helpers/sessionRegistry';
import { registerPrivacyPrefsReader } from './helpers/privacyPrefs';

/**
 * Fine-grained typography preferences (Bible / Study / UI).
 * These are separate from the per-pane settings in useTextSettingsStore -
 * they set global CSS variables consumed by pane styles.
 */
/** What stands beside each verse: the number, `chapter:verse`, or an abbreviated `Book chapter:verse`. */
export type VerseLabelMode = 'number' | 'chapterVerse' | 'bookChapterVerse';
const VERSE_LABEL_MODES: readonly VerseLabelMode[] = ['number', 'chapterVerse', 'bookChapterVerse'];

/**
 * How wide the Bible text column may grow in a wide pane, set separately for each display mode
 * (`standardWidth`, `readingWidth`, `studyWidth`), so Standard can fill the pane while Reading keeps a
 * book-like measure. `medium` is the long-standing cap. Parallel view has no cap.
 */
export type ColumnWidth = 'narrow' | 'medium' | 'wide' | 'full';
const COLUMN_WIDTHS: readonly ColumnWidth[] = ['narrow', 'medium', 'wide', 'full'];
/**
 * Column cap per width as [Standard/Reading, Study] CSS lengths. Rem, so the default equals the old
 * max-w-3xl / max-w-4xl. Study's caps are a step wider because its column carries the interlinear.
 */
export const COLUMN_WIDTH_CAPS: Record<ColumnWidth, readonly [string, string]> = {
  narrow: ['36rem', '44rem'],
  medium: ['48rem', '56rem'],
  wide: ['64rem', '72rem'],
  full: ['none', 'none'],
};

export interface TypographyPrefs {
  /** Cap on the text column width in Standard view. Default `medium`. */
  standardWidth: ColumnWidth;
  /** Cap on the text column width in Reading view. Default `medium`. */
  readingWidth: ColumnWidth;
  /** Cap on the text column width in Study view. Default `medium`. */
  studyWidth: ColumnWidth;
  /** Verse labels in the Bible pane (standard, study and parallel views). Default `number`. */
  verseLabelMode: VerseLabelMode;
  bibleFontSize: number;   // 12-48px, default 20
  studyFontSize: number;   // 12-36px, default 16
  uiFontSize: number;      // 10-24px, default 13
  bibleLineHeight: number; // 1.2-2.5, default 1.75
  studyLineHeight: number; // 1.2-2.5, default 1.6
  uiLineHeight: number;    // 1.2-2.5, default 1.5
  bibleFontFamily: string; // id from AVAILABLE_FONT_FAMILIES
  studyFontFamily: string; // id from AVAILABLE_FONT_FAMILIES
  uiFontFamily: string;    // id from AVAILABLE_FONT_FAMILIES
}

export const DEFAULT_TYPOGRAPHY: TypographyPrefs = {
  standardWidth: 'medium',
  readingWidth: 'medium',
  studyWidth: 'medium',
  verseLabelMode: 'number',
  bibleFontSize: 20,
  studyFontSize: 16,
  uiFontSize: 13,
  bibleLineHeight: 1.75,
  studyLineHeight: 1.6,
  uiLineHeight: 1.5,
  bibleFontFamily: 'georgia',
  studyFontFamily: 'system',
  uiFontFamily: 'system'
};

interface PreferencesState {
  // Current theme
  theme: ThemeId;

  // Global font size multiplier (1.0 = 100%, 0.8 = 80%, 1.5 = 150%)
  globalFontScale: number;

  // UI control font size in pixels (for tabs, buttons, menus)
  uiControlFontSize: number;

  // Fine-grained typography (Advanced settings)
  typography: TypographyPrefs;

  // Opt-in gate for drag-and-drop pane rearranging (KAN QA 4.5). Off by
  // default: dragging a pane while this is off is intercepted and explained
  // via a confirmation dialog rather than allowed through. See
  // DockviewLayout.tsx's onWillDragPanel/onWillDragGroup handlers and
  // AdvancedPaneManagerGate.ts for the pure gate logic.
  advancedPaneManagerEnabled: boolean;

  /**
   * Where a new search results pane opens when no search tab is open (task
   * 0210): `below` the Bible pane (default), one Search `tab` in the
   * right-hand pane group with a sub-tab per search, or a full-height column
   * on the `right`. A pane the user has moved stays where they put it.
   */
  searchResultsPlacement: SearchResultsPlacement;

  /**
   * Privacy (task 0224). Off by default: search tabs (queries) and each Bible
   * pane's history / Back stack last only for the session, and are never
   * written to the saved session. On = they are saved and come back.
   */
  reopenSearchTabs: boolean;
  rememberReadingHistory: boolean;

  /** Hour (0-12) at which a new reading-plan day begins (task 0073). */
  readingPlanRolloverHour: number;
  /** Show reading streaks in reading plans (task 0073). */
  readingPlanShowStreak: boolean;
  /** The Go to Passage picker goes on to a verse grid after the chapter ("Also choose a verse"). Default off. */
  pickerVerseStep: boolean;

  /** App switcher rail: `auto` (only with more than one app), `rail` (always), `none` (task 0080). */
  appSwitcher: AppSwitcherMode;
  /** App ids in the user's order (unlisted apps follow in registry order). */
  appOrder: string[];
  /** App ids the user hid from the switcher surfaces (Study cannot be hidden). */
  appHidden: string[];

  /** Scrollbar thickness: `standard` (14px) or `large` (20px). Default `standard`. */
  scrollbarSize: ScrollbarSize;

  // Actions
  setTheme: (theme: ThemeId) => void;
  setGlobalFontScale: (scale: number) => void;
  setUiControlFontSize: (size: number) => void;
  setAdvancedPaneManagerEnabled: (enabled: boolean) => void;
  setSearchResultsPlacement: (placement: SearchResultsPlacement) => void;
  setReopenSearchTabs: (on: boolean) => void;
  setRememberReadingHistory: (on: boolean) => void;
  setReadingPlanRolloverHour: (hour: number) => void;
  setReadingPlanShowStreak: (show: boolean) => void;
  setPickerVerseStep: (on: boolean) => void;
  setAppSwitcher: (mode: AppSwitcherMode) => void;
  setScrollbarSize: (size: ScrollbarSize) => void;
  setAppOrder: (ids: readonly string[]) => void;
  setAppHidden: (ids: readonly string[]) => void;
  setTypography: (prefs: Partial<TypographyPrefs>) => void;
  resetTypography: () => void;
  applyTheme: (theme: ThemeId) => void;
  applyGlobalFontScale: (scale: number) => void;
  applyUiControlFontSize: (size: number) => void;
  applyTypography: (prefs: TypographyPrefs) => void;
  applyAll: () => void;

  // Session integration
  loadFromSession: (data: {
    theme?: string;
    globalFontScale?: number;
    uiControlFontSize?: number;
    typography?: Partial<TypographyPrefs>;
    advancedPaneManagerEnabled?: boolean;
    searchResultsPlacement?: unknown;
    reopenSearchTabs?: unknown;
    rememberReadingHistory?: unknown;
    readingPlanRolloverHour?: number;
    readingPlanShowStreak?: boolean;
    pickerVerseStep?: unknown;
    appSwitcher?: unknown;
    scrollbarSize?: unknown;
    appOrder?: unknown;
    appHidden?: unknown;
  }) => void;
  getSessionData: () => {
    theme: ThemeId;
    globalFontScale: number;
    uiControlFontSize: number;
    typography: TypographyPrefs;
    advancedPaneManagerEnabled: boolean;
    searchResultsPlacement: SearchResultsPlacement;
    reopenSearchTabs: boolean;
    rememberReadingHistory: boolean;
    readingPlanRolloverHour: number;
    readingPlanShowStreak: boolean;
    pickerVerseStep: boolean;
    appSwitcher: AppSwitcherMode;
    scrollbarSize: ScrollbarSize;
    appOrder: string[];
    appHidden: string[];
  };
}

/** Anything but `tab` or `right` (a missing, old or hand-edited value) means the default, `below`. */
export function sanitizeSearchResultsPlacement(raw: unknown): SearchResultsPlacement {
  return raw === 'right' || raw === 'tab' ? raw : 'below';
}

/** Keep only distinct, non-empty string ids. */
function sanitizeIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) if (typeof v === 'string' && v !== '') seen.add(v);
  return [...seen];
}

export type ScrollbarSize = 'standard' | 'large';

/** Anything but `large` (a missing, old or hand-edited value) means the default, `standard`. */
export function sanitizeScrollbarSize(raw: unknown): ScrollbarSize {
  return raw === 'large' ? 'large' : 'standard';
}

function applyScrollbarSizeToDOM(size: ScrollbarSize): void {
  if (typeof document !== 'undefined') {
    // `large` = 20px, anything else the 14px default (see themes.css).
    if (size === 'large') document.documentElement.setAttribute('data-scrollbar-size', 'large');
    else document.documentElement.removeAttribute('data-scrollbar-size');
  }
}

function sanitizeAppSwitcher(raw: unknown): AppSwitcherMode {
  return raw === 'rail' || raw === 'none' ? raw : 'auto';
}

/**
 * Apply theme by setting data-theme attribute on the document root.
 * CSS custom properties defined in globals.css handle the rest.
 */
function applyThemeToDOM(theme: ThemeId): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/**
 * Tell the main process which theme is now active.
 *
 * Two things in main depend on this, and neither has any other way to find
 * out - the theme is renderer state, applied as a DOM attribute and persisted
 * inside the renderer-owned session blob:
 *
 *   1. The View menu's theme radio buttons (`menuBuilder.updateTheme`).
 *   2. `ext-ui://host/theme.css`, the design-token stylesheet extension panels
 *      load in their sandboxed iframes. Panels live on a different origin and
 *      cannot see `<html data-theme>`, so this message is what makes their
 *      palette follow the user's theme.
 *
 * Called from BOTH the user-initiated change and the session restore. It used
 * to fire only on `setTheme`, which meant a user whose saved theme was, say,
 * "midnight" started every session with a light-checked radio in the View menu
 * until they changed theme by hand - and, once panels started reading tokens,
 * would have started every session with a light palette inside every extension
 * panel while the rest of the app was dark.
 */
function notifyMainOfTheme(theme: ThemeId): void {
  if (typeof window !== 'undefined' && window.electron?.menu?.updateTheme) {
    window.electron.menu.updateTheme(theme);
  }
}

/**
 * Apply global font scale as a CSS custom property on the document root.
 * Pane font sizes are multiplied by this value.
 */
function applyGlobalFontScaleToDOM(scale: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--global-font-scale', String(scale));
    applyUiScaleToDOM();
  }
}

/**
 * Apply UI control font size as a CSS custom property on the document root.
 */
function applyUiControlFontSizeToDOM(size: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-control-font-size', `${size}px`);
    applyUiScaleToDOM();
  }
}

/**
 * B-045: the single UI scale. `--ui-scale` = (UI control font size / 14) x
 * global font scale, clamped to 0.7-2. globals.css sets the root font size to
 * `16px * --ui-scale`, so every rem-based size in the chrome scales together.
 */
const UI_SCALE_MIN = 0.7;
const UI_SCALE_MAX = 2;
const UI_CONTROL_FONT_SIZE_DEFAULT = 14;

function applyUiScaleToDOM(): void {
  if (typeof document === 'undefined') return;
  // Both inputs are read back from the root so either setter can refresh the
  // product without knowing the other value.
  const style = document.documentElement.style;
  const num = (name: string, fallback: number) => {
    const v = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const uiControlFontSize = num('--ui-control-font-size', UI_CONTROL_FONT_SIZE_DEFAULT);
  const globalFontScale = num('--global-font-scale', 1);
  const raw = (uiControlFontSize / UI_CONTROL_FONT_SIZE_DEFAULT) * globalFontScale;
  const scale = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(raw * 1000) / 1000));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

/**
 * Apply fine-grained typography preferences as CSS custom properties
 * on the document root. Consumed by pane-content-* styles in globals.css.
 *
 * Also pushes the Bible/Study values into useTextSettingsStore so that panes
 * which have not been explicitly customized in the Fonts section keep
 * following these live (see the `customized` doc comment on
 * useTextSettingsStore.ts for why that push is necessary - a pane's inline
 * `--pane-font-size-*` override otherwise always wins over these variables
 * regardless of what they're set to). Every call site of this function
 * (setTypography, resetTypography, applyTypography, applyAll, loadFromSession)
 * gets the sync for free.
 */
function applyTypographyToDOM(prefs: TypographyPrefs): void {
  if (typeof document !== 'undefined') {
    const root = document.documentElement.style;
    root.setProperty('--standard-max-width', (COLUMN_WIDTH_CAPS[prefs.standardWidth] ?? COLUMN_WIDTH_CAPS.medium)[0]);
    root.setProperty('--reading-max-width', (COLUMN_WIDTH_CAPS[prefs.readingWidth] ?? COLUMN_WIDTH_CAPS.medium)[0]);
    root.setProperty('--study-max-width', (COLUMN_WIDTH_CAPS[prefs.studyWidth] ?? COLUMN_WIDTH_CAPS.medium)[1]);
    root.setProperty('--bible-font-size', `${prefs.bibleFontSize}px`);
    root.setProperty('--study-font-size', `${prefs.studyFontSize}px`);
    root.setProperty('--ui-font-size', `${prefs.uiFontSize}px`);
    // Ratio of the current "UI text" size to its default, mirroring the web
    // app's `--ui-font-scale` (apps/web/src/stores/settingsStore.ts,
    // `String(this.uiFontSize / 14)`). Chrome text that needs to preserve a
    // fixed pixel hierarchy (a 10px badge staying smaller than a 16px title)
    // multiplies its own literal by this ratio via calc() instead of
    // inheriting a single font-size, so relative proportions survive at any
    // slider position - see StudyPane.tsx's `uiScaled()` helper for the
    // consumer side.
    root.setProperty('--ui-font-scale', String(prefs.uiFontSize / DEFAULT_TYPOGRAPHY.uiFontSize));
    root.setProperty('--bible-line-height', String(prefs.bibleLineHeight));
    root.setProperty('--study-line-height', String(prefs.studyLineHeight));
    root.setProperty('--ui-line-height', String(prefs.uiLineHeight));
    root.setProperty('--bible-font-family', getFontFamilyStack(prefs.bibleFontFamily));
    root.setProperty('--study-font-family', getFontFamilyStack(prefs.studyFontFamily));
    root.setProperty('--ui-font-family', getFontFamilyStack(prefs.uiFontFamily));
  }

  useTextSettingsStore.getState().syncFromTypography({
    bible: {
      fontSize: prefs.bibleFontSize,
      lineHeight: prefs.bibleLineHeight,
      fontFamily: getFontFamilyStack(prefs.bibleFontFamily)
    },
    study: {
      fontSize: prefs.studyFontSize,
      lineHeight: prefs.studyLineHeight,
      fontFamily: getFontFamilyStack(prefs.studyFontFamily)
    }
  });
}

/** True when `value` is a finite number within `[min, max]` (inclusive). */
function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isValidFontFamilyId(value: unknown): value is string {
  return typeof value === 'string' && AVAILABLE_FONT_FAMILIES.some((f) => f.id === value);
}

/**
 * Validate a saved (possibly partial or corrupt) typography blob field by
 * field, falling back to `DEFAULT_TYPOGRAPHY` per-field rather than
 * rejecting the object wholesale - a single bad/out-of-range field (hand-edited
 * session file, future format change, truncated write) must not wipe out the
 * rest of the user's saved typography. Ranges match the sliders in
 * TypographySection.tsx.
 */
function sanitizeTypography(saved: Partial<TypographyPrefs> | undefined): TypographyPrefs {
  const s = saved ?? {};
  const width = (v: unknown, fallback: ColumnWidth): ColumnWidth =>
    COLUMN_WIDTHS.includes(v as ColumnWidth) ? (v as ColumnWidth) : fallback;
  // Pre-release builds had one `readingWidth` for every view; a profile saved by one (it has no
  // `standardWidth`) keeps that width in all three.
  const legacyAll = s.standardWidth === undefined ? width(s.readingWidth, DEFAULT_TYPOGRAPHY.readingWidth) : undefined;
  return {
    standardWidth: width(s.standardWidth, legacyAll ?? DEFAULT_TYPOGRAPHY.standardWidth),
    readingWidth: width(s.readingWidth, DEFAULT_TYPOGRAPHY.readingWidth),
    studyWidth: width(s.studyWidth, legacyAll ?? DEFAULT_TYPOGRAPHY.studyWidth),
    verseLabelMode: VERSE_LABEL_MODES.includes(s.verseLabelMode as VerseLabelMode) ? (s.verseLabelMode as VerseLabelMode) : DEFAULT_TYPOGRAPHY.verseLabelMode,
    bibleFontSize: isFiniteInRange(s.bibleFontSize, 12, 48) ? s.bibleFontSize : DEFAULT_TYPOGRAPHY.bibleFontSize,
    studyFontSize: isFiniteInRange(s.studyFontSize, 12, 36) ? s.studyFontSize : DEFAULT_TYPOGRAPHY.studyFontSize,
    uiFontSize: isFiniteInRange(s.uiFontSize, 10, 24) ? s.uiFontSize : DEFAULT_TYPOGRAPHY.uiFontSize,
    bibleLineHeight: isFiniteInRange(s.bibleLineHeight, 1.2, 2.5) ? s.bibleLineHeight : DEFAULT_TYPOGRAPHY.bibleLineHeight,
    studyLineHeight: isFiniteInRange(s.studyLineHeight, 1.2, 2.5) ? s.studyLineHeight : DEFAULT_TYPOGRAPHY.studyLineHeight,
    uiLineHeight: isFiniteInRange(s.uiLineHeight, 1.2, 2.5) ? s.uiLineHeight : DEFAULT_TYPOGRAPHY.uiLineHeight,
    bibleFontFamily: isValidFontFamilyId(s.bibleFontFamily) ? s.bibleFontFamily : DEFAULT_TYPOGRAPHY.bibleFontFamily,
    studyFontFamily: isValidFontFamilyId(s.studyFontFamily) ? s.studyFontFamily : DEFAULT_TYPOGRAPHY.studyFontFamily,
    uiFontFamily: isValidFontFamilyId(s.uiFontFamily) ? s.uiFontFamily : DEFAULT_TYPOGRAPHY.uiFontFamily
  };
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  theme: 'light',
  globalFontScale: 1.0,
  uiControlFontSize: 14,
  typography: { ...DEFAULT_TYPOGRAPHY },
  advancedPaneManagerEnabled: false,
  searchResultsPlacement: 'below',
  reopenSearchTabs: false,
  rememberReadingHistory: false,
  readingPlanRolloverHour: 3,
  readingPlanShowStreak: false,
  pickerVerseStep: false,
  appSwitcher: 'auto',
  scrollbarSize: 'standard',
  appOrder: [],
  appHidden: [],

  setTheme: (theme: ThemeId) => {
    set({ theme });
    applyThemeToDOM(theme);
    notifyMainOfTheme(theme);
    markSessionDirty();
  },

  setGlobalFontScale: (scale: number) => {
    set({ globalFontScale: scale });
    applyGlobalFontScaleToDOM(scale);
    markSessionDirty();
  },

  setUiControlFontSize: (size: number) => {
    set({ uiControlFontSize: size });
    applyUiControlFontSizeToDOM(size);
    markSessionDirty();
  },

  setAdvancedPaneManagerEnabled: (enabled: boolean) => {
    set({ advancedPaneManagerEnabled: enabled });
    markSessionDirty();
  },

  setSearchResultsPlacement: (placement: SearchResultsPlacement) => {
    set({ searchResultsPlacement: sanitizeSearchResultsPlacement(placement) });
    markSessionDirty();
  },

  setReopenSearchTabs: (on: boolean) => {
    set({ reopenSearchTabs: on === true });
    markSessionDirty();
  },

  setRememberReadingHistory: (on: boolean) => {
    set({ rememberReadingHistory: on === true });
    markSessionDirty();
  },

  setReadingPlanRolloverHour: (hour: number) => {
    const clamped = Math.min(12, Math.max(0, Math.round(hour)));
    set({ readingPlanRolloverHour: clamped });
    markSessionDirty();
  },

  setReadingPlanShowStreak: (show: boolean) => {
    set({ readingPlanShowStreak: show });
    markSessionDirty();
  },

  setPickerVerseStep: (on: boolean) => {
    set({ pickerVerseStep: on });
    markSessionDirty();
  },

  setAppSwitcher: (mode: AppSwitcherMode) => {
    set({ appSwitcher: sanitizeAppSwitcher(mode) });
    markSessionDirty();
  },

  setScrollbarSize: (size: ScrollbarSize) => {
    const next = sanitizeScrollbarSize(size);
    set({ scrollbarSize: next });
    applyScrollbarSizeToDOM(next);
    markSessionDirty();
  },

  setAppOrder: (ids) => {
    set({ appOrder: sanitizeIdList(ids) });
    markSessionDirty();
  },

  setAppHidden: (ids) => {
    set({ appHidden: sanitizeIdList(ids) });
    markSessionDirty();
  },

  setTypography: (prefs: Partial<TypographyPrefs>) => {
    const next: TypographyPrefs = { ...get().typography, ...prefs };
    set({ typography: next });
    applyTypographyToDOM(next);
    markSessionDirty();
  },

  resetTypography: () => {
    const next: TypographyPrefs = { ...DEFAULT_TYPOGRAPHY };
    set({ typography: next });
    applyTypographyToDOM(next);
    markSessionDirty();
  },

  applyTheme: (theme: ThemeId) => {
    applyThemeToDOM(theme);
  },

  applyGlobalFontScale: (scale: number) => {
    applyGlobalFontScaleToDOM(scale);
  },

  applyUiControlFontSize: (size: number) => {
    applyUiControlFontSizeToDOM(size);
  },

  applyTypography: (prefs: TypographyPrefs) => {
    applyTypographyToDOM(prefs);
  },

  applyAll: () => {
    const { theme, globalFontScale, uiControlFontSize, typography } = get();
    applyThemeToDOM(theme);
    applyGlobalFontScaleToDOM(globalFontScale);
    applyUiControlFontSizeToDOM(uiControlFontSize);
    applyTypographyToDOM(typography);
    applyScrollbarSizeToDOM(get().scrollbarSize);
  },

  loadFromSession: (data) => {
    // Every field is validated independently and falls back to its own
    // default on missing/wrong-type/out-of-range data - a session saved by a
    // future version, hand-edited, or truncated mid-write must never crash
    // startup or leave a half-applied theme (e.g. a valid theme with NaN
    // typography, or vice versa).
    const theme: ThemeId = typeof data.theme === 'string' && isValidThemeId(data.theme) ? data.theme : 'light';
    const globalFontScale = isFiniteInRange(data.globalFontScale, 0.7, 1.5) ? data.globalFontScale : 1.0;
    const uiControlFontSize = isFiniteInRange(data.uiControlFontSize, 11, 20) ? data.uiControlFontSize : 14;
    const typography: TypographyPrefs = sanitizeTypography(data.typography);
    const advancedPaneManagerEnabled = typeof data.advancedPaneManagerEnabled === 'boolean'
      ? data.advancedPaneManagerEnabled
      : false;

    const readingPlanRolloverHour = isFiniteInRange(data.readingPlanRolloverHour, 0, 12)
      ? Math.round(data.readingPlanRolloverHour)
      : 3;
    const readingPlanShowStreak = typeof data.readingPlanShowStreak === 'boolean' ? data.readingPlanShowStreak : false;
    const pickerVerseStep = data.pickerVerseStep === true;

    const searchResultsPlacement = sanitizeSearchResultsPlacement(data.searchResultsPlacement);
    // Absent (every session written before 0224) means the private default: off.
    const reopenSearchTabs = data.reopenSearchTabs === true;
    const rememberReadingHistory = data.rememberReadingHistory === true;
    const appSwitcher = sanitizeAppSwitcher(data.appSwitcher);
    const scrollbarSize = sanitizeScrollbarSize(data.scrollbarSize);
    const appOrder = sanitizeIdList(data.appOrder);
    const appHidden = sanitizeIdList(data.appHidden);

    set({
      theme, globalFontScale, uiControlFontSize, typography, advancedPaneManagerEnabled,
      searchResultsPlacement, reopenSearchTabs, rememberReadingHistory,
      readingPlanRolloverHour, readingPlanShowStreak, pickerVerseStep, appSwitcher, scrollbarSize, appOrder, appHidden,
    });
    applyThemeToDOM(theme);
    notifyMainOfTheme(theme);
    applyGlobalFontScaleToDOM(globalFontScale);
    applyUiControlFontSizeToDOM(uiControlFontSize);
    applyTypographyToDOM(typography);
    applyScrollbarSizeToDOM(scrollbarSize);
  },

  getSessionData: () => {
    const {
      theme, globalFontScale, uiControlFontSize, typography, advancedPaneManagerEnabled,
      searchResultsPlacement, reopenSearchTabs, rememberReadingHistory,
      readingPlanRolloverHour, readingPlanShowStreak, pickerVerseStep, appSwitcher, scrollbarSize, appOrder, appHidden,
    } = get();
    return {
      theme, globalFontScale, uiControlFontSize, typography, advancedPaneManagerEnabled,
      searchResultsPlacement, reopenSearchTabs, rememberReadingHistory,
      readingPlanRolloverHour, readingPlanShowStreak, pickerVerseStep, appSwitcher, scrollbarSize, appOrder, appHidden,
    };
  }
}));

// Publish theme into WhenContextService whenever it changes.
function publishPreferencesWhenContext(state: PreferencesState): void {
  whenContextService.set('theme', state.theme);
}

publishPreferencesWhenContext(usePreferencesStore.getState());
usePreferencesStore.subscribe(publishPreferencesWhenContext);
// Feature-module core event `settings.changed`: a no-op unless an active module subscribes.
usePreferencesStore.subscribe(preferencesChanged);

// Register the session serializer so useSessionStore doesn't import us
// directly (same decoupling pattern as useTextSettingsStore). Restoration is
// NOT symmetric via the registry - AppInitService calls loadFromSession()
// directly and early, alongside useTextSettingsStore's, since registered
// "restorers" in sessionRegistry.ts are dead infrastructure nothing reads.
registerPrivacyPrefsReader(() => {
  const { reopenSearchTabs, rememberReadingHistory } = usePreferencesStore.getState();
  return { reopenSearchTabs, rememberReadingHistory };
});
registerSessionSerializer('preferences', () => usePreferencesStore.getState().getSessionData());

// Sync useTextSettingsStore's non-customized panes to the initial typography
// defaults immediately at module load, same as applyAll() would once the app
// mounts - without this, a pane rendered before anything calls applyAll()
// would briefly show useTextSettingsStore's own bootstrap placeholders
// instead of DEFAULT_TYPOGRAPHY. loadFromSession() (called once the real
// session loads) re-syncs to the saved/actual typography afterward.
applyTypographyToDOM(usePreferencesStore.getState().typography);
