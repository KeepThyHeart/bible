/**
 * Helper utilities for working with highlights
 *
 * ## Colour handling
 *
 * `UserTextMarkup.color` is a `string`, not a {@link HighlightColor}: v2 stores
 * hex `#RRGGBB` and users may pick a colour outside the six-swatch palette,
 * while v1 rows still hold a literal palette name. Everything here therefore
 * groups and counts by the *canonical hex* returned by
 * `UserTextMarkup.getColorHex()`, which normalises both encodings. Use
 * `markupColorName()` when you need the palette swatch, and expect `undefined`
 * for a custom colour.
 */

import {
  UserTextMarkup,
  VerseId,
  HighlightColor,
  MarkupType,
  HIGHLIGHT_COLOR_NAMES,
  HIGHLIGHT_COLOR_HEX,
  markupColorName
} from '@bible/core';

/**
 * Find all highlights that overlap with a given verse range
 *
 * @param verseIdStart - Start verse ID
 * @param verseIdEnd - End verse ID (or same as start for single verse)
 * @param highlights - Array of highlights to check
 * @returns Array of overlapping highlights
 */
export function findOverlappingHighlights(
  verseIdStart: VerseId,
  verseIdEnd: VerseId,
  highlights: UserTextMarkup[]
): UserTextMarkup[] {
  return highlights.filter(h => {
    const hStart = h.verseIdStart;
    const hEnd = h.verseIdEnd || hStart;

    // Ranges overlap if: !(one ends before other starts)
    return !(hEnd < verseIdStart || hStart > verseIdEnd);
  });
}

/**
 * Check if a word is within a highlight range for a specific verse
 *
 * @param verseId - Verse ID
 * @param wordIndex - Word index (0-based)
 * @param highlight - Highlight to check
 * @returns True if the word is highlighted
 */
export function isWordHighlighted(
  verseId: VerseId,
  wordIndex: number,
  highlight: UserTextMarkup
): boolean {
  const range = highlight.getWordRangeForVerse(verseId);

  if (!range) return false;

  const start = range.start;
  const end = range.end ?? Infinity;

  return wordIndex >= start && (end === null || wordIndex <= end);
}

/**
 * Get all highlights for a specific verse
 *
 * @param verseId - Verse ID
 * @param highlights - Array of all highlights
 * @returns Array of highlights that cover this verse
 */
export function getHighlightsForVerse(
  verseId: VerseId,
  highlights: UserTextMarkup[]
): UserTextMarkup[] {
  return highlights.filter(h => h.coversVerse(verseId));
}

/**
 * Group highlights by colour.
 *
 * Keys are canonical `#RRGGBB` hex, so a v1 palette name and its v2 hex land in
 * the same bucket and custom (non-palette) colours are preserved rather than
 * discarded.
 *
 * @param highlights - Array of highlights
 * @returns Map of canonical hex colour to highlights
 */
export function groupByColor(
  highlights: UserTextMarkup[]
): Map<string, UserTextMarkup[]> {
  const grouped = new Map<string, UserTextMarkup[]>();

  for (const highlight of highlights) {
    const hex = highlight.getColorHex();
    const existing = grouped.get(hex) || [];
    grouped.set(hex, [...existing, highlight]);
  }

  return grouped;
}

/**
 * Group highlights by markup type
 *
 * @param highlights - Array of highlights
 * @returns Map of markup type to highlights
 */
export function groupByMarkupType(
  highlights: UserTextMarkup[]
): Map<MarkupType, UserTextMarkup[]> {
  const grouped = new Map<MarkupType, UserTextMarkup[]>();

  for (const highlight of highlights) {
    const type = highlight.getMarkupType();
    const existing = grouped.get(type) || [];
    grouped.set(type, [...existing, highlight]);
  }

  return grouped;
}

/**
 * Calculate total number of highlighted verses
 *
 * @param highlights - Array of highlights
 * @returns Total unique verses highlighted
 */
export function countHighlightedVerses(highlights: UserTextMarkup[]): number {
  const uniqueVerses = new Set<VerseId>();

  for (const highlight of highlights) {
    const start = highlight.verseIdStart;
    const end = highlight.verseIdEnd || start;

    for (let verseId = start; verseId <= end; verseId++) {
      uniqueVerses.add(verseId);
    }
  }

  return uniqueVerses.size;
}

/**
 * Get statistics about highlights
 *
 * `byColor` is keyed by canonical `#RRGGBB` hex. The six palette colours are
 * always present (as 0 when unused); custom colours are added as encountered.
 *
 * @param highlights - Array of highlights
 * @returns Statistics object
 */
export function getHighlightStats(highlights: UserTextMarkup[]): {
  total: number;
  byColor: Record<string, number>;
  byType: Record<MarkupType, number>;
  versesHighlighted: number;
  withNotes: number;
} {
  const byColor: Record<string, number> = {};
  for (const name of HIGHLIGHT_COLOR_NAMES) {
    byColor[HIGHLIGHT_COLOR_HEX[name].toUpperCase()] = 0;
  }

  const byType: Record<MarkupType, number> = {
    highlight: 0,
    underline: 0,
    both: 0
  };

  let withNotes = 0;

  for (const highlight of highlights) {
    const hex = highlight.getColorHex();
    byColor[hex] = (byColor[hex] ?? 0) + 1;
    byType[highlight.getMarkupType()]++;
    if (highlight.hasNote()) withNotes++;
  }

  return {
    total: highlights.length,
    byColor,
    byType,
    versesHighlighted: countHighlightedVerses(highlights),
    withNotes
  };
}

