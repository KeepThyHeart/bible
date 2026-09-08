import { create } from 'zustand';
import { whenContextService } from '../services/WhenContextService';
import { useTextSettingsStore } from './useTextSettingsStore';
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
}

export const AVAILABLE_FONT_FAMILIES: FontFamilyOption[] = [
  { id: 'system', label: 'System Default', labelKey: 'preferencesDialog.fontSystemDefault', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { id: 'palatino', label: 'Palatino', stack: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif' },
  { id: 'garamond', label: 'Garamond', stack: 'Garamond, "EB Garamond", "Times New Roman", serif' },
  { id: 'lora', label: 'Lora', stack: '"Lora", Georgia, "Times New Roman", serif' },
  { id: 'merriweather', label: 'Merriweather', stack: '"Merriweather", Georgia, "Times New Roman", serif' },
  { id: 'eb-garamond', label: 'EB Garamond', stack: '"EB Garamond", Garamond, "Times New Roman", serif' }
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

/**
 * Fine-grained typography preferences (Bible / Study / UI).
 * These are separate from the per-pane settings in useTextSettingsStore -
 * they set global CSS variables consumed by pane styles.
 */
export interface TypographyPrefs {
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

  // Actions
  setTheme: (theme: ThemeId) => void;
  setGlobalFontScale: (scale: number) => void;
  setUiControlFontSize: (size: number) => void;
  setAdvancedPaneManagerEnabled: (enabled: boolean) => void;
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
  }) => void;
  getSessionData: () => {
    theme: ThemeId;
    globalFontScale: number;
    uiControlFontSize: number;
    typography: TypographyPrefs;
    advancedPaneManagerEnabled: boolean;
  };
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
 * Apply global font scale as a CSS custom property on the document root.
 * Pane font sizes are multiplied by this value.
 */
function applyGlobalFontScaleToDOM(scale: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--global-font-scale', String(scale));
  }
}

/**
 * Apply UI control font size as a CSS custom property on the document root.
 */
function applyUiControlFontSizeToDOM(size: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-control-font-size', `${size}px`);
  }
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
  return {
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

  setTheme: (theme: ThemeId) => {
    set({ theme });
    applyThemeToDOM(theme);

    // Notify the Electron menu so it can update the radio buttons
    if (typeof window !== 'undefined' && window.electron?.menu?.updateTheme) {
      window.electron.menu.updateTheme(theme);
    }

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

    set({ theme, globalFontScale, uiControlFontSize, typography, advancedPaneManagerEnabled });
    applyThemeToDOM(theme);
    applyGlobalFontScaleToDOM(globalFontScale);
    applyUiControlFontSizeToDOM(uiControlFontSize);
    applyTypographyToDOM(typography);
  },

  getSessionData: () => {
    const { theme, globalFontScale, uiControlFontSize, typography, advancedPaneManagerEnabled } = get();
    return { theme, globalFontScale, uiControlFontSize, typography, advancedPaneManagerEnabled };
  }
}));

// Publish theme into WhenContextService whenever it changes.
function publishPreferencesWhenContext(state: PreferencesState): void {
  whenContextService.set('theme', state.theme);
}

publishPreferencesWhenContext(usePreferencesStore.getState());
usePreferencesStore.subscribe(publishPreferencesWhenContext);

// Register the session serializer so useSessionStore doesn't import us
// directly (same decoupling pattern as useTextSettingsStore). Restoration is
// NOT symmetric via the registry - AppInitService calls loadFromSession()
// directly and early, alongside useTextSettingsStore's, since registered
// "restorers" in sessionRegistry.ts are dead infrastructure nothing reads.
registerSessionSerializer('preferences', () => usePreferencesStore.getState().getSessionData());

// Sync useTextSettingsStore's non-customized panes to the initial typography
// defaults immediately at module load, same as applyAll() would once the app
// mounts - without this, a pane rendered before anything calls applyAll()
// would briefly show useTextSettingsStore's own bootstrap placeholders
// instead of DEFAULT_TYPOGRAPHY. loadFromSession() (called once the real
// session loads) re-syncs to the saved/actual typography afterward.
applyTypographyToDOM(usePreferencesStore.getState().typography);
