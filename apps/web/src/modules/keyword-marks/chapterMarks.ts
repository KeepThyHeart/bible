/**
 * Keyword marks for one chapter: the pure, framework-free pieces the web
 * store and the Bible pane wire together (task 0065).
 *
 *   verses + interlinear rows --> ChapterInput --> matchKeywordMarks
 *     --> toDecorationLayer --> resolveVerseDecorations (per verse)
 *
 * Nothing here reads a store or touches the DOM.
 */
import {
  matchKeywordMarks,
  toDecorationLayer,
  occurrencesOf,
  type ChapterInput,
  type InterlinearSpan,
  type KeywordMark,
  type KeywordSet,
  type LayerDecorations,
  type MatchResult,
  type ResolvedVerse,
} from '@bible/core/browser';
import type { VerseData } from '../../types';
import { resolveChapterLayers, verseWordTexts, type ReaderSurface } from '../../host/chapterLayers';

export type KeywordSurface = ReaderSurface;

export function buildChapterInput(
  moduleId: number,
  language: string,
  verses: readonly VerseData[],
  interlinear?: InterlinearSpan[],
): ChapterInput {
  return {
    moduleId,
    language,
    verses: verses.map((v) => ({ verseId: v.verse_id, words: verseWordTexts(v) })),
    ...(interlinear && interlinear.length > 0 ? { interlinear } : {}),
  };
}

export interface LegendRow {
  markId: string;
  setId: string;
  setName: string;
  label: string;
  style: KeywordMark['style'];
  hits: number;
  verses: number[];
  hidden: boolean;
}

/** One legend row per enabled mark that hit at least once in the chapter, biggest first. */
export function legendRows(
  result: MatchResult,
  sets: readonly KeywordSet[],
  hiddenMarkIds: ReadonlySet<string>,
): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const set of sets) {
    for (const mark of set.marks) {
      const count = result.counts.get(mark.id);
      if (!mark.enabled || !count || count.hits === 0) continue;
      rows.push({
        markId: mark.id, setId: set.id, setName: set.name, label: mark.label, style: mark.style,
        hits: count.hits, verses: count.verses, hidden: hiddenMarkIds.has(mark.id),
      });
    }
  }
  return rows.sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label));
}

export interface ChapterMarks {
  input: ChapterInput;
  result: MatchResult;
  layer: LayerDecorations;
  legend: LegendRow[];
}

export interface ChapterMarksOptions {
  colorSafe: boolean;
  hiddenMarkIds: ReadonlySet<string>;
}

/** Match the sets against the chapter and build the paint layer and legend. */
export function computeChapterMarks(
  input: ChapterInput,
  sets: KeywordSet[],
  opts: ChapterMarksOptions,
): ChapterMarks {
  const result = matchKeywordMarks(input, sets);
  const layer = toDecorationLayer(result, sets, { colorSafe: opts.colorSafe, hiddenMarkIds: opts.hiddenMarkIds });
  return { input, result, layer, legend: legendRows(result, sets, opts.hiddenMarkIds) };
}

/** The keyword layer on its own, resolved per verse (the host merges several layers the same way). */
export function resolveChapterDecorations(
  verses: readonly VerseData[],
  layer: LayerDecorations,
  surface: KeywordSurface,
): Map<number, ResolvedVerse> {
  return resolveChapterLayers(verses, [layer], surface);
}

export { occurrencesOf };
