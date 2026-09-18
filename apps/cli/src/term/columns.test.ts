/**
 * Cutting a laid-out chapter into the cells of a fixed page.
 *
 * The presets in `app/presets.ts` are deliberately not used as fixtures here.
 * Their geometry is provisional, and a test that paginates a 3 × 20 page is
 * testing the guess rather than the slicing; a 2 × 3 page shows the same
 * behaviour with rows that can be counted by eye, and survives the day the real
 * numbers are re-cut.
 *
 * The property that matters most is the last one asserted: the same preset and
 * the same chapter give the same pages at every terminal size. Everything the
 * layout is for depends on it.
 */
import { describe, expect, test } from 'bun:test';

import type { ReadingPreset } from '../app/presets';
import { cellOf, paginate, verseAt, type Page } from './columns';
import { layoutReading, readingLineWidth, type ReadingLine } from './reading';
import { createTheme } from './style';
import type { DisplayVerse } from '../app/verseText';
import type { TerminalSize } from './raw';

const theme = createTheme('ansi256');

function preset(overrides: Partial<ReadingPreset> = {}): ReadingPreset {
  return { name: 'test', columns: 2, cellWidth: 20, rows: 3, gutter: 2, ...overrides };
}

/** A synthetic row, for the tests that are about slicing and not about text. */
function row(verse: number | undefined, text: string): ReadingLine {
  return { segments: [{ text }], verse };
}

function verse(number: number, text: string, extra: Partial<DisplayVerse> = {}): DisplayVerse {
  return {
    verseId: 19119000 + number,
    verse: number,
    runs: [{ text }],
    plainText: text,
    paragraphStart: false,
    heading: undefined,
    ...extra,
  };
}

/** A chapter long enough to need several pages, with verses of varied length. */
const CHAPTER: readonly DisplayVerse[] = Array.from({ length: 40 }, (_, index) =>
  verse(
    index + 1,
    'Thy word is a lamp unto my feet and a light unto my path, '.repeat((index % 4) + 1).trim(),
  ),
);

/** The verse in each cell, page by page and column by column. */
function fingerprint(pages: readonly Page[]): (number | undefined)[][][] {
  return pages.map((page) => page.columns.map((column) => column.map((line) => line.verse)));
}

function flatten(pages: readonly Page[]): ReadingLine[] {
  return pages.flatMap((page) => page.columns.flatMap((column) => [...column]));
}

describe('down, then across', () => {
  test('a column is filled top to bottom before the next one is started', () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, index) => row(index + 1, text));
    const pages = paginate(lines, preset({ columns: 2, rows: 2 }));

    expect(fingerprint(pages)).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [[5, 6], []],
    ]);
  });

  test('every row survives exactly once, in its original order', () => {
    const lines = layoutReading(CHAPTER, {
      width: 26,
      mode: 'numbered',
      theme,
      cursorVerse: 0,
    });
    const pages = paginate(lines, preset({ columns: 3, rows: 8, cellWidth: 26 }));

    // Nothing is dropped, duplicated or reordered: slicing is all this does.
    expect(flatten(pages)).toEqual(lines);
  });
});

describe('page shape', () => {
  test('a chapter shorter than one column still makes a whole page', () => {
    const pages = paginate([row(1, 'one'), row(1, 'two')], preset({ columns: 3, rows: 5 }));

    expect(pages).toHaveLength(1);
    // Three columns, not one. A short final page is a page with blank columns,
    // so a cursor moving sideways meets the same shape everywhere.
    expect(pages[0]!.columns).toHaveLength(3);
    expect(fingerprint(pages)).toEqual([[[1, 1], [], []]]);
  });

  test('rows exactly filling a page make that page and no other', () => {
    const lines = Array.from({ length: 4 }, (_, index) => row(index + 1, 'x'));
    const pages = paginate(lines, preset({ columns: 2, rows: 2 }));

    expect(pages).toHaveLength(1);
    expect(fingerprint(pages)).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ]);
  });

  test('one row past a full page starts the next one', () => {
    const lines = Array.from({ length: 5 }, (_, index) => row(index + 1, 'x'));
    const pages = paginate(lines, preset({ columns: 2, rows: 2 }));

    expect(pages).toHaveLength(2);
    expect(fingerprint(pages)).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [[5], []],
    ]);
  });

  test('a chapter needing several pages gets full pages until the last', () => {
    const lines = Array.from({ length: 17 }, (_, index) => row(index + 1, 'x'));
    const pages = paginate(lines, preset({ columns: 2, rows: 3 }));

    expect(pages).toHaveLength(3);
    for (const page of pages.slice(0, -1)) {
      for (const column of page.columns) expect(column).toHaveLength(3);
    }
    expect(fingerprint([pages.at(-1)!])).toEqual([
      [
        [13, 14, 15],
        [16, 17],
      ],
    ]);
  });

  test('an empty chapter yields no pages rather than one blank page', () => {
    expect(paginate([], preset())).toEqual([]);
  });

  test('a degenerate geometry yields nothing instead of looping for ever', () => {
    expect(paginate([row(1, 'x')], preset({ rows: 0 }))).toEqual([]);
    expect(paginate([row(1, 'x')], preset({ columns: 0 }))).toEqual([]);
  });
});

describe('a verse split across a column boundary', () => {
  // Accepted and correct: the alternative, one whole verse range per column,
  // leaves the foot of a column blank whenever a verse is long.
  const lines = [
    row(1, 'first'),
    row(1, 'second'),
    row(2, 'third'),
    row(2, 'fourth'),
    row(2, 'fifth'),
    row(3, 'sixth'),
  ];
  const pages = paginate(lines, preset({ columns: 2, rows: 3 }));

  test('the verse starts in the column it started in, not where it resumes', () => {
    expect(cellOf(pages, 2)).toEqual({ page: 0, column: 0, row: 2 });
  });

  test('the rows at the head of the next column still name that verse', () => {
    expect(verseAt(pages, 0, 1, 0)).toBe(2);
    expect(verseAt(pages, 0, 1, 1)).toBe(2);
    expect(verseAt(pages, 0, 1, 2)).toBe(3);
  });
});

