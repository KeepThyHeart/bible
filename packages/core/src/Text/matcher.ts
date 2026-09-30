/**
 * Word / phrase / prefix / exact matching over tokenised text.
 *
 * Two layers:
 *  - {@link findPhraseMatches}: literal token-sequence matching (keyword marks).
 *  - {@link compileTermMatcher}: a term list with stemming, prefix wildcards,
 *    exact forms, phrases and exclusions (word groups, similar passages, recite).
 *
 * Term syntax (one entry of `terms`):
 *  - `love`        a word; with stemming on it also matches its inflections
 *  - `lov*`        prefix wildcard: any word starting with "lov" (never stemmed)
 *  - `loving kindness` / `"loving kindness"`  a phrase: consecutive words
 *  - `=loved`      exact (accent- and case-insensitive) form only, never stemmed
 * `exclude` lists forms that must never match ("lovely"); exact forms only.
 */
import { foldWord, normalizeToken, normalizeArchaic, trimEdgePunctuation } from './normalize';
import { tokenizePhrase, tokenizeVerseWords } from './tokenize';
import { getStemmer, type Stemmer } from './stemmers';

// ---- literal phrase matching --------------------------------------------

/** Every `[start, end]` token range where `seq` occurs in `tokens` (both already normalised). */
export function findSequences(tokens: readonly string[], seq: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  if (seq.length === 0) return out;
  for (let i = 0; i + seq.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) { ok = false; break; }
    }
    if (ok) out.push([i, i + seq.length - 1]);
  }
  return out;
}

/**
 * Match surface forms (single words and phrases) against raw tokens: each side
 * goes through {@link normalizeToken}. Ranges are de-duplicated and sorted by start.
 */
