/**
 * Turning `/api/interlinear` rows into cell-builder rows, and deciding whether
 * they can be trusted to do that at all.
 *
 * Lives outside `VerseRenderer` because two places render interlinear data —
 * the Bible pane and the Study pane's Interlinear section — and both have to
 * make exactly the same decisions about the same rows.
 */

import {
  buildInterlinearCells,
  cellsPartitionWordSpace,
  type InterlinearCell,
  type InterlinearWord,
} from './interlinearCells';
import { extractWordsWithFormatting } from './wordIndexing';
import type { InterlinearWordData } from '../types';

/** Strong's numbers occasionally arrive as `strong:G2316`; the UI wants `G2316`. */
export function normalizeStrongsNumber(raw: string): string {
  return raw.toLowerCase().startsWith('strong:') ? raw.substring(7) : raw;
}

/**
 * API row → cell-builder row. The server has already stripped OSIS tags from
 * `originalWord` and `gloss`, so no further cleaning is needed here.
 *
 * Only call this once {@link rowsHaveEndPositions} has confirmed the response
 * actually carries end indices — the `?? w.position` below is a last resort,
 * not a supported shape.
 */
export function toCellRow(w: InterlinearWordData): InterlinearWord {
  return {
    wordPositionStart: w.position,
    wordPositionEnd: w.positionEnd ?? w.position,
    originalWord: w.originalWord,
    transliteration: w.transliteration,
    strongsNumber: w.strongsNumber ? normalizeStrongsNumber(w.strongsNumber) : '',
    gloss: w.gloss,
  };
}

/**
 * Whether every row states where its English span *ends*.
 *
 * `/api/interlinear/:book/:chapter` is served with
 * `private, max-age=3600, stale-while-revalidate=86400` (see the cacheable-API
 * list in `server/index.ts`), so a browser can hold a response from before
 * `positionEnd` existed for up to a day after a deploy. Reading a missing end
 * as "one word long" is silent and wrong: every multi-word row collapses onto
 * its first token, the remaining tokens become unclaimed `source: null` cells,
 * and the result still *partitions* the word space — so the postcondition check
 * cannot catch it. The verse would quietly show the wrong original-language
 * word under most of its words.
 *
 * Callers treat `false` as "no usable interlinear data" and fall back to the
 * plain verse text, which the next revalidation of the cached response fixes.
 */
export function rowsHaveEndPositions(rows: InterlinearWordData[]): boolean {
  return rows.every(row => typeof row.positionEnd === 'number');
}

/** Verses already warned about, so a re-render does not spam the console. */
const warnedVerses = new Set<string>();

/**
 * Report — once per verse per component — that the interlinear could not be
 * rendered against the translation's own words and the plain verse is being
 * shown instead.
 *
 * Without this the two fallbacks are invisible: a module whose word positions
 * no longer partition its own token space, or a stale response missing
 * `positionEnd`, just quietly changes what the page says.
 */
export function warnInterlinearFallback(
  component: string,
  verseId: number | null,
  reason: string,
): void {
  const key = `${component}:${verseId}:${reason}`;
  if (warnedVerses.has(key)) return;
  warnedVerses.add(key);
  console.warn(`[${component}] ${reason} for verse ${verseId}; falling back to plain text.`);
}

/** Test seam: forget which verses have already been warned about. */
export function resetInterlinearWarnings(): void {
  warnedVerses.clear();
}

/**
 * The whole interlinear decision for one verse: tokenise the *translation's*
 * own HTML, hang the rows off those tokens, and hand back cells only if the
 * result is trustworthy.
 *
 * `null` means "render the plain verse instead". Both callers must fail soft
 * that way rather than printing the rows' glosses: a gloss list is the
 * module's wording in the module's order, not the translation's, so it
 * misrepresents the very text the reader chose.
 *
 * @param component Name used in the console warning, e.g. `'StudyHome'`
 * @param verseHtml The verse's `text_html` — the English word space the rows index
 */
export function buildVerseInterlinearCells(
  component: string,
  verseId: number | null,
  verseHtml: string,
  rows: InterlinearWordData[],
): InterlinearCell[] | null {
  if (rows.length === 0) return null;

  if (!rowsHaveEndPositions(rows)) {
    warnInterlinearFallback(component, verseId, 'Interlinear rows carry no positionEnd');
    return null;
  }

  const englishWords = extractWordsWithFormatting(verseHtml);
  // No English to annotate. The cell builder would return an empty partition,
  // which passes its own postcondition and renders nothing at all.
  if (englishWords.length === 0) return null;

  const cells = buildInterlinearCells(englishWords, rows.map(toCellRow));
  if (!cellsPartitionWordSpace(cells, englishWords.length)) {
    warnInterlinearFallback(
      component,
      verseId,
      `Interlinear positions do not partition the English word space `
        + `(${rows.length} rows over ${englishWords.length} words)`,
    );
    return null;
  }
  return cells;
}
