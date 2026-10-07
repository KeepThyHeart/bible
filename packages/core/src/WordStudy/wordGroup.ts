/**
 * User-defined word groups: a list of words and variants treated as one
 * study subject (a custom synonym / inflection list), optionally widened by
 * per-language stemming. Works on any translation's own text, so it is not
 * limited to Greek or Hebrew.
 *
 * Term syntax (one entry of {@link WordGroup.terms}):
 *  - `love`        a word; with stemming on it also matches its inflections
 *  - `lov*`        prefix wildcard: any word starting with "lov" (never stemmed)
 *  - `loving kindness` / `"loving kindness"`  a phrase: consecutive words
 *  - `=loved`      exact (accent- and case-insensitive) form only, never stemmed
 * {@link WordGroup.exclude} lists forms that must never match ("lovely").
 */

import { foldWord, tokenizeVerseWords, getStemmer, type Stemmer } from '../Text';

export interface WordGroup {
  /** Stable id (user-data item key). */
  id: string;
  /** Display name, e.g. "love". */
  label: string;
  /** Words, variants, wildcards and phrases; see the module doc. */
  terms: string[];
  /** Forms never to match. Same syntax as `terms`, but exact forms only. */
  exclude?: string[];
  /** Apply the module language's stemmer to plain terms. Default true. */
  stem?: boolean;
  /** Free-text note. */
  notes?: string;
}

/** One place a group matched in a verse. */
export interface GroupMatch {
  /** First and last 0-based word index (equal for a single word). */
  start: number;
  end: number;
  /** The words as written, edge punctuation trimmed, space-joined. */
  form: string;
  /** The group term that matched. */
  term: string;
}

export interface WordGroupMatcher {
  readonly group: WordGroup;
  readonly stemming: boolean;
  /** All non-overlapping matches in verse text, in order. */
  matchText(text: string): GroupMatch[];
}

interface CompiledTerm {
  raw: string;
  /** Each element is one word of the term (a phrase has several). */
  parts: Array<{ kind: 'exact' | 'stem' | 'prefix'; value: string }>;
}

function cleanTerm(raw: string): string {
  return raw.trim().replace(/^"+|"+$/g, '').trim();
}

function compileTerm(raw: string, stemmer: Stemmer | undefined): CompiledTerm | null {
  let t = cleanTerm(raw);
  if (!t) return null;
  let forceExact = false;
  if (t.startsWith('=')) { forceExact = true; t = t.slice(1).trim(); }
  const parts: CompiledTerm['parts'] = [];
  for (const word of t.split(/\s+/)) {
    if (word.endsWith('*')) {
      const v = foldWord(word.slice(0, -1));
      if (v) parts.push({ kind: 'prefix', value: v });
    } else {
      const v = foldWord(word.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''));
      if (!v) continue;
      parts.push(!forceExact && stemmer ? { kind: 'stem', value: stemmer(v) } : { kind: 'exact', value: v });
    }
  }
  return parts.length ? { raw: t, parts } : null;
}

/**
 * Compile a group for matching against text in `language` (BCP 47 / ISO 639,
 * e.g. the module's `languageCode`). Stemming is used when the group asks for
 * it (the default) and a stemmer exists for the language.
 */
export function compileWordGroup(group: WordGroup, language?: string): WordGroupMatcher {
  const stemmer = group.stem === false ? undefined : getStemmer(language);
  const terms = group.terms.map(t => compileTerm(t, stemmer)).filter((t): t is CompiledTerm => t !== null);
  const excluded = new Set(
    (group.exclude ?? []).map(t => foldWord(cleanTerm(t).replace(/^=/, ''))).filter(Boolean)
  );
  const maxLen = terms.reduce((m, t) => Math.max(m, t.parts.length), 1);

  const wordMatches = (part: CompiledTerm['parts'][number], folded: string): boolean => {
    if (part.kind === 'prefix') return folded.startsWith(part.value);
    if (part.kind === 'exact') return folded === part.value;
    return folded === part.value || stemmer!(folded) === part.value;
  };

  const matchText = (text: string): GroupMatch[] => {
    const words = tokenizeVerseWords(text);
    const folded = words.map(w => foldWord(w.text));
    const parts = folded.map(f => (f.includes('-') ? f.split('-').filter(Boolean) : [f]));
    const out: GroupMatch[] = [];
    let i = 0;
    while (i < words.length) {
      let hit: GroupMatch | null = null;
      // Longest term first at this position.
      for (let len = Math.min(maxLen, words.length - i); len >= 1 && !hit; len--) {
        for (const term of terms) {
          if (term.parts.length !== len) continue;
          let ok = true;
          for (let k = 0; k < len && ok; k++) {
            const f = folded[i + k];
            if (!f || excluded.has(f)) { ok = false; break; }
            // A hyphenated word matches when the whole or any of its parts does.
            ok = wordMatches(term.parts[k], f) ||
              (parts[i + k].length > 1 && parts[i + k].some(p => !excluded.has(p) && wordMatches(term.parts[k], p)));
          }
          if (ok) {
            hit = {
              start: words[i].index,
              end: words[i + len - 1].index,
              form: words.slice(i, i + len).map(w => w.text).join(' '),
              term: term.raw,
            };
            i += len;
            break;
          }
        }
      }
      if (hit) out.push(hit); else i++;
    }
    return out;
  };

  return { group, stemming: stemmer !== undefined, matchText };
}

/** Normalise a user-edited group: trim, drop empties/duplicates, ensure id and label. */
export function normalizeWordGroup(g: Partial<WordGroup> & { terms: string[] }): WordGroup {
  const uniq = (xs: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of xs) {
      const c = x.trim();
      const key = foldWord(c);
      if (c && !seen.has(key)) { seen.add(key); out.push(c); }
    }
    return out;
  };
  const terms = uniq(g.terms);
  const label = (g.label ?? '').trim() || terms[0] || '';
  const id = (g.id ?? '').trim() ||
    `wg-${foldWord(label).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'group'}-${Date.now().toString(36)}`;
  const exclude = uniq(g.exclude ?? []);
  return { id, label, terms, ...(exclude.length ? { exclude } : {}), stem: g.stem !== false,
    ...(g.notes ? { notes: g.notes } : {}) };
}

/**
 * Build a group from what a user typed: terms separated by commas, `|`,
 * semicolons or new lines ("love, loved, beloved, lov*"). A single term gets
 * the term as its label.
 */
export function groupFromQuery(query: string): WordGroup {
  const parts = query.split(/[,;|\n]+/).map(s => s.trim()).filter(Boolean);
  // "-lovely" excludes that form (a bare "-" is not a term).
  const exclude = parts.filter(t => /^-\S/.test(t)).map(t => t.slice(1));
  const terms = parts.filter(t => !/^-\S/.test(t));
  const id = `adhoc-${foldWord(terms.join('-'))}${exclude.length ? `-x-${foldWord(exclude.join('-'))}` : ''}`;
  return normalizeWordGroup({ id, label: terms[0] ?? query.trim(), terms, ...(exclude.length ? { exclude } : {}) });
}
