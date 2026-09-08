/**
 * Assembling an interlinear verse into *cells*.
 *
 * ## Why this exists
 *
 * `interlinear_word.word_position_start` / `word_position_end` are 0-based,
 * inclusive indices into the verse's whitespace-separated **English** word
 * sequence - the exact same index space that `user_text_markup.text_start` /
 * `text_end` (highlights and underlines) address, and the same space
 * `formatting.spans` (words-of-christ, supplied) uses. Verified across all
 * eight shipped modules that carry interlinear data (~2.9M rows): for every row
 * with a gloss, `gloss === englishWords.slice(start, end + 1).join(' ')`, with
 * zero violations. (Compared case-insensitively: `formatVerseText()` normalises
 * the Tetragrammaton to "Lord" for its small-caps treatment, so a handful of
 * glosses that stored "LORD" differ in case while pointing at the same word.)
 * The invariant is a property of the module data, not of this code: importing
 * or regenerating a module should re-check it against the produced database
 * before that module ships.
 *
 * Because of that, the interlinear view does not need its own word model. It
 * can render *the English tokens themselves*, each as its own
 * `<span class="word" data-word-index=N>`, and highlighting/underlining/
 * find-in-page all work there identically to Standard and Reading mode.
 *
 * A **cell** is one column of the interlinear stack: a contiguous run of
 * English tokens plus the interlinear row (if any) that backs them. The cell
 * spans a *range*; each token inside it is still addressed individually, so
 * highlight granularity stays per word rather than per cell.
 *
 * ## Unclaimed words stay on screen
 *
 * Emitting one block per interlinear row and nothing else would **silently
 * drop from the display** any English word no interlinear row claims - 5.7%
 * of KJV, including every italicised supplied word (Gen 1:9's "land", and its
 * whole trailing "and it was so."), and over half of RWebster. Emitting a
 * `source: null` cell for each unclaimed run is what puts those words on
 * screen.
 */

import type { WordInfo } from '../../utils/wordIndexing';

/**
 * One row of a module's `interlinear_word` table, as delivered by
 * `bible:getInterlinearWords[ForChapter]` (which has already stripped OSIS
 * tags from `originalWord` / `gloss`).
 */
export interface InterlinearWord {
  /** First English word index covered. 0-based, inclusive. */
  wordPositionStart: number;
  /** Last English word index covered. 0-based, inclusive; equals start for one word. */
  wordPositionEnd: number;
  originalWord: string;
  transliteration?: string;
  strongsNumber?: string;
  morphology?: string;
  lemma?: string;
  gloss?: string;
}

/** One column of the interlinear stack. */
export interface InterlinearCell {
  /** First English word index in this cell. 0-based, inclusive. */
  wordStart: number;
  /** Last English word index in this cell. 0-based, inclusive. */
  wordEnd: number;
  /**
   * The English tokens themselves, exactly one per index in
   * `[wordStart..wordEnd]`. `englishWords[k]` is word index `wordStart + k`.
   */
  englishWords: WordInfo[];
  /**
   * The interlinear row backing this cell, or `null` for a run of English
   * words no row claimed (supplied/italic words, untagged tails).
   */
  source: InterlinearWord | null;
  /**
   * Further rows pinned to this cell: rows with no gloss that share a claimed
   * position (e.g. the two extra Greek articles John 3:16 hangs off index 0),
   * and rows demoted because another row already claimed their range. They
   * contribute an extra Strong's chip, never an extra copy of the English.
   */
  extraSources: InterlinearWord[];
}

/** A row is only allowed to *claim* English tokens if it says what they are. */
function hasGloss(row: InterlinearWord): boolean {
  return typeof row.gloss === 'string' && row.gloss.trim().length > 0;
}

/**
 * Split an English verse into interlinear cells.
 *
 * Guarantees (asserted by {@link cellsPartitionWordSpace}) that the returned
 * cells partition `[0, englishWords.length)` exactly: contiguous, ordered,
 * non-overlapping and complete. Every English word is rendered exactly once.
 *
 * @param englishWords Tokens from `extractWordsWithFormatting(verse.text_html)`
 * @param rows The verse's `interlinear_word` rows, in stored order
 */
