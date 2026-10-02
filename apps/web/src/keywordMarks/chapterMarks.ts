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
  extractWordsWithFormatting,
  matchKeywordMarks,
  toDecorationLayer,
  resolveVerseDecorations,
  resolveThemeColor,
  occurrencesOf,
  type ChapterInput,
  type InterlinearSpan,
  type KeywordMark,
  type KeywordSet,
  type LayerDecorations,
  type MatchResult,
  type ResolvedVerse,
} from '@bible/core/browser';
import type { InterlinearWordData, VerseData } from '../types';
import { normalizeStrongsNumber } from '../utils/interlinearRows';

export type KeywordSurface = 'standard' | 'reading' | 'study';

/** The words of one verse, in the index space marks, highlights and interlinear rows share. */
export function verseWordTexts(verse: Pick<VerseData, 'text_html'>): { text: string }[] {
  return extractWordsWithFormatting(verse.text_html).map((w) => ({ text: w.text }));
}

/**
 * `/api/interlinear` rows as Strong's spans. Rows without an end position are
 * unusable (see `rowsHaveEndPositions`) and rows without a Strong's number
 * carry nothing a mark can match, so both are dropped.
 */
export function interlinearToSpans(rows: readonly InterlinearWordData[] | undefined): InterlinearSpan[] {
  if (!rows) return [];
  const spans: InterlinearSpan[] = [];
  for (const r of rows) {
    if (typeof r.positionEnd !== 'number' || !r.strongsNumber) continue;
    spans.push({
      verseId: r.verseId,
      start: r.position,
      end: r.positionEnd,
      strongs: normalizeStrongsNumber(r.strongsNumber),
      ...(r.morphology ? { morph: r.morphology } : {}),
    });
  }
  return spans;
}

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

/**
 * Resolve the layers into per-word paint for every verse that has any. Verses
 * with nothing to paint are absent from the map, which is what lets the
 * renderer keep its plain markup for them. Several layers (keyword marks and
 * weights-and-measures notes) resolve together, per verse, so a verse that has
 * both still hands the renderer one `ResolvedVerse`.
 */
export function resolveChapterLayers(
  verses: readonly VerseData[],
  layers: readonly (LayerDecorations | null | undefined)[],
  surface: KeywordSurface,
): Map<number, ResolvedVerse> {
  const out = new Map<number, ResolvedVerse>();
  const active = layers.filter((l): l is LayerDecorations => !!l && l.decorations.length > 0);
  if (active.length === 0) return out;
  const painted = new Set<number>();
  for (const layer of active) {
    for (const d of layer.decorations) {
      for (const t of Array.isArray(d.target) ? d.target : [d.target]) {
        if (t.kind === 'tokens') painted.add(t.verseId);
      }
    }
  }
  for (const verse of verses) {
    if (!painted.has(verse.verse_id)) continue;
    const words = verseWordTexts(verse);
    const resolved = resolveVerseDecorations({
      verseId: verse.verse_id, wordCount: words.length, words, layers: active, surface,
      resolveColor: resolveThemeColor,
    });
    if (resolved.words.size > 0) out.set(verse.verse_id, resolved);
  }
  return out;
}

/** The keyword layer on its own (the original single-layer entry point). */
export function resolveChapterDecorations(
  verses: readonly VerseData[],
  layer: LayerDecorations,
  surface: KeywordSurface,
): Map<number, ResolvedVerse> {
  return resolveChapterLayers(verses, [layer], surface);
}

export { occurrencesOf };
