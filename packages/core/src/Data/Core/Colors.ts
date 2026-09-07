/**
 * Markup colour handling.
 *
 * `user_text_markup.color` and `collection.color` both store hex. Reads also
 * accept one of six literal palette *names* (`yellow`, `green`, ...), which
 * standardises on hex `#RRGGBB` everywhere; the six names survive as a UI
 * palette constant.
 *
 * This is **live user data**, so the read path must accept both shapes forever
 * (or at least until a user-database migration rewrites existing rows). Writes
 * always emit hex.
 */

import { HighlightColor } from './Types';

/** The six-name UI palette, in display order. */
export const HIGHLIGHT_COLOR_NAMES: readonly HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'red',
  'purple',
  'orange'
] as const;

/**
 * Canonical name -> hex mapping for the UI palette.
 *
 * These are the values written to `user_text_markup.color` when a user picks a
 * palette swatch, and the values a palette name resolves to on read.
 */
export const HIGHLIGHT_COLOR_HEX: Readonly<Record<HighlightColor, string>> = Object.freeze({
  yellow: '#FFF3A3',
  green: '#B7E4C7',
  blue: '#B8DDF5',
  red: '#F7B7B7',
  purple: '#D9C2F0',
  orange: '#FBD1A2'
});

/** Reverse lookup, hex (upper-case) -> palette name. */
const HEX_TO_NAME: ReadonlyMap<string, HighlightColor> = new Map(
  HIGHLIGHT_COLOR_NAMES.map(name => [HIGHLIGHT_COLOR_HEX[name].toUpperCase(), name])
);

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SHORT_HEX_PATTERN = /^#[0-9a-fA-F]{3}$/;

/** True if the value is a `#RRGGBB` colour string. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_PATTERN.test(value);
}

/** True if the value is one of the six palette names. */
export function isHighlightColorName(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (HIGHLIGHT_COLOR_NAMES as readonly string[]).includes(value);
}

/**
 * Normalise a stored colour to canonical `#RRGGBB`.
 *
 * Accepts, in order of preference:
 * - hex (`#RRGGBB`) - returned upper-cased
 * - short hex (`#RGB`) - expanded
 * - palette name (`yellow`, ...) - mapped via {@link HIGHLIGHT_COLOR_HEX}
 *
 * COMPAT (v1 fallback,
 * only because shipped user databases still hold literal names. Once a user-DB
 * migration rewrites `user_text_markup.color` to hex, that branch and
 * {@link isHighlightColorName} can go.
 *
 * @param value - The stored colour value
 * @param fallback - Returned when `value` is unrecognised (default: yellow hex)
 */
export function normalizeMarkupColor(
  value: unknown,
  fallback: string = HIGHLIGHT_COLOR_HEX.yellow
): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();

  if (HEX_PATTERN.test(trimmed)) return trimmed.toUpperCase();

  if (SHORT_HEX_PATTERN.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  // --- literal palette names ------------------------------------------------
  const lower = trimmed.toLowerCase();
  if (isHighlightColorName(lower)) return HIGHLIGHT_COLOR_HEX[lower].toUpperCase();
  // -------------------------------------------------------------------------

  return fallback;
}

/**
 * Resolve a stored colour back to a palette name, when it is one of the six.
 * Returns undefined for custom colours - callers should fall back to the hex.
 */
export function markupColorName(value: unknown): HighlightColor | undefined {
  if (isHighlightColorName(value)) return value;
  if (typeof value !== 'string') return undefined;
  return HEX_TO_NAME.get(normalizeMarkupColor(value, ''));
}
