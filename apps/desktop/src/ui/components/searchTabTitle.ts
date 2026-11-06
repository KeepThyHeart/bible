/** How many characters of a query a search tab shows before it is cut (the full query is its tooltip). */
export const SEARCH_TAB_TITLE_LENGTH = 24;

/** A search tab's visible title: the query, cut at a code-point boundary with an ellipsis. */
export function searchTabTitle(query: string, max = SEARCH_TAB_TITLE_LENGTH): string {
  const chars = Array.from(query.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}\u2026` : chars.join('');
}
