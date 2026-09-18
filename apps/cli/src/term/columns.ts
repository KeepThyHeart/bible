/**
 * Cutting a laid-out chapter into the cells of a fixed page.
 *
 * ## This is not a layout engine
 *
 * `reading.ts` is the one place that turns verses into rows. Everything here
 * takes the `ReadingLine[]` it already produced — laid out at the preset's
 * `cellWidth`, not at the terminal's width — and slices that flat list into
 * columns and pages. It reads no text, measures nothing and wraps nothing. A
 * second wrapping implementation would eventually disagree with the first, and
 * the disagreement would show up as verses that are in one cell according to
 * the cursor and another according to the screen.
 *
 * ## Pagination never looks at the terminal
 *
 * {@link paginate} is a pure function of the lines and the preset. It has no
 * access to a `TerminalSize` and must never be given one. The page is a fixed
 * geometry — see the header of `app/presets.ts` for why that is the whole point
 * of the feature rather than an implementation shortcut — so a verse lands in
 * the same cell on every machine and in every session. A helpful reflow to the
 * window would destroy the only property the layout exists to provide.
 *
 * ## Down, then across
 *
 * Column one is filled from its top row to its bottom row, then column two,
 * like a printed page. So the row after the last row of a column is the *first*
 * row of the next column, and the row after the last row of the last column is
 * the first row of the next page.
 *
 * A verse may therefore be split across a column boundary, its opening rows at
 * the foot of one column and the rest at the head of the next. That is accepted
 * and correct. The tidier alternative — one whole verse range per column, never
 * split — was rejected: a single long verse would leave the bottom of a column
 * blank, and vertical space in a terminal is the scarcest thing there is.
 */
import type { ReadingPreset } from '../app/presets';
import type { ReadingLine } from './reading';

/**
 * One page: exactly `preset.columns` columns, each at most `preset.rows` tall.
 *
 * The column count is always the preset's, even on a short final page where the
 * later columns are empty. A page is a page; the last one is simply partly
 * blank, and a caller drawing a page frame or moving a cursor sideways would
 * otherwise have to treat the final page as a different shape.
 */
export interface Page {
  readonly columns: readonly (readonly ReadingLine[])[];
}

/** Where a verse sits on the page: all three indices are zero-based. */
export interface Cell {
  readonly page: number;
  readonly column: number;
  readonly row: number;
}

/**
 * Slice laid-out rows into pages of columns, filling down and then across.
 *
 * `lines` is expected to have come from `layoutReading` at `preset.cellWidth`.
 * Nothing here checks that — the rows carry no record of the width they were
 * wrapped to — so a caller that lays out at some other width gets a page whose
 * rows overflow their cells. `Reader` is the one caller and pairs the two.
 *
 * An empty chapter yields no pages rather than one blank page: there is nothing
 * to turn to, and a reader showing "page 1 of 1" with nothing on it is worse
 * than one that reports it has nothing to show.
 */
export function paginate(lines: readonly ReadingLine[], preset: ReadingPreset): Page[] {
  // A zero or negative geometry would make the walk below advance by nothing
  // and loop for ever. It cannot arise from `PRESETS`, and this is cheaper than
  // finding out that it arose from somewhere else by hanging the terminal.
  if (preset.rows < 1 || preset.columns < 1) return [];

  const pages: Page[] = [];
  let index = 0;

  while (index < lines.length) {
    const columns: (readonly ReadingLine[])[] = [];
    for (let column = 0; column < preset.columns; column += 1) {
      // Past the end of `lines` this slices nothing, which is exactly the empty
      // trailing column a short final page should have.
      columns.push(lines.slice(index, index + preset.rows));
      index += preset.rows;
    }
    pages.push({ columns });
  }

  return pages;
}

/**
 * The cell a verse starts in, or `undefined` if no cell claims it.
 *
 * The scan runs in reading order — down each column, across each page — so the
 * first row that names the verse is the one it starts on.
 *
 * "Names the verse" is `ReadingLine.verse`, and it is worth knowing exactly what
 * that is: `wrapTokens` labels a row with the group of the **first** grouped
 * token on it. In numbered mode every verse begins its own row, so the answer is
 * exact. In paragraph mode verses run together, and a row that ends verse 14 and
 * begins verse 15 is labelled 14 — so verse 15's cell is reported as the row
 * after the one its first word is actually printed on, and a short verse that
 * neither starts nor ends a row is not reported at all. Both are properties of
 * the rows, not of this function; correcting either would mean re-deriving the
 * layout here, which is the one thing this file must not do.
 */
export function cellOf(pages: readonly Page[], verse: number): Cell | undefined {
  for (let page = 0; page < pages.length; page += 1) {
    const columns = pages[page]!.columns;
    for (let column = 0; column < columns.length; column += 1) {
      const cells = columns[column]!;
      for (let row = 0; row < cells.length; row += 1) {
        if (cells[row]!.verse === verse) return { page, column, row };
      }
    }
  }
  return undefined;
}

/**
 * Which verse occupies a cell, or `undefined` if none does.
 *
 * A continuation row answers with the verse it continues, not with `undefined`:
 * the rows of a wrapped verse all carry its number, and a reader pointing at
 * the third row of a verse is pointing at that verse. So this is not the inverse
 * of {@link cellOf} — feeding this answer back gives the cell the verse *began*
 * in, which may be higher up the column, in an earlier column, or on an earlier
 * page. Every verse's starting cell does round-trip, which is the property a
 * cursor needs.
 *
 * `undefined` means "no verse occupies this cell", and covers four cases the
 * caller has no reason to distinguish: a cell beyond the last page, a column or
 * row index outside the page, an empty cell on a short final page, and a row
 * that belongs to no verse — a blank paragraph separator or a psalm heading,
 * both of which `reading.ts` emits with no verse number.
 */
export function verseAt(
  pages: readonly Page[],
  page: number,
  column: number,
  row: number,
): number | undefined {
  if (page < 0 || page >= pages.length) return undefined;

  const columns = pages[page]!.columns;
  if (column < 0 || column >= columns.length) return undefined;

  const cells = columns[column]!;
  if (row < 0 || row >= cells.length) return undefined;

  return cells[row]!.verse;
}
