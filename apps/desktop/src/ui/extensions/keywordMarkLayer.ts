/**
 * Pure helpers behind the keyword-mark layer (task 0065): chapter input from
 * the verses a pane holds, the active sets for a tab, the match and its
 * decoration layer split per verse, and legend rows. No React, no store, no IPC.
 */
import {
  extractWordsWithFormatting,
  matchKeywordMarks,
  toDecorationLayer,
  primaryLanguage,
  VerseIdHelper,
  type ChapterInput,
  type InterlinearSpan,
  type KeywordMark,
  type KeywordSet,
  type LayerDecorations,
  type MatchResult,
} from '@bible/core/browser';

/** Per Bible tab keyword-mark state. */
export interface TabKeywordState {
  enabled: boolean;
  /** `null` means "automatic": the built-in connectives set for the tab's language plus every user set. */
  activeSetIds: string[] | null;
  hiddenMarkIds: string[];
}

export const DEFAULT_TAB_STATE: Readonly<TabKeywordState> = Object.freeze({
  enabled: false,
  activeSetIds: null,
  hiddenMarkIds: [],
});

/** The verse fields the pane already has. */
export interface PaneVerse {
  verse_id: number;
  text_html?: string | null;
  text?: string | null;
}

export interface LegendRow {
  markId: string;
  setId: string;
  setName: string;
  mark: KeywordMark;
  hits: number;
  verseCount: number;
  hidden: boolean;
}

/** `book.chapter` of a verse id. */
export function chapterIdOf(verseId: number): string {
  const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
  return `${bookNumber}.${chapter}`;
}

/** Match input for a chapter, tokenised exactly like the rendered words (same index space as highlights). */
export function buildChapterInput(
  moduleId: number,
  language: string,
  verses: readonly PaneVerse[],
  interlinear?: InterlinearSpan[],
): ChapterInput {
  return {
    moduleId,
    language,
    verses: verses.map((v) => ({
      verseId: v.verse_id,
      words: extractWordsWithFormatting(v.text_html || v.text || '').map((w) => ({ text: w.text })),
    })),
    ...(interlinear ? { interlinear } : {}),
  };
}

/** Flatten `bible:getInterlinearWordsForChapter` (`{verseId: rows[]}`) into match spans. */
export function interlinearToSpans(
  byVerse: Record<string, { wordPositionStart: number; wordPositionEnd: number; strongsNumber?: string; morphology?: string }[]> | null | undefined,
): InterlinearSpan[] {
  const out: InterlinearSpan[] = [];
  for (const [verseKey, rows] of Object.entries(byVerse ?? {})) {
    const verseId = Number(verseKey);
    if (!Number.isFinite(verseId)) continue;
    for (const r of rows ?? []) {
      out.push({
        verseId,
        start: r.wordPositionStart,
        end: r.wordPositionEnd,
        ...(r.strongsNumber ? { strongs: r.strongsNumber } : {}),
        ...(r.morphology ? { morph: r.morphology } : {}),
      });
    }
  }
  return out;
}

/** The set ids a tab shows: its explicit choice, else built-in connectives for the language plus all user sets. */
export function resolveActiveSetIds(all: readonly KeywordSet[], tab: TabKeywordState, language: string): string[] {
  if (tab.activeSetIds) return tab.activeSetIds.filter((id) => all.some((s) => s.id === id));
  const lang = primaryLanguage(language);
  return all
    .filter((s) => (s.builtIn ? !!s.language && primaryLanguage(s.language) === lang : true))
    .map((s) => s.id);
}

export function resolveActiveSets(all: readonly KeywordSet[], tab: TabKeywordState, language: string): KeywordSet[] {
  const ids = new Set(resolveActiveSetIds(all, tab, language));
  return all.filter((s) => ids.has(s.id));
}

/** Split a layer into one layer per verse so each verse holds a stable, small decoration list. */
export function splitLayerByVerse(layer: LayerDecorations): Map<number, LayerDecorations> {
  const byVerse = new Map<number, LayerDecorations>();
  for (const d of layer.decorations) {
    const targets = Array.isArray(d.target) ? d.target : [d.target];
    const grouped = new Map<number, typeof targets>();
    for (const t of targets) {
      if (t.kind !== 'tokens') continue;
      const list = grouped.get(t.verseId) ?? [];
      list.push(t);
      grouped.set(t.verseId, list);
    }
    for (const [verseId, list] of grouped) {
      let vl = byVerse.get(verseId);
      if (!vl) {
        vl = { ...layer, decorations: [] };
        byVerse.set(verseId, vl);
      }
      vl.decorations.push({ ...d, target: list });
    }
  }
  return byVerse;
}

export interface ChapterMarks {
  input: ChapterInput;
  result: MatchResult;
  sets: KeywordSet[];
  /** Per-verse layers to append to the verse's decoration layers. */
  verseLayers: Map<number, LayerDecorations[]>;
}

export function computeChapterMarks(
  input: ChapterInput,
  sets: KeywordSet[],
  opts: { colorSafe: boolean; hiddenMarkIds: readonly string[] },
): ChapterMarks {
  const result = matchKeywordMarks(input, sets);
  const layer = toDecorationLayer(result, sets, { colorSafe: opts.colorSafe, hiddenMarkIds: new Set(opts.hiddenMarkIds) });
  const verseLayers = new Map<number, LayerDecorations[]>();
  for (const [verseId, vl] of splitLayerByVerse(layer)) verseLayers.set(verseId, [vl]);
  return { input, result, sets, verseLayers };
}

/** One legend row per enabled mark of the active sets (zero hits included). */
export function legendRowsFor(marks: ChapterMarks, hiddenMarkIds: readonly string[]): LegendRow[] {
  const hidden = new Set(hiddenMarkIds);
  const rows: LegendRow[] = [];
  const seen = new Set<string>();
  for (const set of marks.sets) {
    if (set.language && primaryLanguage(set.language) !== primaryLanguage(marks.input.language)) continue;
    for (const mark of set.marks) {
      if (!mark.enabled || seen.has(mark.id)) continue;
      seen.add(mark.id);
      const c = marks.result.counts.get(mark.id);
      rows.push({
        markId: mark.id, setId: set.id, setName: set.name, mark,
        hits: c?.hits ?? 0, verseCount: c?.verses.length ?? 0, hidden: hidden.has(mark.id),
      });
    }
  }
  return rows;
}

/** Append the keyword layers to a verse's layers; returns `base` itself when there is nothing to add. */
export function appendKeywordLayers(base: LayerDecorations[], extra: LayerDecorations[] | undefined): LayerDecorations[] {
  return extra && extra.length > 0 ? [...base, ...extra] : base;
}
