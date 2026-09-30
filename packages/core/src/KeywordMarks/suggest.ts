/** "Auto" suggestions: frequent content words in the chapter, grouped by Strong's when rows exist. */
import { normalizeStrongs, primaryLanguage } from './connectives';
import { normalizeToken } from './matcher';
import { displayKeywordLabel } from './displayLabel';
import type { ChapterInput, KeywordSuggestion } from './types';

const STOPWORDS: Record<string, string> = {
  en: 'a about after all also am an and any are as at be because been but by can could did do does for from had has have he her him his i if in into is it its me my no not of on or our out shall she should so than that the their them then there they this those thou thee thy thine to unto up upon us was we were what when which who whom will with would ye you your yea hath saith said things thing',
  es: 'a al algo ante aquel aquella aquí como con contra cual cuando de del desde donde e el ella ellas ellos en entre era eran es esa ese eso esta este esto fue ha han hay la las le les lo los me mi mis muy ni no nos o para pero por porque que quien se ser si sin sobre su sus te tu tus un una uno y ya yo',
};

export interface SuggestOptions { minCount?: number; max?: number }

export function stopwordsFor(language: string): ReadonlySet<string> {
  return new Set((STOPWORDS[primaryLanguage(language)] ?? '').split(/\s+/).filter(Boolean));
}

export function suggestKeywords(input: ChapterInput, opts: SuggestOptions = {}): KeywordSuggestion[] {
  const minCount = opts.minCount ?? 3;
  const max = opts.max ?? 8;
  const stop = stopwordsFor(input.language);
  const byForm = new Map<string, { label: string; count: number; verses: Set<number> }>();
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
      const form = toks.filter((t) => !stop.has(t)).join(' ');
      e.forms.set(form, (e.forms.get(form) ?? 0) + 1);
      byStrongs.set(nums[0], e);
      for (let i = r.start; i <= r.end; i++) covered.add(i);
    }
    verse.words.forEach((w, i) => {
      if (covered.has(i)) return;
      const t = normalizeToken(w.text);
      if (t.length < 3 || stop.has(t) || /^\d+$/.test(t)) return;
      const e = byForm.get(t) ?? { label: t, count: 0, verses: new Set<number>() };
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
    out.push({ label: displayKeywordLabel(e.label, input.language), rule: { kind: 'word', forms: [e.label] }, count: e.count, verses: [...e.verses].sort((a, b) => a - b) });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, max);
}
