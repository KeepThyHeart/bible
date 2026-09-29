/**
 * Adapters between the keyword-mark store and the shared `KeywordLegend` (task 0065).
 */
import type { LegendRow as SharedLegendRow, LegendSuggestion } from '@bible/ui';
import type { KeywordSuggestion } from '@bible/core/browser';
import type { LegendRow as StoreLegendRow } from '../extensions/keywordMarkLayer';

export interface KeywordOccurrence { verseId: number; start: number; end: number }
export type { SharedLegendRow as LegendRow };

/**
 * Store rows to the shared legend's row shape. `showSetNames` adds the owning set when several sets show;
 * `hasInterlinear` false makes connective rows "approximate" (matched by surface form).
 */
export function toSharedRows(
  rows: readonly StoreLegendRow[],
  opts: { showSetNames: boolean; hasInterlinear: boolean },
): SharedLegendRow[] {
  return rows.map((r) => ({
    id: r.markId,
    label: r.mark.label,
    color: r.mark.style.color,
    line: r.mark.style.line,
    ...(r.mark.style.symbol ? { symbol: r.mark.style.symbol } : {}),
    ...(r.mark.style.bold ? { bold: true } : {}),
    count: r.hits,
    hidden: r.hidden,
    ...(r.mark.rule.kind === 'connective' && !opts.hasInterlinear ? { approximate: true } : {}),
    ...(opts.showSetNames ? { setName: r.setName } : {}),
  }));
}

/** Suggestions keyed by position, so accepting one maps back to its rule. */
export function toSharedSuggestions(list: readonly KeywordSuggestion[]): LegendSuggestion[] {
  return list.map((s, i) => ({ key: String(i), label: s.label, count: s.count }));
}

/** The word and kind `addMarkFromWord` needs to create a mark from a suggestion. */
export function suggestionToWord(s: KeywordSuggestion): { word: { text: string; strongs?: string }; kind: 'word' | 'strongs' } | null {
  if (s.rule.kind === 'strongs') return { word: { text: s.label, strongs: s.rule.numbers[0] }, kind: 'strongs' };
  if (s.rule.kind === 'word') return { word: { text: s.rule.forms[0] ?? s.label }, kind: 'word' };
  return null;
}