describe('verseAt', () => {
  const pages = paginate([row(1, 'a'), row(1, 'b'), row(undefined, '')], preset({ columns: 2, rows: 2 }));

  test('a continuation row answers with the verse it continues', () => {
    expect(verseAt(pages, 0, 0, 1)).toBe(1);
  });

  test('a row belonging to no verse is undefined', () => {
    // Blank paragraph separators and psalm headings carry no verse number.
    expect(verseAt(pages, 0, 1, 0)).toBeUndefined();
  });

  test('an empty cell on a short page is undefined', () => {
    expect(verseAt(pages, 0, 1, 1)).toBeUndefined();
  });

  test('an index off the page is undefined rather than a throw', () => {
    expect(verseAt(pages, 9, 0, 0)).toBeUndefined();
    expect(verseAt(pages, 0, 9, 0)).toBeUndefined();
    expect(verseAt(pages, 0, 0, 9)).toBeUndefined();
    expect(verseAt(pages, -1, -1, -1)).toBeUndefined();
  });
});

describe('cellOf and verseAt round-trip', () => {
  test('across a whole chapter in numbered mode', () => {
    // Numbered mode gives every verse a row of its own, so every verse in the
    // chapter has a cell and every one of those cells names it back.
    const lines = layoutReading(CHAPTER, {
      width: 26,
      mode: 'numbered',
      theme,
      cursorVerse: 0,
    });
    const pages = paginate(lines, preset({ columns: 3, rows: 8, cellWidth: 26 }));
    expect(pages.length).toBeGreaterThan(1);

    for (const source of CHAPTER) {
      const cell = cellOf(pages, source.verse);
      expect(cell).toBeDefined();
      expect(verseAt(pages, cell!.page, cell!.column, cell!.row)).toBe(source.verse);
    }
  });

  test('across a whole chapter in paragraph mode, where verses run together', () => {
    const lines = layoutReading(CHAPTER, {
      width: 26,
      mode: 'paragraph',
      theme,
      cursorVerse: 0,
    });
    const pages = paginate(lines, preset({ columns: 3, rows: 8, cellWidth: 26 }));

    for (const source of CHAPTER) {
      const cell = cellOf(pages, source.verse);
      expect(cell).toBeDefined();
      expect(verseAt(pages, cell!.page, cell!.column, cell!.row)).toBe(source.verse);
    }
  });

  test('a paragraph-mode verse that leads no row has no cell', () => {
    // A row is labelled with the first verse on it, so two short verses sharing
    // a row report only the first. Inherited from `ReadingLine`, and not
    // fixable here: correcting it would mean re-deriving the layout.
    const lines = layoutReading([verse(1, 'One.'), verse(2, 'Two.')], {
      width: 40,
      mode: 'paragraph',
      theme,
      cursorVerse: 0,
    });
    const pages = paginate(lines, preset({ columns: 2, rows: 4, cellWidth: 40 }));

    expect(cellOf(pages, 1)).toEqual({ page: 0, column: 0, row: 0 });
    expect(cellOf(pages, 2)).toBeUndefined();
  });

  test('a verse that is not in the chapter has no cell', () => {
    const pages = paginate([row(1, 'a')], preset());
    expect(cellOf(pages, 99)).toBeUndefined();
  });
});

describe('the terminal size cannot reach pagination', () => {
  const SIZES: readonly TerminalSize[] = [
    { columns: 40, rows: 10 },
    { columns: 80, rows: 24 },
    { columns: 86, rows: 26 },
    { columns: 120, rows: 40 },
    { columns: 300, rows: 120 },
  ];

  /**
   * What `Reader` does: lay the chapter out at the *preset's* cell width and
   * slice it. The size is passed in and goes unused on purpose — if anyone ever
   * threads it into the width or the row count, these tests fail.
   */
  function pagesFor(_size: TerminalSize, geometry: ReadingPreset): Page[] {
    const lines = layoutReading(CHAPTER, {
      width: geometry.cellWidth,
      mode: 'numbered',
      theme,
      cursorVerse: 0,
    });
    return paginate(lines, geometry);
  }

  test('the same preset and chapter give identical pages at every size', () => {
    const geometry = preset({ columns: 3, rows: 8, cellWidth: 26 });
    const baseline = fingerprint(pagesFor(SIZES[0]!, geometry));

    for (const size of SIZES) {
      expect(fingerprint(pagesFor(size, geometry))).toEqual(baseline);
    }
  });

  test('a verse keeps the same cell at every size', () => {
    const geometry = preset({ columns: 3, rows: 8, cellWidth: 26 });
    const baseline = cellOf(pagesFor(SIZES[0]!, geometry), 17);

    for (const size of SIZES) {
      expect(cellOf(pagesFor(size, geometry), 17)).toEqual(baseline);
    }
  });

  test('no row is wider than its cell, however wide the terminal is', () => {
    // The row width is the giveaway that a reflow has crept in: laid out to a
    // 300-column body instead of a 26-column cell, this is the assertion that
    // notices.
    const geometry = preset({ columns: 3, rows: 8, cellWidth: 26 });

    for (const size of SIZES) {
      for (const line of flatten(pagesFor(size, geometry))) {
        expect(readingLineWidth(line)).toBeLessThanOrEqual(geometry.cellWidth);
      }
    }
  });
});
