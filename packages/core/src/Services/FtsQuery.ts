/**
 * Helpers for building safe SQLite FTS5 MATCH expressions.
 *
 * FTS5 treats a handful of characters and bare words as query syntax rather
 * than as text. Passing raw user input straight into a MATCH expression is
 * therefore not just a wrong-results problem - an apostrophe, a hyphen, or the
 * word "not" makes SQLite raise a syntax error, which surfaces as a 500 from
 * any route that forwards the query verbatim.
 */

/** FTS5 bare words that are query operators unless quoted. */
const FTS5_RESERVED_WORDS = ['and', 'or', 'not', 'near'];

/**
 * Escape a single search term for use inside an FTS5 MATCH expression.
 *
 * Terms that need no quoting are returned as-is so they keep the benefit of
 * FTS5's Porter stemmer - searching "walking" still matches "walk"/"walked".
 */
export function escapeFts5Term(term: string): string {
  const isReservedWord = FTS5_RESERVED_WORDS.includes(term.toLowerCase());
  // " ' ( ) : * ^ - all carry meaning in FTS5 query syntax.
  const needsQuoting = isReservedWord || /["'():*^-]/.test(term);

  if (!needsQuoting) return term;

  // Inside a quoted string, a literal double quote is written doubled.
  const escaped = term.includes('"') ? term.replace(/"/g, '""') : term;
  return `"${escaped}"`;
}

/**
 * Escape a whole user-typed phrase into an FTS5 MATCH expression by escaping
 * each whitespace-separated term. Returns an empty string when the input has no
 * usable terms, which callers should treat as "no query" rather than passing on
 * to MATCH.
 */
export function escapeFts5Query(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(escapeFts5Term)
    .join(' ');
}
