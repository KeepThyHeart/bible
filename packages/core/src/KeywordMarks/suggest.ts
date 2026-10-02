/** "Auto" suggestions: frequent content words in the chapter, grouped by Strong's when rows exist. */
import { normalizeStrongs } from './connectives';
import { normalizeToken } from '../Text';
import { getStopWords } from '../Text/stopwords';
import { displayKeywordLabel, isAllCaps, labelFromToken } from './displayLabel';
import type { ChapterInput, KeywordSuggestion } from './types';

export interface SuggestOptions { minCount?: number; max?: number }

/** Stop words for a language (shared list in `Text/stopwords`); test with a `normalizeToken`ed word. */
export function stopwordsFor(language: string): ReadonlySet<string> {
  return getStopWords(language);
}

export function suggestKeywords(input: ChapterInput, opts: SuggestOptions = {}): KeywordSuggestion[] {
  const minCount = opts.minCount ?? 3;
  const max = opts.max ?? 8;
  const stop = stopwordsFor(input.language);
  const byForm = new Map<string, { label: string; count: number; caps: number; surf: Map<string, number>; verses: Set<number> }>();
  const byStrongs = new Map<string, { count: number; verses: Set<number>; forms: Map<string, number> }>();

  const rowsByVerse = new Map<number, NonNullable<ChapterInput['interlinear']>>();
  for (const r of input.interlinear ?? []) {
    const l = rowsByVerse.get(r.verseId) ?? [];
    l.push(r);
    rowsByVerse.set(r.verseId, l);
  }

  for (const verse of input.verses) {
    const rows = rowsByVerse.get(verse.verseId) ?? [];
    const covered = new Set<number>();
    for (const r of rows) {
      const nums = normalizeStrongs(r.strongs);
      // Skip rows with several numbers (compound/article noise) and one-token function words.
      if (nums.length !== 1) continue;
      const toks: string[] = [];
      for (let i = r.start; i <= r.end && i < verse.words.length; i++) toks.push(normalizeToken(verse.words[i].text));
      if (toks.length === 0 || toks.every((t) => stop.has(t) || t.length < 3)) continue;
      const e = byStrongs.get(nums[0]) ?? { count: 0, verses: new Set<number>(), forms: new Map<string, number>() };
      e.count++; e.verses.add(verse.verseId);
      // Surface spelling (LORD, Lord) is kept for the label; stop words are judged on the normalized form.
      const form = toks.map((t, k) => (stop.has(t) ? '' : labelFromToken(verse.words[r.start + k].text))).filter(Boolean).join(' ');
      e.forms.set(form, (e.forms.get(form) ?? 0) + 1);
      byStrongs.set(nums[0], e);
      for (let i = r.start; i <= r.end; i++) covered.add(i);
    }
    verse.words.forEach((w, i) => {
      if (covered.has(i)) return;
      const t = normalizeToken(w.text);
      if (t.length < 3 || stop.has(t) || /^\d+$/.test(t)) return;
      const e = byForm.get(t) ?? { label: t, count: 0, caps: 0, surf: new Map<string, number>(), verses: new Set<number>() };
      const surf = labelFromToken(w.text);
      if (isAllCaps(surf)) e.caps++;
      else e.surf.set(surf, (e.surf.get(surf) ?? 0) + 1);
      e.count++; e.verses.add(verse.verseId);
      byForm.set(t, e);
    });
  }

  const out: KeywordSuggestion[] = [];
  for (const [num, e] of byStrongs) {
    if (e.count < minCount) continue;
    const label = [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ label: displayKeywordLabel(label, input.language), rule: { kind: 'strongs', numbers: [num] }, count: e.count, verses: [...e.verses].sort((a, b) => a - b) });
  }
  for (const e of byForm.values()) {
    if (e.count < minCount) continue;
    out.push({ label: displayKeywordLabel(e.caps * 2 > e.count ? e.label.toUpperCase() : [...e.surf.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? e.label, input.language), rule: { kind: 'word', forms: [e.label] }, count: e.count, verses: [...e.verses].sort((a, b) => a - b) });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, max);
}
