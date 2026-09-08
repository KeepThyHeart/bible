/**
 * themeTokens.ts
 *
 * Single authoritative list of the app's selectable themes: id, sort order,
 * dark/light polarity, catalog keys for the display name/description, and the
 * small 4-colour swatch used by the Themes section's preview cards
 * (`ThemesSection.tsx` / `AVAILABLE_THEMES` in `usePreferencesStore.ts`).
 *
 * ## Where the actual colors live
 *
 * This module does NOT hold the ~50-variable CSS palette a theme needs at
 * runtime (backgrounds, surfaces, status colors, morphology colors, tabs,
 * links, range-slider colors, ...) - that lives in `styles/themes.css`, as
 * plain `[data-theme="<id>"]` blocks of CSS custom properties, because CSS
 * custom properties are how the rest of the app's stylesheets actually
 * consume theme colors (`rgb(var(--theme-bg-primary-rgb))`, etc.) and there
 * is no build step in this package that generates CSS from TypeScript.
 * `themeTokens.ts` and `themes.css` are therefore two views of the same 15
 * themes: this file is what the *dialog* (React) needs, themes.css is what
 * the *rendered app* (CSS cascade) needs. Adding a theme means adding an
 * entry to both - see the "Adding a theme" note at the bottom of this file.
 *
 * ## Relationship to apps/web
 *
 * `apps/web/src/themes/<id>/theme.json` + `_vars.scss` is the ORIGINAL
 * source for the 12 non-core themes below (`arctic` ... `sunset`). Desktop and
 * web are genuinely different frameworks for this feature - web discovers
 * themes at build time via `import.meta.glob` over per-folder SCSS partials
 * (Vite-only, and the web package is intentionally excluded from this repo's
 * root workspace - see the root CLAUDE.md), while desktop has no equivalent
 * glob-import mechanism and consumes one static `themes.css`. A fully shared
 * pipeline (one token source both Vite's glob-import and desktop's plain CSS
 * pull from) would mean either teaching web to consume desktop's format or
 * standing up a small shared package purely for this, which is
 * disproportionate to "bring the missing themes over." Instead:
 *
 *   - The web values are the source of truth for each theme's core palette
 *     (background/text/border/accent/christ-words colors) - see the `preview`
 *     swatch below, which is copied verbatim from the corresponding
 *     `apps/web/src/themes/<id>/theme.json`.
 *   - Desktop's much larger token surface (surfaces, status colors,
 *     morphology colors, pane headers, tabs, links, range sliders, ...) is
 *     DERIVED from that core palette by one consistent formula, applied to
 *     all 12 ported themes alike, and documented in the "Themes" section of
 *     `apps/desktop/docs/features/settings-preferences.md`. Status and
 *     morphology colors specifically are reused wholesale from the existing
 *     light/dark blocks rather than hand-tuned per theme (12 themes x
 *     WCAG-audited status/morphology palettes was judged out of scope for
 *     this fix).
 *   - Each new `[data-theme]` block in `themes.css` carries a comment citing
 *     its `apps/web/src/themes/<id>/` source and this file, so the
 *     provenance is traceable without a generated build artifact.
 *
 * This is the "next best thing" the task description allows for when a fully
 * shared pipeline is disproportionate: one authoritative desktop-side
 * definition, with explicit pointers back to the web source it was ported
 * from, rather than two independently hand-maintained copies.
 */

export type ThemeId =
  | 'light'
  | 'dark'
  | 'sepia'
  | 'arctic'
  | 'autumn'
  | 'forest'
  | 'lagoon'
  | 'meadow'
  | 'midnight'
  | 'ocean'
  | 'parchment'
  | 'rose'
  | 'slate'
  | 'sunrise'
  | 'sunset';

export interface ThemePreviewSwatch {
  bg: string;
  text: string;
  accent: string;
  border: string;
}

export interface ThemeToken {
  id: ThemeId;
  /** Sort order in the Themes section grid (core themes first, then the rest - mirrors web's `theme.json` `order`). */
  order: number;
  isDark: boolean;
  /** Catalog key for the theme's display name. Resolve with `t()` at render time - see usePreferencesStore.ts's `ThemeOption` doc comment for why. */
  labelKey: string;
  /** Catalog key for the one-line description. Resolve with `t()` at render time. */
  descriptionKey: string;
  /** Preview colors for the theme card. For the 12 ported themes this is copied verbatim from the matching apps/web/src/themes/<id>/theme.json `swatch`. */
  preview: ThemePreviewSwatch;
}

/**
 * All selectable themes, sorted by display order. `usePreferencesStore.ts`
 * derives `AVAILABLE_THEMES` (and its `ThemeId` type) from this list rather
 * than maintaining a second hand-written array.
 *
 * Adding a theme:
 *   1. Add a `[data-theme="<id>"]` block to `styles/themes.css` with the full
 *      token set (copy an existing block's structure).
 *   2. Add an entry here with its id/order/isDark/preview swatch.
 *   3. Add the `labelKey`/`descriptionKey` strings to `locales/en/ui.json`.
 */
