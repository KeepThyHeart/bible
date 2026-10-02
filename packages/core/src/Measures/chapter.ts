/**
 * One call for apps: occurrences + verse words (+ interlinear) in, decoration
 * layer + index + popup models out. Call it like keyword marks' chapterMarks.
 */
import type { LayerDecorations } from '../Annotations/DecorationResolver';
import type { InterlinearSpan } from '../KeywordMarks/types';
import { resolveMeasureAnchors } from './anchor';
import { buildMeasureLayer, emptyMeasureLayer, MeasureIndex, type MeasureSurface } from './layer';
import { getMeasureLocalePack } from './locale';
import { buildMeasurePopup } from './popup';
import { getMeasureRegistry, type MeasureRegistry } from './registry';
import type {
  MeasureLocalePack, MeasureOccurrence, MeasurePopupModel, MeasurePreferences, MeasureVerseInput, ResolvedMeasureAnchor,
} from './types';

export interface ComputeChapterMeasuresInput {
  occurrences: readonly MeasureOccurrence[];
  /** Words per verse in the shared word-index space. */
  verses: readonly MeasureVerseInput[];
  /** Language of the Bible module text (BCP 47). */
  moduleLanguage: string;
  interlinear?: readonly InterlinearSpan[];
  /** UI locale: popup strings, number and clock formats. */
  uiLocale: string;
  prefs: MeasurePreferences;
  surface: MeasureSurface;
  /** Overrides, for tests. */
  registry?: MeasureRegistry;
  modulePack?: MeasureLocalePack;
  uiPack?: MeasureLocalePack;
}

export interface ChapterMeasures {
  layer: LayerDecorations;
  index: MeasureIndex;
  /** Popup model per occurrence id (also for occurrences that are not marked on this surface). */
  models: Map<string, MeasurePopupModel>;
  anchors: ResolvedMeasureAnchor[];
  /** Popup models per verse, in text order, whether or not the display marks them in the text. */
  byVerse: Map<number, MeasurePopupModel[]>;
}

export function computeChapterMeasures(input: ComputeChapterMeasuresInput): ChapterMeasures {
  const { prefs } = input;
  if (!prefs.enabled) return { layer: emptyMeasureLayer(), index: new MeasureIndex(), models: new Map(), anchors: [], byVerse: new Map() };

  const registry = input.registry ?? getMeasureRegistry();
  const modulePack = input.modulePack ?? getMeasureLocalePack(input.moduleLanguage);
  const uiPack = input.uiPack ?? getMeasureLocalePack(input.uiLocale);

  const byVerse = new Map<number, MeasureOccurrence[]>();
  for (const occ of input.occurrences) {
    if (!prefs.includeDrafts && occ.review.status === 'draft') continue;
    const list = byVerse.get(occ.verseId) ?? [];
    list.push(occ);
    byVerse.set(occ.verseId, list);
  }

  const models = new Map<string, MeasurePopupModel>();
  const anchors: ResolvedMeasureAnchor[] = [];
  for (const verse of input.verses) {
    const occs = byVerse.get(verse.verseId);
    if (!occs?.length) continue;
    const interlinear = input.interlinear?.filter((s) => s.verseId === verse.verseId);
    const verseAnchors = resolveMeasureAnchors(occs, verse, {
      language: input.moduleLanguage, ...(interlinear ? { interlinear } : {}), pack: modulePack, registry,
    });
    anchors.push(...verseAnchors);
    for (const occ of occs) {
      // The anchored word on screen ("mites"): titles use the text's own unit words only when it is one of them.
      const target = verseAnchors.find((a) => a.occId === occ.id)?.target;
      const textWord = target?.kind === 'tokens' ? verse.words[target.end]?.text : undefined;
      const model = buildMeasurePopup(occ, {
        registry, pack: uiPack, locale: input.uiLocale, prefs, textLanguage: input.moduleLanguage,
        ...(textWord ? { textWord } : {}),
      });
      if (model) models.set(occ.id, model);
    }
  }
  const { layer, index } = buildMeasureLayer(anchors, models, prefs, input.surface, input.verses);
  return { layer, index, models, anchors, byVerse: groupModelsByVerse(models) };
}

function groupModelsByVerse(models: ReadonlyMap<string, MeasurePopupModel>): Map<number, MeasurePopupModel[]> {
  const byVerse = new Map<number, MeasurePopupModel[]>();
  for (const m of models.values()) {
    const list = byVerse.get(m.verseId) ?? [];
    list.push(m);
    byVerse.set(m.verseId, list);
  }
  return byVerse;
}

export interface ComputeVerseMeasuresInput {
  /** Occurrences of the verse (or of a chapter: other verses are ignored). */
  occurrences: readonly MeasureOccurrence[];
  verseId: number;
  uiLocale: string;
  prefs: MeasurePreferences;
  registry?: MeasureRegistry;
  uiPack?: MeasureLocalePack;
}

/**
 * The Study panel's list: popup models of one verse's occurrences, in text order, in the reader's unit
 * system. Needs no verse text (nothing is anchored), so titles use the scholarly unit names. Empty when
 * measures are off.
 */
export function computeVerseMeasures(input: ComputeVerseMeasuresInput): MeasurePopupModel[] {
  const { prefs } = input;
  if (!prefs.enabled) return [];
  const registry = input.registry ?? getMeasureRegistry();
  const pack = input.uiPack ?? getMeasureLocalePack(input.uiLocale);
  const out: MeasurePopupModel[] = [];
  for (const occ of input.occurrences) {
    if (occ.verseId !== input.verseId) continue;
    if (!prefs.includeDrafts && occ.review.status === 'draft') continue;
    const model = buildMeasurePopup(occ, { registry, pack, locale: input.uiLocale, prefs });
    if (model) out.push(model);
  }
  return out;
}
