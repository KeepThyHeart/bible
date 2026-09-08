/**
 * Remembering the last few markup styles the reader actually applied.
 *
 * The quick swatches on the floating toolbar are a fixed guess - four of the
 * six colours, highlight only. Someone whose habit is "wavy red underline for
 * commands, purple wash for promises" never sees either of their two styles
 * there, so every annotation costs a trip through the full menu. The recents
 * row is the fix: whatever they last used is one click away.
 *
 * A remembered style is the whole triple, not a colour. "Wavy red underline"
 * and "red highlight" are different marks that happen to share a hue, so they
 * are separate entries - which is also why the dedup key below covers every
 * field rather than just `color`.
 *
 * Storage follows `copyFormats/passageMarkupPreferences.ts`: one localStorage
 * key, best-effort writes, and validation on read so malformed JSON, a colour
 * that is no longer in the palette, or a localStorage that throws (private
 * mode, quota) degrade to "no recents yet" rather than breaking the toolbar.
 * This is a per-machine UI convenience and is deliberately kept out of the
 * cross-package `SessionData` type, the same reasoning the copy formats'
 * persistence records.
 */

import {
  HIGHLIGHT_COLOR_NAMES,
  type HighlightColor,
  type MarkupType,
  type UnderlineStyle,
} from '@bible/core';

/** One remembered mark: what kind, in what colour, drawn how. */
export interface MarkupStyle {
  markupType: MarkupType;
  /** Highlight colour for `highlight`/`both`; the underline's colour for `underline`. */
  color: HighlightColor;
  underlineStyle?: UnderlineStyle;
  underlineColor?: HighlightColor;
}

const RECENT_MARKUP_STYLES_KEY = 'bible-desktop-recent-markup-styles';

/**
 * Three, because the row sits under a toolbar that is already as wide as the
 * shortest phrase people select - a fourth entry starts overhanging the text
 * it points at.
 */
export const RECENT_MARKUP_STYLES_LIMIT = 3;

const MARKUP_TYPES: readonly MarkupType[] = ['highlight', 'underline', 'both'];
const UNDERLINE_STYLES: readonly UnderlineStyle[] = ['solid', 'wavy', 'dotted', 'dashed'];

function isMarkupType(value: unknown): value is MarkupType {
  return MARKUP_TYPES.includes(value as MarkupType);
}

function isUnderlineStyle(value: unknown): value is UnderlineStyle {
  return UNDERLINE_STYLES.includes(value as UnderlineStyle);
}

function isPaletteColor(value: unknown): value is HighlightColor {
  return HIGHLIGHT_COLOR_NAMES.includes(value as HighlightColor);
}

/**
 * Fill in what the apply paths leave implicit, and strip what they leave stale.
 *
 * Both matter for dedup. The full menu keeps its underline style in local state
 * even while "Highlight" is selected, so the same yellow highlight can arrive
 * once bare and once carrying `underlineStyle: 'wavy'`; without normalisation
 * those are two entries for one visible mark. In the other direction the
 * floating toolbar's underline arrives with no explicit colour at all.
 */
export function normalizeMarkupStyle(style: MarkupStyle): MarkupStyle {
  if (style.markupType === 'highlight') {
    return { markupType: 'highlight', color: style.color };
  }
  return {
    markupType: style.markupType,
    color: style.color,
    underlineStyle: style.underlineStyle ?? 'solid',
    underlineColor: style.underlineColor ?? style.color,
  };
}

/**
 * Identity of a style, for dedup and for React keys. Covers every field: two
 * marks are the same remembered style only if they paint identically.
 */
export function markupStyleKey(style: MarkupStyle): string {
  const normalized = normalizeMarkupStyle(style);
  return [
    normalized.markupType,
    normalized.color,
    normalized.underlineStyle ?? '',
    normalized.underlineColor ?? '',
  ].join(':');
}

/** A stored entry, or null if any field is missing or no longer valid. */
function parseStyle(raw: unknown): MarkupStyle | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  if (!isMarkupType(record.markupType) || !isPaletteColor(record.color)) return null;

  // An unknown underline style or colour is dropped rather than defaulted: the
  // entry exists to reproduce a mark the user made, and silently substituting
  // "solid" would offer them something they never applied.
  if (record.markupType !== 'highlight') {
    if (record.underlineStyle !== undefined && !isUnderlineStyle(record.underlineStyle)) return null;
    if (record.underlineColor !== undefined && !isPaletteColor(record.underlineColor)) return null;
  }

  return normalizeMarkupStyle({
    markupType: record.markupType,
    color: record.color,
    underlineStyle: isUnderlineStyle(record.underlineStyle) ? record.underlineStyle : undefined,
    underlineColor: isPaletteColor(record.underlineColor) ? record.underlineColor : undefined,
  });
}

/** The remembered styles, most recent first. Never throws. */
export function loadRecentMarkupStyles(): MarkupStyle[] {
  let parsed: unknown = null;
  try {
    const raw = localStorage.getItem(RECENT_MARKUP_STYLES_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // Malformed JSON or an unavailable localStorage: no recents.
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const styles: MarkupStyle[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    const style = parseStyle(entry);
    if (!style) continue;
    const key = markupStyleKey(style);
    if (seen.has(key)) continue;
    seen.add(key);
    styles.push(style);
    if (styles.length === RECENT_MARKUP_STYLES_LIMIT) break;
  }
  return styles;
}

/**
 * The list with `style` promoted to the front, deduplicated and capped. Pure -
 * the store owns the list, this owns the ordering rule.
 */
export function withRecentMarkupStyle(existing: MarkupStyle[], style: MarkupStyle): MarkupStyle[] {
  const normalized = normalizeMarkupStyle(style);
  const key = markupStyleKey(normalized);
  const rest = existing.filter(candidate => markupStyleKey(candidate) !== key);
  return [normalized, ...rest].slice(0, RECENT_MARKUP_STYLES_LIMIT);
}

export function persistRecentMarkupStyles(styles: MarkupStyle[]): void {
  try {
    localStorage.setItem(RECENT_MARKUP_STYLES_KEY, JSON.stringify(styles));
  } catch {
    // Best-effort; losing it costs the user one trip through the full menu.
  }
}

export function clearStoredRecentMarkupStyles(): void {
  try {
    localStorage.removeItem(RECENT_MARKUP_STYLES_KEY);
  } catch {
    // Best-effort: the in-memory list is cleared regardless.
  }
}

/** Exported for tests, so they do not hardcode the storage key. */
export const RECENT_MARKUP_STYLES_STORAGE_KEY = RECENT_MARKUP_STYLES_KEY;
