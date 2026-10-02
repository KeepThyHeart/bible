/**
 * Weights, measures and money notes for one chapter on the web (task 0069):
 * the pure glue between the Bible pane and core's `computeChapterMeasures`.
 * No stores, no DOM beyond the small event helper at the bottom.
 */
import {
  computeChapterMeasures,
  resolveMeasurePreferences,
  type ChapterMeasures,
  type InterlinearSpan,
  type LayerDecorations,
  type MeasureOccurrence,
  type MeasurePreferences,
  type MeasureSurface,
  type ResolvedVerse,
} from '@bible/core/browser';
import type { VerseData } from '../types';
import { resolveChapterLayers, verseWordTexts } from '../keywordMarks/chapterMarks';

/** Verses as core wants them: the same word-index space marks and interlinear rows use. */
export function measureVerseInputs(verses: readonly VerseData[]): { verseId: number; words: { text: string }[] }[] {
  return verses.map((v) => ({ verseId: v.verse_id, words: verseWordTexts(v) }));
}

/** Preferences from the web settings snapshot (`measures*` keys), draft rows only when the flag allows. */
export function webMeasurePreferences(
  values: Record<string, unknown>,
  uiLocale: string,
  includeDrafts: boolean,
): MeasurePreferences {
  return resolveMeasurePreferences(values, uiLocale, { includeDrafts });
}

export interface WebChapterMeasuresInput {
  occurrences: readonly MeasureOccurrence[];
  verses: readonly VerseData[];
  moduleLanguage: string | undefined;
  interlinear?: readonly InterlinearSpan[];
  uiLocale: string;
  prefs: MeasurePreferences;
  surface: MeasureSurface;
}

/** One call: occurrences and verses in, layer, index and popup models out. */
export function computeWebChapterMeasures(input: WebChapterMeasuresInput): ChapterMeasures {
  return computeChapterMeasures({
    occurrences: input.occurrences,
    verses: measureVerseInputs(input.verses),
    moduleLanguage: input.moduleLanguage ?? 'en',
    ...(input.interlinear && input.interlinear.length > 0 ? { interlinear: input.interlinear } : {}),
    uiLocale: input.uiLocale,
    prefs: input.prefs,
    surface: input.surface,
  });
}

/**
 * Per-verse paint for the keyword layer and the measure layer together. With no
 * measure paint the keyword map is returned untouched, so keyword behaviour is
 * exactly what it was without this feature.
 */
export function mergeChapterDecorations(
  verses: readonly VerseData[],
  keywordLayer: LayerDecorations | null | undefined,
  keywordResolved: Map<number, ResolvedVerse> | null,
  measureLayer: LayerDecorations | null | undefined,
  surface: MeasureSurface,
): Map<number, ResolvedVerse> | null {
  if (!measureLayer || measureLayer.decorations.length === 0) return keywordResolved;
  return resolveChapterLayers(verses, [keywordLayer, measureLayer], surface);
}

/** (verseId, wordIndex) of a word element inside a verse, or null. */
export function wordAddress(target: EventTarget | null): { verseId: number; wordIndex: number; el: Element } | null {
  const el = (target as Element | null)?.closest?.('[data-word-index]') ?? null;
  if (!el) return null;
  const verseEl = el.closest('[data-verse-id]');
  const wordIndex = Number(el.getAttribute('data-word-index'));
  const verseId = Number(verseEl?.getAttribute('data-verse-id'));
  if (!verseEl || !Number.isInteger(wordIndex) || !Number.isInteger(verseId)) return null;
  return { verseId, wordIndex, el };
}