export const THEME_TOKENS: readonly ThemeToken[] = [
  {
    id: 'light',
    order: 1,
    isDark: false,
    labelKey: 'ui.preferences.themeLightLabel',
    descriptionKey: 'ui.preferences.themeLightDescription',
    preview: { bg: '#FFFFFF', text: '#2C2C2C', accent: '#4A90E2', border: '#E0E0E0' }
  },
  {
    id: 'dark',
    order: 2,
    isDark: true,
    labelKey: 'ui.preferences.themeDarkLabel',
    descriptionKey: 'ui.preferences.themeDarkDescription',
    preview: { bg: '#1A1A2E', text: '#E0E0E0', accent: '#6BA3E8', border: '#3A3A5C' }
  },
  {
    id: 'sepia',
    order: 3,
    isDark: false,
    labelKey: 'ui.preferences.themeSepiaLabel',
    descriptionKey: 'ui.preferences.themeSepiaDescription',
    preview: { bg: '#F5F0E8', text: '#3E2C1C', accent: '#8B6914', border: '#D4C5A9' }
  },
  {
    id: 'forest',
    order: 4,
    isDark: false,
    labelKey: 'ui.preferences.themeForestLabel',
    descriptionKey: 'ui.preferences.themeForestDescription',
    preview: { bg: '#f0f5ed', text: '#1b2e1b', accent: '#2d7a3a', border: '#b5ccb0' }
  },
  {
    id: 'midnight',
    order: 5,
    isDark: true,
    labelKey: 'ui.preferences.themeMidnightLabel',
    descriptionKey: 'ui.preferences.themeMidnightDescription',
    preview: { bg: '#0d1117', text: '#c9d1d9', accent: '#58a6ff', border: '#30363d' }
  },
  {
    id: 'lagoon',
    order: 6,
    isDark: false,
    labelKey: 'ui.preferences.themeLagoonLabel',
    descriptionKey: 'ui.preferences.themeLagoonDescription',
    preview: { bg: '#effaf8', text: '#0c2e2a', accent: '#0e8a7a', border: '#a0d0c8' }
  },
  {
    id: 'ocean',
    order: 7,
    isDark: false,
    labelKey: 'ui.preferences.themeOceanLabel',
    descriptionKey: 'ui.preferences.themeOceanDescription',
    preview: { bg: '#eef4f8', text: '#0f2b3c', accent: '#1a6ea0', border: '#a8c8dc' }
  },
  {
    id: 'sunset',
    order: 8,
    isDark: true,
    labelKey: 'ui.preferences.themeSunsetLabel',
    descriptionKey: 'ui.preferences.themeSunsetDescription',
    preview: { bg: '#2a1520', text: '#f0d0d8', accent: '#e8789a', border: '#5a2a3d' }
  },
  {
    id: 'meadow',
    order: 9,
    isDark: false,
    labelKey: 'ui.preferences.themeMeadowLabel',
    descriptionKey: 'ui.preferences.themeMeadowDescription',
    preview: { bg: '#f4f8ef', text: '#1e3018', accent: '#5a9e2e', border: '#b8d4a0' }
  },
  {
    id: 'slate',
    order: 10,
    isDark: true,
    labelKey: 'ui.preferences.themeSlateLabel',
    descriptionKey: 'ui.preferences.themeSlateDescription',
    preview: { bg: '#1e2530', text: '#cbd5e1', accent: '#38bdf8', border: '#334155' }
  },
  {
    id: 'rose',
    order: 11,
    isDark: false,
    labelKey: 'ui.preferences.themeRoseLabel',
    descriptionKey: 'ui.preferences.themeRoseDescription',
    preview: { bg: '#fdf2f4', text: '#3b1020', accent: '#be185d', border: '#e8b0c0' }
  },
  {
    id: 'sunrise',
    order: 12,
    isDark: false,
    labelKey: 'ui.preferences.themeSunriseLabel',
    descriptionKey: 'ui.preferences.themeSunriseDescription',
    preview: { bg: '#fef8f0', text: '#3d2010', accent: '#d4802a', border: '#e0c8a8' }
  },
  {
    id: 'arctic',
    order: 13,
    isDark: false,
    labelKey: 'ui.preferences.themeArcticLabel',
    descriptionKey: 'ui.preferences.themeArcticDescription',
    preview: { bg: '#f0f8ff', text: '#0a2540', accent: '#0284c7', border: '#b0d0e8' }
  },
  {
    id: 'parchment',
    order: 14,
    isDark: false,
    labelKey: 'ui.preferences.themeParchmentLabel',
    descriptionKey: 'ui.preferences.themeParchmentDescription',
    preview: { bg: '#f5edd5', text: '#2c2416', accent: '#6b4e2a', border: '#c4b48a' }
  },
  {
    id: 'autumn',
    order: 15,
    isDark: false,
    labelKey: 'ui.preferences.themeAutumnLabel',
    descriptionKey: 'ui.preferences.themeAutumnDescription',
    preview: { bg: '#faf6f0', text: '#2e1a0e', accent: '#b45309', border: '#d0b898' }
  }
];

export const THEME_IDS: readonly ThemeId[] = THEME_TOKENS.map((t) => t.id);

export function isValidThemeId(id: string): id is ThemeId {
  return (THEME_IDS as readonly string[]).includes(id);
}