/**
 * Sort highlights by verse order
 *
 * @param highlights - Array of highlights
 * @returns Sorted array
 */
export function sortByVerseOrder(highlights: UserTextMarkup[]): UserTextMarkup[] {
  return [...highlights].sort((a, b) => {
    if (a.verseIdStart !== b.verseIdStart) {
      return a.verseIdStart - b.verseIdStart;
    }

    // If same start verse, sort by text position
    const aTextStart = a.textStart ?? 0;
    const bTextStart = b.textStart ?? 0;
    return aTextStart - bTextStart;
  });
}

/**
 * Sort highlights by creation date (newest first)
 *
 * @param highlights - Array of highlights
 * @returns Sorted array
 */
export function sortByCreatedDate(highlights: UserTextMarkup[]): UserTextMarkup[] {
  return [...highlights].sort((a, b) => {
    const dateA = a.createdDate ? new Date(a.createdDate).getTime() : 0;
    const dateB = b.createdDate ? new Date(b.createdDate).getTime() : 0;
    return dateB - dateA; // Newest first
  });
}

/**
 * Convert highlight to export format (for JSON/CSV export)
 *
 * @param highlight - Highlight to export
 * @returns Exportable object
 */
export function toExportFormat(highlight: UserTextMarkup): {
  verseStart: VerseId;
  verseEnd?: VerseId;
  wordStart?: number;
  wordEnd?: number;
  /** Canonical `#RRGGBB` hex. */
  color: string;
  /** Palette swatch name, when the colour is one of the six; else undefined. */
  colorName?: HighlightColor;
  markupType: MarkupType;
  underlineStyle?: string;
  /** Canonical `#RRGGBB` hex. */
  underlineColor?: string;
  noteId?: number;
  createdDate?: string;
} {
  return {
    verseStart: highlight.verseIdStart,
    verseEnd: highlight.verseIdEnd,
    wordStart: highlight.textStart,
    wordEnd: highlight.textEnd,
    color: highlight.getColorHex(),
    colorName: markupColorName(highlight.color),
    markupType: highlight.getMarkupType(),
    underlineStyle: highlight.hasUnderline() ? highlight.getUnderlineStyle() : undefined,
    underlineColor: highlight.hasUnderline() ? highlight.getUnderlineColor() : undefined,
    noteId: highlight.noteId,
    createdDate: highlight.createdDate
  };
}

/**
 * Export highlights to JSON string
 *
 * @param highlights - Array of highlights to export
 * @returns JSON string
 */
export function exportToJSON(highlights: UserTextMarkup[]): string {
  const exportData = highlights.map(toExportFormat);
  return JSON.stringify(exportData, null, 2);
}

/**
 * Export highlights to CSV string
 *
 * @param highlights - Array of highlights to export
 * @returns CSV string
 */
export function exportToCSV(highlights: UserTextMarkup[]): string {
  const headers = [
    'Verse Start',
    'Verse End',
    'Word Start',
    'Word End',
    'Color',
    'Color Name',
    'Markup Type',
    'Underline Style',
    'Underline Color',
    'Note ID',
    'Created Date'
  ];

  const rows = highlights.map(h => {
    const exp = toExportFormat(h);
    return [
      exp.verseStart,
      exp.verseEnd || '',
      exp.wordStart ?? '',
      exp.wordEnd ?? '',
      exp.color,
      exp.colorName || '',
      exp.markupType,
      exp.underlineStyle || '',
      exp.underlineColor || '',
      exp.noteId || '',
      exp.createdDate || ''
    ];
  });

  const csvRows = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ];

  return csvRows.join('\n');
}

/**
 * Filter highlights by date range
 *
 * @param highlights - Array of highlights
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @returns Filtered highlights
 */
export function filterByDateRange(
  highlights: UserTextMarkup[],
  startDate: Date,
  endDate: Date
): UserTextMarkup[] {
  return highlights.filter(h => {
    if (!h.createdDate) return false;

    const created = new Date(h.createdDate);
    return created >= startDate && created <= endDate;
  });
}

/**
 * Get most recently created highlights
 *
 * @param highlights - Array of highlights
 * @param limit - Number of highlights to return
 * @returns Recent highlights
 */
export function getRecentHighlights(
  highlights: UserTextMarkup[],
  limit: number = 10
): UserTextMarkup[] {
  return sortByCreatedDate(highlights).slice(0, limit);
}

/**
 * Check if two highlights are identical (same verse range and word range)
 *
 * @param a - First highlight
 * @param b - Second highlight
 * @returns True if identical
 */
export function areHighlightsIdentical(
  a: UserTextMarkup,
  b: UserTextMarkup
): boolean {
  return (
    a.verseIdStart === b.verseIdStart &&
    (a.verseIdEnd || a.verseIdStart) === (b.verseIdEnd || b.verseIdStart) &&
    a.textStart === b.textStart &&
    a.textEnd === b.textEnd
  );
}
