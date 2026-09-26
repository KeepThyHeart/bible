/**
 * The closed allowlist of theme colour keys extension verse decorations may
 * reference (task 0036, P0.1a; design doc §12, amendment A3).
 *
 * An extension never picks a literal colour - it picks a *key*, resolved
 * against the active theme at render time. `resolveThemeColor` (the
 * renderer-side companion, next to `decorationResolver.ts`) maps each key to
 * a `--theme-*-rgb` CSS custom property that already exists in
 * `apps/desktop/src/ui/styles/themes.css` for all 15 shipped themes.
 *
 * **Why this list, not the design doc's original proposal.** The design doc
 * (§3.2) proposed `highlight.1`/`highlight.2` and `morph.*` as `-rgb`
 * triplets, assuming they already existed. They did not: `themes.css` only
 * had plain hex literals for the four morphology colours (no `-rgb`
 * companion, so no alpha blending for `tint`/`underline`) and no per-slot
 * `-rgb` variable for the highlight palette at all (only
 * `--theme-highlight-alpha`, a single opacity float shared by the user's own
 * highlight feature). This task added `--theme-morph-{verb,noun,adjective,
 * pronoun}-rgb` next to the existing hex literals, in all 15 themes, because
 * morphology colouring is the design doc's own headline use case ("custom
 * modules will colour words"). It left `highlight.1`/`highlight.2` out
 * rather than invent unanchored colours with no existing precedent - a
 * follow-up can add a real per-theme highlight-adjacent palette when a
 * decorator actually needs one; extending this union later is additive.
 *
 * Every key here MUST resolve to a `--theme-<name>-rgb` variable that exists
 * in every theme block of `themes.css` - `themeColorKeys.test.ts` parses the
 * stylesheet and fails if one is ever missing.
 */
export const THEME_COLOR_KEYS = [
  'accent',
  'danger',
  'success',
  'warning',
  'info',
  'text',
  'text-secondary',
  'text-muted',
  'surface',
  'surface-raised',
  'border',
  'morph.verb',
  'morph.noun',
  'morph.adjective',
  'morph.pronoun',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** True predicate + type guard for validating extension-supplied colour keys. */
export function isThemeColorKey(value: unknown): value is ThemeColorKey {
  return typeof value === 'string' && (THEME_COLOR_KEYS as readonly string[]).includes(value);
}

/**
 * `ThemeColorKey` -> the `--theme-*-rgb` CSS custom property name it resolves
 * to. Renderer-side consumers (`decorationResolver.ts`'s `buildWordPaintStyle`
 * caller) use this to build `rgb(var(--theme-...-rgb) / alpha)` strings.
 *
 * This map is the one place that has to change if `themes.css`'s variable
 * names ever change - the allowlist above is the stable, published contract;
 * these are the private implementation the allowlist protects extensions
 * from depending on directly (design doc §12).
 */
export const THEME_COLOR_CSS_VAR: Record<ThemeColorKey, string> = {
  accent: '--theme-accent-primary-rgb',
  danger: '--theme-danger-rgb',
  success: '--theme-success-rgb',
  warning: '--theme-warning-rgb',
  info: '--theme-info-rgb',
  text: '--theme-text-primary-rgb',
  'text-secondary': '--theme-text-secondary-rgb',
  'text-muted': '--theme-text-muted-rgb',
  surface: '--theme-surface-primary-rgb',
  'surface-raised': '--theme-surface-elevated-rgb',
  border: '--theme-border-primary-rgb',
  'morph.verb': '--theme-morph-verb-rgb',
  'morph.noun': '--theme-morph-noun-rgb',
  'morph.adjective': '--theme-morph-adjective-rgb',
  'morph.pronoun': '--theme-morph-pronoun-rgb',
};

/** The default colour used when a decoration's `color` key is unknown (§12). */
export const DEFAULT_THEME_COLOR_KEY: ThemeColorKey = 'accent';
