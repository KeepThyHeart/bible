/**
 * Renderer-side companion to `@bible/core`'s `THEME_COLOR_KEYS` (task 0036,
 * P0.1a; design doc §12).
 *
 * Resolves a decoration's colour KEY to a `var(--theme-*-rgb)` CSS colour
 * expression - never a literal colour - so the browser evaluates it against
 * whatever `[data-theme]` is active. A theme switch therefore repaints every
 * extension decoration with zero invalidation, zero re-fetch and zero
 * re-resolve (this is why `invalidateOn: ['theme.changed']` is rarely
 * needed).
 *
 * Unknown-key behaviour (design doc §12): the colour SLOT is dropped, not
 * the decoration - callers pass `DEFAULT_THEME_COLOR_KEY` as a fallback for
 * required-colour appearance kinds (`tint`/`underline`) so a decoration with
 * a typo'd key still renders, just without its author's chosen colour. This
 * resolver itself is total (it accepts any string and falls back), so it is
 * validation-agnostic - `uiApiImpl.ts`'s DTO validator is what actually
 * drops a decoration when dropping the slot would leave it invisible.
 */

import { THEME_COLOR_CSS_VAR, DEFAULT_THEME_COLOR_KEY, isThemeColorKey } from '../Extensions/themeColorKeys';

export function resolveThemeColor(colorKey: string, alpha = 1): string {
  const key = isThemeColorKey(colorKey) ? colorKey : DEFAULT_THEME_COLOR_KEY;
  const cssVar = THEME_COLOR_CSS_VAR[key];
  return alpha >= 1 ? `rgb(var(${cssVar}))` : `rgb(var(${cssVar}) / ${alpha})`;
}
