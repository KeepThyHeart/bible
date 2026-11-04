/**
 * Client-side guards for bibsearch queries (CLIENTS.md, "Do not send garbage").
 *
 * The service answers 422 for queries with no real words and counts them toward
 * an automatic ban, so these are refused here and never sent.
 */

export const REMOTE_MAX_QUERY_LENGTH = 512;

export type QueryRule = 'too_short' | 'not_text' | 'repeated';

export type QueryCheck =
  | { ok: true; query: string }
  | { ok: false; rule: QueryRule };

export function checkRemoteQuery(raw: string): QueryCheck {
  const query = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, REMOTE_MAX_QUERY_LENGTH).trim();
  if (query.length < 2) return { ok: false, rule: 'too_short' };
  // Needs at least one letter: digits-only and symbols-only are refused.
  if (!/\p{L}/u.test(query)) return { ok: false, rule: 'not_text' };
  // One repeated character ("aaaa") or one repeated word ("go go go").
  const compact = query.replace(/\s+/g, '');
  if (compact.length >= 3 && new Set(compact.toLowerCase()).size === 1) return { ok: false, rule: 'repeated' };
  const words = query.toLowerCase().split(' ');
  if (words.length >= 3 && new Set(words).size === 1) return { ok: false, rule: 'repeated' };
  return { ok: true, query };
}