export function buildInterlinearCells(
  englishWords: WordInfo[],
  rows: InterlinearWord[]
): InterlinearCell[] {
  const total = englishWords.length;
  if (total === 0) return [];

  // Normally only gloss-bearing rows claim English tokens, so John 3:16's two
  // null-gloss articles at [0,0] become extra Strong's chips on the cell that
  // carries the word "For" instead of printing "For" three times. A module
  // whose glosses are all null would then claim nothing at all and collapse
  // into one undifferentiated block, so in that case fall back to letting
  // every row claim by position.
  const anyGloss = rows.some(hasGloss);
  const claimants: InterlinearWord[] = [];
  const extras: InterlinearWord[] = [];
  for (const row of rows) {
    if (!anyGloss || hasGloss(row)) claimants.push(row);
    else extras.push(row);
  }

  // Stable sort by start position: ties keep stored order, which is what makes
  // the "first row wins" tie-break below deterministic.
  const ordered = claimants
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.wordPositionStart - b.row.wordPositionStart || a.index - b.index);

  const cells: InterlinearCell[] = [];
  let nextFree = 0;

  const pushCell = (start: number, end: number, source: InterlinearWord | null): void => {
    cells.push({
      wordStart: start,
      wordEnd: end,
      englishWords: englishWords.slice(start, end + 1),
      source,
      extraSources: [],
    });
  };

  for (const { row } of ordered) {
    const end = row.wordPositionEnd;
    // Out of range, or an inverted range: the row cannot be trusted to own
    // tokens. Demote rather than drop, so its Strong's number stays reachable.
    if (end < row.wordPositionStart || end >= total || end < 0) {
      extras.push(row);
      continue;
    }
    const start = Math.max(row.wordPositionStart, nextFree);
    if (start > end) {
      // Fully swallowed by an earlier row (the overlap anomalies a handful of
      // modules contain). First row wins; this one becomes an extra column.
      extras.push(row);
      continue;
    }
    if (start > nextFree) {
      // Words no row claimed. Rendering them is what stops the interlinear
      // view silently deleting supplied/italic words.
      pushCell(nextFree, start - 1, null);
    }
    pushCell(start, end, row);
    nextFree = end + 1;
  }

  if (nextFree < total) {
    pushCell(nextFree, total - 1, null);
  }

  attachExtras(cells, extras, total);
  return cells;
}

/**
 * Pin each leftover row to the cell that owns its start position, so its
 * Strong's number is still reachable in the UI.
 */
function attachExtras(
  cells: InterlinearCell[],
  extras: InterlinearWord[],
  total: number
): void {
  if (cells.length === 0 || extras.length === 0) return;

  // index -> cell, built once; verses are short but chapters are not.
  const cellForIndex = new Array<InterlinearCell>(total);
  for (const cell of cells) {
    for (let i = cell.wordStart; i <= cell.wordEnd; i++) {
      cellForIndex[i] = cell;
    }
  }

  for (const row of extras) {
    const position = row.wordPositionStart;
    const target =
      position >= 0 && position < total
        ? cellForIndex[position]
        : position < 0
          ? cells[0]
          : cells[cells.length - 1];
    target.extraSources.push(row);
  }
}

/**
 * The postcondition {@link buildInterlinearCells} promises: the cells cover
 * `[0, total)` contiguously, in order, exactly once each.
 *
 * Checked at render time so a module whose data violates our assumptions falls
 * back to the plain highlighted-verse renderer instead of showing a verse with
 * words missing or duplicated.
 */
export function cellsPartitionWordSpace(cells: InterlinearCell[], total: number): boolean {
  if (total === 0) return cells.length === 0;
  let expected = 0;
  for (const cell of cells) {
    if (cell.wordStart !== expected) return false;
    if (cell.wordEnd < cell.wordStart) return false;
    if (cell.englishWords.length !== cell.wordEnd - cell.wordStart + 1) return false;
    expected = cell.wordEnd + 1;
  }
  return expected === total;
}
