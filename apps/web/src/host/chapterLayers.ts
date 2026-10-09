/**
 * Generic helpers for the reader's paint layers (task 0127): the words of a
 * verse in the index space every layer shares, interlinear rows as Strong's
 * spans, and the per-verse resolve of several `LayerDecorations` at once.
 * Feature modules (keyword marks, weights and measures) build their own layer
 * and import these from the host; the host never imports them.
 */
import {
  extractWordsWithFormatting,
  resolveVerseDecorations,
  resolveThemeColor,
  type InterlinearSpan,
  type LayerDecorations,
  type ResolvedVerse,
} from '@bible/core/browser';
import type { InterlinearWordData, VerseData } from '../types';
import { normalizeStrongsNumber } from '../utils/interlinearRows';

/** The reader surface a layer paints for. */
export type ReaderSurface = 'standard' | 'reading' | 'study';

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

/**
 * Resolve the layers into per-word paint for every verse that has any. Verses
 * with nothing to paint are absent from the map, which is what lets the
 * renderer keep its plain markup for them. Several layers resolve together,
 * per verse, so a verse that has more than one still hands the renderer one
 * `ResolvedVerse`.
 */
export function resolveChapterLayers(
  verses: readonly VerseData[],
  layers: readonly (LayerDecorations | null | undefined)[],
  surface: ReaderSurface,
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
