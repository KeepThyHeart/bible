/**
 * The keyword-mark matcher: rules + one chapter in, per-verse hits and counts out.
 * Pure TypeScript; no DOM, no store. Indices are the English word-index space
 * (`extractWordsWithFormatting`) that interlinear rows and decorations address.
 */
import { connectiveForms, normalizeStrongs, CONNECTIVE_LEXICON, primaryLanguage } from './connectives';
import type {
  ChapterInput, InterlinearSpan, KeywordMark, KeywordSet, MarkHit, MatchResult,
} from './types';

const EDGE_PUNCT = /^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu;

/** Matching form of a token: NFC, edge punctuation stripped, curly apostrophes folded, case-folded. */
export function normalizeToken(text: string, matchCase = false): string {
  let s = text.normalize('NFC').replace(/[‘’]/g, "'").replace(EDGE_PUNCT, '');
  if (!matchCase) s = s.toLowerCase();
  return s;
}

/** Split a phrase / multi-word form into matching tokens. */
export function tokenizePhrase(text: string, matchCase = false): string[] {
  return text.split(/\s+/).map((w) => normalizeToken(w, matchCase)).filter((w) => w.length > 0);
}

/** True when a set is active for this chapter (language, scope). */
export function setAppliesTo(set: KeywordSet, input: ChapterInput): boolean {
  if (set.language && primaryLanguage(set.language) !== primaryLanguage(input.language)) return false;
  return true;
}

function verseInScope(set: KeywordSet, verseId: number): boolean {
  const s = set.scope;
  switch (s.kind) {
    case 'everywhere': return true;
    case 'books': return s.books.includes(Math.floor(verseId / 1_000_000));
    case 'passage': return verseId >= s.start && verseId <= s.end;
  }
}

function findSequences(tokens: string[], seq: string[]): [number, number][] {
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

/** Match surface forms (single words and phrases) in one verse. */
function matchForms(rawTokens: string[], forms: string[], matchCase: boolean): [number, number][] {
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

function isAnchoredMark(mark: KeywordMark): boolean {
  return mark.rule.kind === 'connective';
}

/**
 * Find every hit of every enabled mark of the given sets in the chapter.
 * Sets that do not apply (language) are skipped; scope is applied per verse.
 */
export function matchKeywordMarks(input: ChapterInput, sets: KeywordSet[]): MatchResult {
  const byVerse = new Map<number, MarkHit[]>();
  const counts = new Map<string, { hits: number; verses: number[] }>();
  const rows = input.interlinear;
  const haveRows = !!rows && rows.length > 0;
  const rowsByVerse = new Map<number, InterlinearSpan[]>();
  if (rows) for (const r of rows) {
    const list = rowsByVerse.get(r.verseId) ?? [];
    list.push(r);
    rowsByVerse.set(r.verseId, list);
  }
  let needsInterlinear = false;
  let wantsInterlinear = false;
  const language = primaryLanguage(input.language);

  const add = (verseId: number, hit: MarkHit): void => {
    const list = byVerse.get(verseId) ?? [];
    if (list.some((h) => h.markId === hit.markId && h.start === hit.start && h.end === hit.end)) return;
    list.push(hit);
    byVerse.set(verseId, list);
    const c = counts.get(hit.markId) ?? { hits: 0, verses: [] };
    c.hits++;
    if (!c.verses.includes(verseId)) c.verses.push(verseId);
    counts.set(hit.markId, c);
  };

  for (const set of sets) {
    if (!setAppliesTo(set, input)) continue;
    for (const mark of set.marks) {
      if (!mark.enabled) continue;
      // Every active mark shows in the legend, even at zero hits.
      if (!counts.has(mark.id)) counts.set(mark.id, { hits: 0, verses: [] });
      const rule = mark.rule;
      if (rule.kind === 'strongs' && !haveRows) needsInterlinear = true;
      if (isAnchoredMark(mark) && !haveRows) wantsInterlinear = true;
      const wanted = rule.kind === 'strongs' ? new Set(rule.numbers.flatMap((n) => normalizeStrongs(n))) : null;
      const forms = rule.kind === 'word' ? rule.forms
        : rule.kind === 'phrase' ? [rule.text]
        : rule.kind === 'connective' ? connectiveForms(rule.category, language) : [];
      const matchCase = (rule.kind === 'word' || rule.kind === 'phrase') && !!rule.matchCase;

      for (const verse of input.verses) {
        if (!verseInScope(set, verse.verseId)) continue;
        const raw = verse.words.map((w) => w.text);
        if (rule.kind === 'strongs') {
          if (!wanted || wanted.size === 0) continue;
          for (const r of rowsByVerse.get(verse.verseId) ?? []) {
            if (normalizeStrongs(r.strongs).some((n) => wanted.has(n))) {
              add(verse.verseId, { markId: mark.id, start: r.start, end: Math.min(r.end, raw.length - 1) });
            }
          }
        } else if (rule.kind === 'connective') {
          const found = matchForms(raw, forms, false);
          if (!haveRows) {
            for (const [s, e] of found) add(verse.verseId, { markId: mark.id, start: s, end: e, loose: true });
          } else {
            const anchors = new Set(CONNECTIVE_LEXICON[rule.category].anchors);
            const anchored = (rowsByVerse.get(verse.verseId) ?? []).filter((r) =>
              normalizeStrongs(r.strongs).some((n) => anchors.has(n)));
            for (const [s, e] of found) {
              if (anchored.some((r) => r.start <= e && r.end >= s)) add(verse.verseId, { markId: mark.id, start: s, end: e });
            }
          }
        } else {
          for (const [s, e] of matchForms(raw, forms, matchCase)) add(verse.verseId, { markId: mark.id, start: s, end: e });
        }
      }
    }
  }
  for (const list of byVerse.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return { byVerse, counts, needsInterlinear, wantsInterlinear };
}

/** Every hit in reading order, for "step through occurrences". */
export function occurrencesOf(result: MatchResult, markId: string): { verseId: number; start: number; end: number }[] {
  const out: { verseId: number; start: number; end: number }[] = [];
  const verses = [...result.byVerse.keys()].sort((a, b) => a - b);
  for (const v of verses) {
    for (const h of result.byVerse.get(v) ?? []) if (h.markId === markId) out.push({ verseId: v, start: h.start, end: h.end });
  }
  return out;
}
