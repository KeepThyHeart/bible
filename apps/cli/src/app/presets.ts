/**
 * The fixed page geometries the column reading layout is drawn at.
 *
 * ## The terminal is a viewport, not the page
 *
 * A preset is a *page*, in the sense that a printed Bible has pages: a fixed
 * number of columns, each a fixed number of character cells wide and a fixed
 * number of rows tall. It is **chosen** from the list below; it is never fitted
 * to the window. Pagination is a pure function of the preset and the chapter
 * (see `term/columns.ts`) and consults neither the terminal width nor its
 * height, so a given verse lands in the same cell on every machine, in every
 * session, at every window size.
 *
 * That invariance is not a simplification, it is the entire feature. The layout
 * exists so that a reader remembers *where on the page* a verse sits — third
 * column, near the bottom — and a remembered position is worth nothing if the
 * position moves when the window is dragged. Reflowing the page to the window
 * would therefore not improve the feature; it would delete it. Anyone tempted
 * to "fix" this later should change the preset list instead.
 *
 * What the window size is allowed to decide is only two things: which presets
 * are on offer ({@link fits}, {@link largestFitting}), and whether the page can
 * be shown at all. Once a preset is chosen the terminal is a viewport over a
 * sheet of paper — it can be too small to show the whole sheet, and that is a
 * message to the user, not a reason to reshape the sheet.
 *
 * ## The numbers below are provisional
 *
 * Every geometry lives in this file and nowhere else. The rest of the codebase
 * takes `columns`, `cellWidth`, `rows` and `gutter` from a {@link ReadingPreset}
 * and derives everything else from {@link pageWidth} and {@link requiredSize},
 * so these numbers can be re-cut without touching another file.
 *
 * They have not yet been cut against a real terminal and a real chapter, which
 * is the only way to settle them. To re-derive:
 *
 * - `cellWidth` is the one that matters. Too narrow and ordinary prose
 *   fragments into two- and three-word rows with ragged right edges; the
 *   wrapper cannot help, there is simply nowhere to put the words. Read a dense
 *   chapter (Psalm 119 for long verses, Matthew 1 for the genealogy) at a
 *   candidate width and look at how many rows carry fewer than four words.
 * - `rows` trades page size against how many terminals can show a page at all.
 *   Each row costs one terminal row and there are six rows of chrome around the
 *   body, so `rows` above 18 already excludes the historical 80×24.
 * - `pageWidth` must stay within `MAX_TEXT_WIDTH`, the cap `frame.ts` puts on
 *   the body regardless of how wide the terminal is. A preset wider than that
 *   can never fit any window, which is a bug rather than a tall order; the test
 *   suite asserts it.
 */
import { bodyMetrics, CHROME_ROWS, MARGIN } from './frame';
import type { TerminalSize } from '../term/raw';

export interface ReadingPreset {
  /** How the preset is named on the command line and in the status line. */
  readonly name: string;
  readonly columns: number;
  /** Character cells of text per column, *excluding* the gutter beside it. */
  readonly cellWidth: number;
  /** Text rows per page. */
  readonly rows: number;
  /**
   * Blank columns between adjacent text cells.
   *
   * A constant per preset rather than a setting. The gutter is the only thing
   * stopping the eye running from the end of one column into the start of the
   * next, so it is typography and not taste: too narrow and the page is unread-
   * able, too wide and it wastes the width the text needed. Nothing is gained
   * by letting it be typed in, and a wrong value looks like a layout bug.
   */
  readonly gutter: number;
}

/**
 * Text rows on a full-size page.
 *
 * 20 rows, plus six of chrome and the three the reader spends on the page's own
 * title and footer, needs a 29-row window — well past the classic 24, and
 * deliberately so: these presets are for a window someone has made roomy on
 * purpose, and {@link FALLBACK} covers the rest.
 */
const PAGE_ROWS = 20;

/**
 * Text rows on the fallback page: 15, so that 80×24 works.
 *
 * The arithmetic is worth spelling out, because the obvious number is wrong.
 * Six rows go to the frame's chrome and three more to the furniture the reader
 * draws around a page — the chapter title, the blank under it, and the footer
 * rule carrying the verse range. 15 + 3 + 6 is exactly 24.
 *
 * It was 18 while the furniture went uncounted, and the effect was that *no*
 * preset fitted a classic 80×24 terminal: the one preset whose whole purpose is
 * to fit the smallest window anyone still uses was three rows too tall, so
 * column mode on such a terminal was nothing but the notice saying it would not
 * fit. A page that cannot be shown anywhere is not a fallback.
 */
const FALLBACK_PAGE_ROWS = 15;

/** Enough of a gap to stop the eye crossing it, for closely-set columns. */
const TIGHT_GUTTER = 2;

/** Wider columns hold longer lines, and a longer line needs a bigger gap. */
const LOOSE_GUTTER = 4;

/**
 * Two wide columns — the closest of these to reading ordinary prose, and the
 * widest page the body cap allows: 2 × 40 + 4 is exactly `MAX_TEXT_WIDTH`.
 */
const WIDE: ReadingPreset = {
  name: 'wide',
  columns: 2,
  cellWidth: 40,
  rows: PAGE_ROWS,
  gutter: LOOSE_GUTTER,
};

/** Three columns, the shape most printed Bibles that use columns settle on. */
const THREE_COLUMN: ReadingPreset = {
  name: '3-col',
  columns: 3,
  cellWidth: 26,
  rows: PAGE_ROWS,
  gutter: TIGHT_GUTTER,
};

