import { create } from 'zustand';

import { markSessionDirty } from './helpers/sessionNotifier';
import { registerSessionSerializer } from './helpers/sessionRegistry';

/**
 * Text settings for a specific pane type
 */
export interface TextSettings {
  fontSize: number;        // Font size in pixels (14-30)
  fontFamily: string;      // Font family name
  lineHeight: number;      // Line height multiplier (1.3-2.0)
  showRedLetter?: boolean; // Show Christ's words in red (Bible pane only)
}

/**
 * Default text settings for each pane type
 */
const DEFAULT_SETTINGS: TextSettings = {
  fontSize: 20,
  fontFamily: 'Georgia',
  lineHeight: 1.75,
  showRedLetter: true  // Default to showing Christ's words in red
};

/**
 * Available font families for Bible text.
 *
 * `label` is the typeface's own name - a proper noun, never translated.
 * `labelKey` exists for the one option whose label carries prose around that
 * name ("Georgia (Default)"): the key takes `{fontName}` so the translator
 * owns the parenthetical and its position, and it is resolved with `t()` at
 * render time rather than here, since this module is evaluated once at import.
 */
export interface FontOption {
  name: string;
  label: string;
  labelKey?: string;
  css: string;
}

export const AVAILABLE_FONTS: FontOption[] = [
  { name: 'Georgia', label: 'Georgia', labelKey: 'preferencesDialog.fontDefaultLabel', css: 'Georgia, serif' },
  { name: 'Merriweather', label: 'Merriweather', css: 'Merriweather, Georgia, serif' },
  { name: 'Garamond', label: 'Garamond', css: 'Garamond, "Times New Roman", serif' },
  { name: 'Times New Roman', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { name: 'Crimson Text', label: 'Crimson Text', css: '"Crimson Text", Georgia, serif' },
  { name: 'Libre Baskerville', label: 'Libre Baskerville', css: '"Libre Baskerville", Georgia, serif' }
];

/**
 * Get CSS font-family value from font name.
 *
 * `fontName` is normally one of `AVAILABLE_FONTS[].name` ("Georgia",
 * "Merriweather", ...). But a pane that has NOT been explicitly customized
 * via the Fonts section carries a font-family that was synced in from the
 * Typography section's picker instead (see `syncFromTypography` below), which
 * stores an already-resolved CSS font stack rather than one of these named
 * options (e.g. `"Lora", Georgia, "Times New Roman", serif`) - a string with
 * no `AVAILABLE_FONTS` match. Falling through to that string, rather than to
 * the Georgia default, is what lets the Typography font-family picker's
 * choice actually reach the rendered pane.
 */
export function getFontFamilyCSS(fontName: string): string {
  const font = AVAILABLE_FONTS.find(f => f.name === fontName);
  if (font) return font.css;
  return fontName || 'Georgia, serif';
}

export type PaneType = 'bible' | 'commentary' | 'book' | 'dictionary';

/** The three font knobs a pane can either follow globally or override. */
interface PaneFontDefaults {
  fontSize: number;
  /** An already-resolved CSS font-family stack, not an `AVAILABLE_FONTS` name - see `getFontFamilyCSS`. */
  fontFamily: string;
  lineHeight: number;
}

/**
 * Bootstrap values used only until the first `syncFromTypography` call lands.
 *
 * `usePreferencesStore.ts` calls `syncFromTypography` synchronously at module
 * load (mirroring the existing `publishPreferencesWhenContext` bootstrap
 * pattern in that file) with whatever `typography` prefs are current - the
 * defaults on a fresh profile, or a loaded session's saved values - so in
 * practice no pane is ever rendered against these placeholders. They exist
 * purely so `settings` has a well-typed, non-undefined initial value, and
 * intentionally mirror `DEFAULT_TYPOGRAPHY` in usePreferencesStore.ts (not
 * imported from there - see the module-boundary note on `syncFromTypography`).
 */
const BOOTSTRAP_TYPOGRAPHY_DEFAULTS: { bible: PaneFontDefaults; study: PaneFontDefaults } = {
  bible: { fontSize: 20, fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1.75 },
  study: { fontSize: 15, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', lineHeight: 1.6 }
};

interface TextSettingsState {
  // Settings per pane type
  settings: Record<PaneType, TextSettings>;

  /**
   * Whether the user has explicitly customized a pane's font via the Fonts
   * section (`PaneFontSettings.tsx`). A pane that has NOT been customized
   * keeps following the global Typography section's Bible/Study values live
   * (`syncFromTypography`); customizing detaches it until the pane is reset.
   *
   * This is the fix for the bug where Typography sliders/font-family picker
   * appeared to "do nothing": every pane component (BibleVerseList,
   * CommentarySinglePanel, BookSinglePanel, DictionarySinglePanel, ...)
   * unconditionally sets `--pane-font-size-<pane>` etc. inline from this
   * store's `settings`, and per the CSS fallback chain in globals.css
   * (`var(--pane-font-size-bible, var(--bible-font-size, 20px))`), an
   * inline-set pane override ALWAYS wins over the Typography section's
   * `--bible-font-size` - there is no way for that fallback to prefer the
   * global value once the pane override is defined. Without this flag the
   * per-pane defaults (present from first render, before any user action)
   * permanently shadowed the global sliders. See settings-preferences.md.
   */
  customized: Record<PaneType, boolean>;

  /** Last values pushed in from usePreferencesStore.typography; used by resetSettings to un-customize back to "follow global". */
  typographyDefaults: { bible: PaneFontDefaults; study: PaneFontDefaults };

  // Actions
  updateSettings: (paneType: PaneType, settings: Partial<TextSettings>) => void;
  resetSettings: (paneType: PaneType) => void;
  getSettings: (paneType: PaneType) => TextSettings;
  /**
   * Push the Typography section's current Bible/Study values into every pane
   * that has NOT been explicitly customized. Called from usePreferencesStore
   * whenever `typography` changes (and once at module load) - see the doc
   * comment on `customized` above for why this exists. Takes already-resolved
   * values (not `TypographyPrefs` / `getFontFamilyStack`) so this module has
   * no runtime import from usePreferencesStore.ts, which imports THIS module
   * to call it - a type-only import back would be safe (erased at compile
   * time) but a runtime one in both directions risks an evaluation-order bug.
   */
  syncFromTypography: (values: { bible: PaneFontDefaults; study: PaneFontDefaults }) => void;

  // Session integration
  loadFromSession: (
    sessionData: Partial<Record<PaneType, Partial<TextSettings>>>,
    customizedData?: Partial<Record<PaneType, boolean>>
  ) => void;
  getSessionData: () => Record<PaneType, TextSettings>;
}

/** True when `value` is a finite number within `[min, max]` (inclusive). */
function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validate one pane's saved settings field by field, falling back to
 * `fallback` (that pane's current in-store value) per-field on missing or
 * corrupt data - a bad `fontSize` must not also discard a valid
 * `fontFamily`, and a session saved by a future version with an extra field
 * must not crash the store.
 */
function sanitizePaneSettings(saved: Partial<TextSettings> | undefined, fallback: TextSettings): TextSettings {
  if (!saved || typeof saved !== 'object') return fallback;
  return {
    fontSize: isFiniteInRange(saved.fontSize, 8, 72) ? saved.fontSize : fallback.fontSize,
    fontFamily: typeof saved.fontFamily === 'string' && saved.fontFamily.trim().length > 0
      ? saved.fontFamily
      : fallback.fontFamily,
    lineHeight: isFiniteInRange(saved.lineHeight, 1.0, 3.0) ? saved.lineHeight : fallback.lineHeight,
    showRedLetter: typeof saved.showRedLetter === 'boolean' ? saved.showRedLetter : fallback.showRedLetter
  };
}

/** Which panes follow `study` (vs. `bible`) in the Typography section's two-tier split. */
function typographySourceFor(paneType: PaneType): 'bible' | 'study' {
  return paneType === 'bible' ? 'bible' : 'study';
}

export const useTextSettingsStore = create<TextSettingsState>((set, get) => ({
  // Initial state - all pane types start with default settings.
  // Non-bible panes follow the Typography section's "study" tier, so their
  // bootstrap lineHeight must match BOOTSTRAP_TYPOGRAPHY_DEFAULTS.study.lineHeight
  // (1.6) rather than DEFAULT_SETTINGS.lineHeight (1.75, the "bible" tier value) -
  // otherwise a pane rendered before the first syncFromTypography call (e.g. in
  // isolated unit tests, or a future render-before-import ordering change) would
  // briefly/permanently show the wrong default. See syncFromTypography below,
  // which keeps a non-customized pane's lineHeight following this same tier live.
  settings: {
    bible: { ...DEFAULT_SETTINGS },
    commentary: { ...DEFAULT_SETTINGS, fontSize: 18, lineHeight: BOOTSTRAP_TYPOGRAPHY_DEFAULTS.study.lineHeight }, // Slightly smaller for commentary
    book: { ...DEFAULT_SETTINGS, fontSize: 18, lineHeight: BOOTSTRAP_TYPOGRAPHY_DEFAULTS.study.lineHeight },
    dictionary: { ...DEFAULT_SETTINGS, fontSize: 16, lineHeight: BOOTSTRAP_TYPOGRAPHY_DEFAULTS.study.lineHeight } // Smallest for dictionary
  },

  customized: { bible: false, commentary: false, book: false, dictionary: false },
  typographyDefaults: BOOTSTRAP_TYPOGRAPHY_DEFAULTS,

  /**
   * Update settings for a specific pane type. Touching the font family, size,
   * or line height marks the pane as customized, detaching it from the
   * Typography section's live sync (see `customized` doc comment). Toggling
   * `showRedLetter` alone does not - it is unrelated to which font tier the
   * pane is following.
   */
  updateSettings: (paneType: PaneType, newSettings: Partial<TextSettings>) => {
    const touchesFont = 'fontFamily' in newSettings || 'fontSize' in newSettings || 'lineHeight' in newSettings;
    set((state) => ({
      settings: {
        ...state.settings,
        [paneType]: {
          ...state.settings[paneType],
          ...newSettings
        }
      },
      customized: touchesFont ? { ...state.customized, [paneType]: true } : state.customized
    }));

    // Mark session as dirty so it auto-saves
    markSessionDirty();
  },

  /**
   * Reset a pane's font settings to defaults. This re-follows the Typography
   * section's current Bible/Study values (clearing `customized`), rather than
   * some fixed literal, so "Reset to Defaults" in the Fonts section and the
   * Typography section agree on what "default" means.
   */
  resetSettings: (paneType: PaneType) => {
    set((state) => {
      const source = state.typographyDefaults[typographySourceFor(paneType)];
      return {
        settings: {
          ...state.settings,
          [paneType]: {
            fontSize: source.fontSize,
            fontFamily: source.fontFamily,
            lineHeight: source.lineHeight,
            ...(paneType === 'bible' ? { showRedLetter: DEFAULT_SETTINGS.showRedLetter } : {})
          }
        },
        customized: { ...state.customized, [paneType]: false }
      };
    });

    // Mark session as dirty
    markSessionDirty();
  },

  /**
   * Get settings for a specific pane type
   */
  getSettings: (paneType: PaneType): TextSettings => {
    return get().settings[paneType];
  },

  syncFromTypography: (values) => {
    set((state) => {
      const nextSettings = { ...state.settings };
      (Object.keys(nextSettings) as PaneType[]).forEach((paneType) => {
        if (state.customized[paneType]) return; // explicit per-pane override wins
        const source = values[typographySourceFor(paneType)];
        nextSettings[paneType] = {
          ...nextSettings[paneType],
          fontSize: source.fontSize,
          fontFamily: source.fontFamily,
          lineHeight: source.lineHeight
        };
      });
      return { settings: nextSettings, typographyDefaults: values };
    });
  },

  /**
   * Load settings from session data.
   *
   * `customizedData` is the sibling `textSettingsCustomized` blob saved
   * alongside `sessionData` (see SessionData in @bible/core's Session.ts).
   * A pane's restored `customized` flag comes from there, per pane, falling
   * back to **not customized** when the flag is absent for that pane - most
   * importantly for sessions saved before this field existed, which have no
   * `customizedData` at all. Defaulting to "not customized" (rather than the
   * previous behavior of marking every restored pane customized
   * unconditionally) is required: marking every pane customized after every
   * restart would detach every pane from the Typography section forever,
   * permanently masking its sliders - exactly the bug this `customized` flag
   * was introduced to fix. See settings-preferences.md.
   *
   * Each pane's settings are also sanitized field-by-field via
   * `sanitizePaneSettings`, falling back to that pane's current (default)
   * value for any missing/corrupt field, so a malformed session can never
   * produce a NaN font size or crash the store.
   */
  loadFromSession: (
    sessionData: Partial<Record<PaneType, Partial<TextSettings>>>,
    customizedData?: Partial<Record<PaneType, boolean>>
  ) => {
    set((state) => {
      const nextSettings = { ...state.settings };
      const nextCustomized = { ...state.customized };
      (Object.keys(sessionData) as PaneType[]).forEach((paneType) => {
        if (!(paneType in nextSettings)) return; // unknown/future pane key - ignore
        nextSettings[paneType] = sanitizePaneSettings(sessionData[paneType], nextSettings[paneType]);
        nextCustomized[paneType] = customizedData?.[paneType] ?? false;
      });
      return {
        settings: nextSettings,
        customized: nextCustomized
      };
    });
  },

  /**
   * Get current settings for session persistence
   */
  getSessionData: (): Record<PaneType, TextSettings> => {
    return get().settings;
  }
}));

// Register session serializers so useSessionStore doesn't import us directly.
registerSessionSerializer('textSettings', () => {
  return useTextSettingsStore.getState().getSessionData();
});
registerSessionSerializer('textSettingsCustomized', () => {
  return useTextSettingsStore.getState().customized;
});
