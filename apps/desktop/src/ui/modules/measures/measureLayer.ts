/**
 * Pure helpers behind the weights, measures and money layer (task 0069): one
 * chapter's occurrences plus the pane's verses in, per-verse decoration layers
 * and a (verse, word) -> popup models lookup out. No React, no store, no IPC.
 * Mirrors `keywordMarkLayer.ts` (task 0065).
 */
import {
  computeChapterMeasures,
  extractWordsWithFormatting,
  type InterlinearSpan,
  type LayerDecorations,
  type MeasureIndex,
  type MeasureOccurrence,
  type MeasurePopupModel,
  type MeasurePreferences,
  type MeasureSurface,
} from '@bible/core/browser';
import { splitLayerByVerse, type PaneVerse } from '../../extensions/chapterLayers';

export interface MeasureChapter {
  moduleId: number;
  surface: MeasureSurface;
  index: MeasureIndex;
  models: Map<string, MeasurePopupModel>;
  /** Per-verse layers to append to the verse's decoration layers. */
  verseLayers: Map<number, LayerDecorations[]>;
}

export interface ComputeMeasureChapterInput {
  moduleId: number;
  language: string;
  verses: readonly PaneVerse[];
  occurrences: readonly MeasureOccurrence[];
  interlinear?: readonly InterlinearSpan[];
  uiLocale: string;
  prefs: MeasurePreferences;
  surface: MeasureSurface;
}

/** Words are tokenised exactly like the rendered verse (`HighlightedVerse`), so indices agree. */
export function computeMeasureChapter(input: ComputeMeasureChapterInput): MeasureChapter {
  const verses = input.verses.map((v) => ({
    verseId: v.verse_id,
    words: extractWordsWithFormatting(v.text_html || v.text || '').map((w) => ({ text: w.text })),
  }));
  const { layer, index, models } = computeChapterMeasures({
    occurrences: input.occurrences,
    verses,
    moduleLanguage: input.language,
    ...(input.interlinear ? { interlinear: input.interlinear } : {}),
    uiLocale: input.uiLocale,
    prefs: input.prefs,
    surface: input.surface,
  });
  const verseLayers = new Map<number, LayerDecorations[]>();
  for (const [verseId, vl] of splitLayerByVerse(layer)) verseLayers.set(verseId, [vl]);
  return { moduleId: input.moduleId, surface: input.surface, index, models, verseLayers };
}

/** Popup models of the occurrences marked at a word (empty when none). */
export function measureModelsAt(chapter: MeasureChapter | undefined, verseId: number, wordIndex: number): MeasurePopupModel[] {
  if (!chapter) return [];
  const out: MeasurePopupModel[] = [];
  for (const id of chapter.index.at(verseId, wordIndex)) {
    const model = chapter.models.get(id);
    if (model) out.push(model);
  }
  return out;
}