/** Four narrow columns: the densest page, and the most fragmented prose. */
const FOUR_COLUMN: ReadingPreset = {
  name: '4-col',
  columns: 4,
  cellWidth: 18,
  rows: PAGE_ROWS,
  gutter: TIGHT_GUTTER,
};

/**
 * One column, sized so that it fits the smallest window anyone still uses.
 *
 * It exists so {@link largestFitting} always has an answer. A single column is
 * a degenerate page but it is still a *fixed* page — the verse-to-cell mapping
 * is as stable here as anywhere, which is the property that has to survive.
 */
const FALLBACK: ReadingPreset = {
  name: '1-col',
  columns: 1,
  cellWidth: 40,
  rows: FALLBACK_PAGE_ROWS,
  gutter: 0,
};

/**
 * Every preset, ordered from the most demanding to the least.
 *
 * The order is load-bearing: {@link largestFitting} walks it and takes the
 * first that fits, which is only meaningful because each entry needs at least
 * as large a window as the one after it. A new preset goes in its place in that
 * sequence, and the test suite fails if it does not.
 */
export const PRESETS: readonly ReadingPreset[] = [WIDE, THREE_COLUMN, FOUR_COLUMN, FALLBACK];

/**
 * Columns of body the page occupies: the cells, plus a gutter between each
 * adjacent pair. There is no gutter outside the outermost columns — that is
 * the frame's margin, and `frame.ts` already draws it.
 */
export function pageWidth(preset: ReadingPreset): number {
  const gutters = Math.max(0, preset.columns - 1);
  return preset.columns * preset.cellWidth + gutters * preset.gutter;
}

/**
 * The smallest window that can show a whole page.
 *
 * Derived from what the frame actually spends rather than from a guessed
 * allowance, because the two drift apart silently — a seventh row of chrome
 * would clip the bottom row of every page and look like a pagination bug:
 *
 * ```
 * columns = MARGIN + pageWidth(preset) + MARGIN
 * rows    = CHROME_ROWS + preset.rows
 * ```
 *
 * `MARGIN` is the blank column `frame.ts` indents the body by on each side, and
 * `CHROME_ROWS` is its six rows of furniture — header, rule, rule, input line,
 * rule, hints. The frame drops rules and then hints below twelve rows, so the
 * chrome is thinner in a very short window; that is irrelevant here, because
 * every preset needs more than twelve rows anyway and so is always measured
 * against the full six.
 *
 * Two things this deliberately does not account for. `frame.ts` caps the body
 * at `MAX_TEXT_WIDTH` however wide the terminal is, so a preset wider than the
 * cap has a required size it can never meet — {@link fits} is the honest
 * answer, and the suite asserts no preset is in that state. And a notice line
 * borrows rows from the body while it is on screen, so a page that fits can be
 * temporarily squeezed; that is the caller's business, since it is transient.
 */
export function requiredSize(preset: ReadingPreset): TerminalSize {
  return {
    columns: pageWidth(preset) + MARGIN * 2,
    rows: preset.rows + CHROME_ROWS,
  };
}

export function presetByName(name: string): ReadingPreset | undefined {
  // Forgiving about case and stray spaces: these names get typed at a prompt,
  // and `3-COL` is not a different request from `3-col`.
  const wanted = name.trim().toLowerCase();
  return PRESETS.find((preset) => preset.name === wanted);
}

/**
 * Whether a window can show a whole page of this preset.
 *
 * Asks `bodyMetrics` rather than comparing against {@link requiredSize}, so
 * that everything the frame does to the body — the margins, the thinning
 * chrome, and above all the `MAX_TEXT_WIDTH` cap that no terminal width can
 * lift — is accounted for by the code that owns it.
 *
 * `bodyMetrics` clamps its answer up to a 20-column, one-row floor, which would
 * be a false positive if any preset were smaller than that floor. None is, and
 * none can be: a page of fewer than 20 columns or one row is not a page.
 *
 * `reservedRows` is body rows the caller spends on something other than the page —
 * the reader's pinned chapter title and its page footer. It is a parameter rather
 * than a constant here because it is the *caller's* furniture: this file knows
 * what a page costs and the frame knows what the chrome costs, and neither of
 * them knows what a screen chooses to draw around the page. Omitting it asks the
 * narrower question, "can the body hold the page at all".
 */
export function fits(preset: ReadingPreset, size: TerminalSize, reservedRows = 0): boolean {
  const body = bodyMetrics(size);
  return body.width >= pageWidth(preset) && body.height >= preset.rows + reservedRows;
}

/**
 * The richest page this window can hold.
 *
 * Always returns a preset, never `undefined`, because a caller with no preset
 * has nothing to offer the user and no way to say why. When the window is too
 * small for even {@link FALLBACK} — narrower than 44 columns or shorter than 24
 * rows — the fallback comes back anyway and does not fit. Callers that care
 * must ask {@link fits} as well, and on `false` say so and read the chapter the
 * ordinary scrolling way rather than drawing a page with its edge cut off.
 *
 * `reservedRows` means what it means in {@link fits}, and must be the same number
 * the caller passes there — otherwise it offers a fallback preset that its own
 * fit check will then reject.
 */
export function largestFitting(size: TerminalSize, reservedRows = 0): ReadingPreset {
  return PRESETS.find((preset) => fits(preset, size, reservedRows)) ?? FALLBACK;
}
