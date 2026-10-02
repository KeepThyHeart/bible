/**
 * Adapter: resolved anchors become a `LayerDecorations` layer (the same path
 * keyword marks use) plus a `MeasureIndex` that maps a clicked word back to
 * its occurrences.
 */
import type { LayerDecorations } from '../Annotations/DecorationResolver';
import type { DecorationDto, DecorationTarget } from '../Extensions/ExtensionApiDtos';
import type { MeasurePopupModel, MeasurePreferences, MeasureVerseInput, ResolvedMeasureAnchor } from './types';

export const MEASURE_LAYER_KEY = 'core::measures';
/** Below keyword marks (50). */
export const MEASURE_LAYER_ORDER = 40;
/** Badge on the last word of a verse whose measure could not be pinned to words. */
export const MEASURE_VERSE_BADGE = '⚖';

const MAX_TARGETS_PER_DECORATION = 64;

export type MeasureSurface = 'standard' | 'study' | 'reading';

export interface MeasureIndexEntry {
  occId: string;
  verseId: number;
  anchor: ResolvedMeasureAnchor;
  model: MeasurePopupModel;
}

/** (verseId, wordIndex) -> occurrence ids; occurrence id -> anchor and popup model. */
export class MeasureIndex {
  private readonly words = new Map<string, string[]>();
  private readonly byVerse = new Map<number, string[]>();
  private readonly entries = new Map<string, MeasureIndexEntry>();

  /** @internal */
  addEntry(entry: MeasureIndexEntry): void {
    this.entries.set(entry.occId, entry);
    const list = this.byVerse.get(entry.verseId) ?? [];
    if (!list.includes(entry.occId)) list.push(entry.occId);
    this.byVerse.set(entry.verseId, list);
  }

  /** @internal */
  addWord(verseId: number, wordIndex: number, occId: string): void {
    const key = `${verseId}:${wordIndex}`;
    const list = this.words.get(key) ?? [];
    if (!list.includes(occId)) list.push(occId);
    this.words.set(key, list);
  }

  /**
   * Occurrence ids at a word (including the verse-fallback badge word: every fallback occurrence of the
   * verse is listed at the verse's last word; `occurrence(id).anchor.target.kind === 'verse'` tells them
   * apart, and `isFallbackOnly` tests a whole word). Empty when none.
   */
  at(verseId: number, wordIndex: number): string[] {
    return this.words.get(`${verseId}:${wordIndex}`) ?? [];
  }

  occurrence(id: string): MeasureIndexEntry | undefined {
    return this.entries.get(id);
  }

  /** Every occurrence id of a verse, in order. */
  forVerse(verseId: number): string[] {
    return this.byVerse.get(verseId) ?? [];
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * True when every occurrence at this word is a verse-fallback one (it has no words of its own and sits on
 * the verse's ⚖ badge). Apps open a fallback popup only when the pointer is on the badge itself, so a
 * click on the verse's last word, which may merely be the badge's anchor, does not pop up.
 */
export function isFallbackOnly(index: MeasureIndex, verseId: number, wordIndex: number): boolean {
  const ids = index.at(verseId, wordIndex);
  return ids.length > 0 && ids.every((id) => index.occurrence(id)?.anchor.target.kind === 'verse');
}

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function emptyMeasureLayer(): LayerDecorations {
  return { layerKey: MEASURE_LAYER_KEY, extensionId: 'core', layerSeq: 0, surfaces: ['standard', 'study', 'reading'], decorations: [] };
}

/**
 * Build the layer and index. Anchors whose occurrence has no popup model are
 * skipped. The layer is empty (and the index too) when measures are off,
 * display is 'off' (the default: conversions then live in the Study panel only), or the surface is Reading without `showInReading`.
 */
export function buildMeasureLayer(
  anchors: readonly ResolvedMeasureAnchor[],
  models: ReadonlyMap<string, MeasurePopupModel>,
  prefs: MeasurePreferences,
  surface: MeasureSurface,
  verses: readonly MeasureVerseInput[] = [],
): { layer: LayerDecorations; index: MeasureIndex } {
  const index = new MeasureIndex();
  const layer = emptyMeasureLayer();
  if (!prefs.enabled || prefs.display === 'off' || (surface === 'reading' && !prefs.showInReading)) return { layer, index };

  const lastWord = new Map<number, number>();
  for (const v of verses) if (v.words.length) lastWord.set(v.verseId, v.words.length - 1);

  const badged = new Set<number>();
  const underlined: DecorationTarget[] = [];
  const decorations: DecorationDto[] = [];
  for (const anchor of anchors) {
    const model = models.get(anchor.occId);
    if (!model) continue;
    const entry: MeasureIndexEntry = { occId: anchor.occId, verseId: anchor.verseId, anchor, model };
    if (anchor.target.kind === 'tokens') {
      const { start, end } = anchor.target;
      index.addEntry(entry);
      for (let i = start; i <= end; i++) index.addWord(anchor.verseId, i, anchor.occId);
      underlined.push({ kind: 'tokens', verseId: anchor.verseId, startTokenIndex: start, endTokenIndex: end });
      if (prefs.display === 'inline' && (model.inline || model.badge)) {
        decorations.push({
          // After the whole phrase ("two cubits and a half"), not after the unit word, when it was resolved.
          target: { kind: 'tokens', verseId: anchor.verseId, startTokenIndex: anchor.phraseEnd ?? end },
          appearance: { kind: 'badge', label: (model.inline ?? model.badge) as string, color: 'accent' },
          order: MEASURE_LAYER_ORDER, data: { occId: anchor.occId },
        });
      }
    } else if (surface !== 'reading') {
      const last = lastWord.get(anchor.verseId);
      if (last === undefined) continue;
      index.addEntry(entry);
      index.addWord(anchor.verseId, last, anchor.occId);
      // One badge per verse, however many of its measures could not be pinned to words.
      if (badged.has(anchor.verseId)) continue;
      badged.add(anchor.verseId);
      decorations.push({
        target: { kind: 'tokens', verseId: anchor.verseId, startTokenIndex: last },
        appearance: { kind: 'badge', label: MEASURE_VERSE_BADGE, color: 'text-muted' },
        order: MEASURE_LAYER_ORDER, data: { occId: anchor.occId },
      });
    }
  }
  const underlines: DecorationDto[] = chunk(underlined, MAX_TARGETS_PER_DECORATION).map((part) => ({
    target: part,
    appearance: { kind: 'underline', color: 'accent', style: 'dotted', thickness: 'thin' },
    order: MEASURE_LAYER_ORDER,
  }));
  layer.decorations = [...underlines, ...decorations];
  return { layer, index };
}
