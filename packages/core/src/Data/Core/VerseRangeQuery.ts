/**
 * Reusable SQL fragment builders for verse range queries.
 *
 * These eliminate duplicated WHERE clause logic across repositories that need
 * to check whether a verse or range overlaps with stored verse_id_start/end columns.
 *
 * Each function returns a { sql, params } object. The SQL is a parenthesized
 * fragment suitable for embedding in a WHERE clause.
 */

/**
 * Match rows whose [start, end] range contains a single point (verse).
 * Handles nullable end columns (treats NULL end as single-verse range).
 *
 * SQL: (startCol <= ? AND (endCol IS NULL OR endCol >= ?))
 * Params: [verseId, verseId]
 */
export function verseRangeContainsPoint(
  startCol: string,
  endCol: string,
  verseId: number
): { sql: string; params: number[] } {
  return {
    sql: `(${startCol} <= ? AND (${endCol} IS NULL OR ${endCol} >= ?))`,
    params: [verseId, verseId],
  };
}

/**
 * Match rows whose [start, end] range overlaps with a given [start, end] range.
 * Catches all three overlap cases: start inside range, end inside range, or range fully enclosed.
 *
 * SQL: ((startCol BETWEEN ? AND ?) OR (endCol BETWEEN ? AND ?) OR (startCol <= ? AND endCol >= ?))
 * Params: [startVerseId, endVerseId, startVerseId, endVerseId, startVerseId, endVerseId]
 */
export function verseRangeOverlapsRange(
  startCol: string,
  endCol: string,
  startVerseId: number,
  endVerseId: number
): { sql: string; params: number[] } {
  return {
    sql: `((${startCol} BETWEEN ? AND ?) OR (${endCol} BETWEEN ? AND ?) OR (${startCol} <= ? AND ${endCol} >= ?))`,
    params: [startVerseId, endVerseId, startVerseId, endVerseId, startVerseId, endVerseId],
  };
}

/**
 * Match rows whose [start, end] range overlaps a given range, where the end
 * column is NULLABLE and NULL encodes "single verse" (end == start).
 *
 * Prefer this over {@link verseRangeOverlapsRange} for the unified `verse_link`
 * table and any other table following the canonical range convention (see the
 * normative statement in `Core/Types.ts`). Using COALESCE keeps the two
 * encodings of a single verse - `end IS NULL` and `end = start` -
 * indistinguishable, which is what the convention requires.
 *
 * SQL: (startCol <= ? AND COALESCE(endCol, startCol) >= ?)
 * Params: [endVerseId, startVerseId]
 */
export function verseRangeOverlapsRangeNullable(
  startCol: string,
  endCol: string,
  startVerseId: number,
  endVerseId: number
): { sql: string; params: number[] } {
  return {
    sql: `(${startCol} <= ? AND COALESCE(${endCol}, ${startCol}) >= ?)`,
    params: [endVerseId, startVerseId],
  };
}

/**
 * Match rows where a single verse matches either an exact start or falls within [start, end].
 * For use when end is NOT nullable (always present when it's a range).
 *
 * SQL: (startCol = ? OR (startCol <= ? AND endCol >= ?))
 * Params: [verseId, verseId, verseId]
 */
export function verseRangeMatchesPoint(
  startCol: string,
  endCol: string,
  verseId: number
): { sql: string; params: number[] } {
  return {
    sql: `(${startCol} = ? OR (${startCol} <= ? AND ${endCol} >= ?))`,
    params: [verseId, verseId, verseId],
  };
}