export function findPhraseMatches(rawTokens: readonly string[], forms: readonly string[], matchCase = false): [number, number][] {
  const tokens = rawTokens.map((t) => normalizeToken(t, matchCase));
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const form of forms) {
    for (const [s, e] of findSequences(tokens, tokenizePhrase(form, matchCase))) {
      const key = `${s}-${e}`;
      if (!seen.has(key)) { seen.add(key); out.push([s, e]); }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// ---- term matcher -------------------------------------------------------

export interface TermMatcherOptions {
  /** Words, variants, wildcards and phrases; see the module doc. */
  terms: readonly string[];
  /** Forms never to match. */
  exclude?: readonly string[];
  /** Apply the language's stemmer to plain terms. Default true. */
  stem?: boolean;
  /** BCP 47 / ISO 639 tag; selects the stemmer. */
  language?: string;
  /** Also fold archaic English forms (thou/you, hath/has) on both sides. Default false. */
  archaic?: boolean;
}

/** One place a term matched. */
export interface TermMatch {
  /** First and last 0-based word index (equal for a single word). */
  start: number;
  end: number;
  /** The words as written, edge punctuation trimmed, space-joined. */
  form: string;
  /** The term that matched. */
  term: string;
}

export interface TermMatcher {
  readonly stemming: boolean;
  /** All non-overlapping matches in text, in order. Indices are word-index space. */
  matchText(text: string): TermMatch[];
  /** The same over pre-split words (index = array position). */
  matchWords(words: readonly string[]): TermMatch[];
  /** Does a single word match any single-word term (exclusions applied)? */
  matchesWord(word: string): boolean;
}

interface Part { kind: 'exact' | 'stem' | 'prefix'; value: string }
interface CompiledTerm { raw: string; parts: Part[] }

function cleanTerm(raw: string): string {
  return raw.trim().replace(/^"+|"+$/g, '').trim();
}

export function compileTermMatcher(options: TermMatcherOptions): TermMatcher {
  const stemmer: Stemmer | undefined = options.stem === false ? undefined : getStemmer(options.language);
  const fold = (w: string): string => {
    const f = foldWord(w);
    return options.archaic ? normalizeArchaic(f, options.language ?? 'en') : f;
  };

  const compile = (raw: string): CompiledTerm | null => {
    let t = cleanTerm(raw);
    if (!t) return null;
    let forceExact = false;
    if (t.startsWith('=')) { forceExact = true; t = t.slice(1).trim(); }
    const parts: Part[] = [];
    for (const word of t.split(/\s+/)) {
      if (word.endsWith('*')) {
        const v = foldWord(word.slice(0, -1));
        if (v) parts.push({ kind: 'prefix', value: v });
      } else {
        const v = fold(trimEdgePunctuation(word));
        if (!v) continue;
        parts.push(!forceExact && stemmer ? { kind: 'stem', value: stemmer(v) } : { kind: 'exact', value: v });
      }
    }
    return parts.length ? { raw: t, parts } : null;
  };

  const terms = options.terms.map(compile).filter((t): t is CompiledTerm => t !== null);
  const excluded = new Set((options.exclude ?? []).map((t) => foldWord(cleanTerm(t).replace(/^=/, ''))).filter(Boolean));
  const maxLen = terms.reduce((m, t) => Math.max(m, t.parts.length), 1);

  const wordMatches = (part: Part, folded: string): boolean => {
    if (part.kind === 'prefix') return foldWord(folded).startsWith(part.value);
    if (part.kind === 'exact') return folded === part.value;
    return folded === part.value || stemmer!(folded) === part.value;
  };

  const matchWords = (words: readonly string[]): TermMatch[] => {
    // Exclusions and prefixes test the plain fold; term comparison uses the (maybe archaic) fold.
    const plain = words.map((w) => foldWord(trimEdgePunctuation(w)));
    const folded = words.map((w) => fold(trimEdgePunctuation(w)));
    const trimmed = words.map(trimEdgePunctuation);
    const pieces = folded.map((f) => (f.includes('-') ? f.split('-').filter(Boolean) : [f]));
    const out: TermMatch[] = [];
    let i = 0;
    while (i < words.length) {
      let hit: TermMatch | null = null;
      // Longest term first at this position.
      for (let len = Math.min(maxLen, words.length - i); len >= 1 && !hit; len--) {
        for (const term of terms) {
          if (term.parts.length !== len) continue;
          let ok = true;
          for (let k = 0; k < len && ok; k++) {
            const f = folded[i + k];
            if (!f || excluded.has(plain[i + k]) || excluded.has(f)) { ok = false; break; }
            // A hyphenated word matches when the whole or any of its parts does.
            ok = wordMatches(term.parts[k], f) ||
              (pieces[i + k].length > 1 && pieces[i + k].some((p) => !excluded.has(p) && wordMatches(term.parts[k], p)));
          }
          if (ok) {
            hit = { start: i, end: i + len - 1, form: trimmed.slice(i, i + len).join(' '), term: term.raw };
            i += len;
            break;
          }
        }
      }
      if (hit) out.push(hit); else i++;
    }
    return out;
  };

  return {
    stemming: stemmer !== undefined,
    matchWords,
    matchText: (text) => matchWords(tokenizeVerseWords(text).map((w) => w.text)),
    matchesWord: (word) => {
      const hits = matchWords([word]);
      return hits.length > 0;
    },
  };
}

/** Count matches by lower-cased surface form, most frequent first. */
export function countForms(matches: readonly { form: string }[]): Array<{ form: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of matches) {
    const k = x.form.toLowerCase();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([form, count]) => ({ form, count })).sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));
}

/**
 * Split what a user typed into terms and exclusions: separated by commas,
 * `|`, semicolons or new lines; `-lovely` excludes that form.
 */
export function parseTermQuery(query: string): { terms: string[]; exclude: string[] } {
  const parts = query.split(/[,;|\n]+/).map((s) => s.trim()).filter(Boolean);
  return {
    exclude: parts.filter((t) => /^-\S/.test(t)).map((t) => t.slice(1)),
    terms: parts.filter((t) => !/^-\S/.test(t)),
  };
}
