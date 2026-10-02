/**
 * The keyword-mark matcher: rules + one chapter in, per-verse hits and counts out.
 * Pure TypeScript; no DOM, no store. Indices are the English word-index space
 * (`extractWordsWithFormatting`) that interlinear rows and decorations address.
 */
import { normalizeToken, tokenizePhrase, findPhraseMatches } from '../Text';
import { connectiveForms, normalizeStrongs, CONNECTIVE_LEXICON, primaryLanguage } from './connectives';
import type {
  ChapterInput, InterlinearSpan, KeywordMark, KeywordSet, MarkHit, MatchResult,
} from './types';

export { normalizeToken, tokenizePhrase };

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

const matchForms = findPhraseMatches;

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
