/**
 * The two reading modes, and how a verse number is drawn in each.
 *
 * These replace the reading-mode tests that were in `layout.test.ts`. The
 * assertions that carried over are about paragraph breaks and the gutter; the
 * new ones are about the two things the old `string[]` return could not express:
 * which verse a row belongs to, and a highlight that survives a line break.
 */
import { describe, expect, test } from 'bun:test';

import type { DisplayVerse } from '../app/verseText';
import { findVerseEndRow, findVerseRow, layoutReading, superscript } from './reading';
import { lineWidth } from './layout';
import { createTheme, type StyledLine } from './style';

const theme = createTheme('ansi256');

function verse(number: number, text: string, extra: Partial<DisplayVerse> = {}): DisplayVerse {
  return {
    verseId: 43003000 + number,
    verse: number,
    runs: [{ text }],
    plainText: text,
    paragraphStart: false,
    heading: undefined,
    ...extra,
  };
}

function textOf(line: { segments: StyledLine }): string {
  return line.segments.map((s) => s.text).join('');
}

const JOHN = [
  verse(14, 'And the Word was made flesh, and dwelt among us.', { paragraphStart: true }),
  verse(15, 'John bare witness of him, and cried, saying.'),
  verse(16, 'And of his fulness have all we received, and grace for grace.'),
];

describe('numbered mode', () => {
  test('the number sits in a gutter and the text hangs beside it', () => {
    const lines = layoutReading(JOHN, { width: 40, mode: 'numbered', theme, cursorVerse: 0 });
    expect(textOf(lines[0]!)).toStartWith(' 14 ');

    // Continuation rows line up under the text, not under the number.
    const continuation = lines.find((l, i) => i > 0 && textOf(l).startsWith('    '));
    expect(continuation).toBeDefined();
    for (const line of lines) expect(lineWidth(line.segments)).toBeLessThanOrEqual(40);
  });

  test('no blank rows between verses', () => {
    const lines = layoutReading(JOHN, { width: 40, mode: 'numbered', theme, cursorVerse: 0 });
    expect(lines.filter((l) => textOf(l) === '')).toHaveLength(0);
  });

  test('every row knows which verse it belongs to', () => {
    const lines = layoutReading(JOHN, { width: 30, mode: 'numbered', theme, cursorVerse: 0 });
    for (const line of lines) expect(line.verse).toBeDefined();
    expect(findVerseRow(lines, 15)).toBeGreaterThan(findVerseRow(lines, 14));
  });
});

describe('paragraph mode', () => {
  test('verses run together with superscript numbers inline', () => {
    const lines = layoutReading(JOHN, { width: 40, mode: 'paragraph', theme, cursorVerse: 0 });
    const joined = lines.map(textOf).join(' ');
    expect(joined).toContain('¹⁴And the Word');
    expect(joined).toContain('¹⁵John bare witness');
    for (const line of lines) expect(lineWidth(line.segments)).toBeLessThanOrEqual(40);
  });

  test('a blank row appears only where the module says a paragraph starts', () => {
    const lines = layoutReading(
      [
        verse(1, 'First paragraph text.', { paragraphStart: true }),
        verse(2, 'Still the first paragraph.'),
        verse(3, 'A new paragraph begins.', { paragraphStart: true }),
      ],
      { width: 60, mode: 'paragraph', theme, cursorVerse: 0 },
    );
    // Exactly one blank row — between verse 2 and verse 3, not after each verse.
    expect(lines.filter((l) => textOf(l) === '')).toHaveLength(1);
  });

  test('no blank rows at all when the module marks no paragraphs', () => {
    const lines = layoutReading([verse(1, 'One.'), verse(2, 'Two.')], {
      width: 60,
      mode: 'paragraph',
      theme,
      cursorVerse: 0,
    });
    expect(lines.filter((l) => textOf(l) === '')).toHaveLength(0);
  });

  test('a verse number is never left alone at the end of a row', () => {
    // The number is glued to the first word for exactly this reason.
    const lines = layoutReading(JOHN, { width: 24, mode: 'paragraph', theme, cursorVerse: 0 });
    for (const line of lines) expect(textOf(line).trimEnd()).not.toMatch(/[⁰-⁹]$/u);
  });
});

describe('the cursor verse', () => {
  test('is lit across every row it occupies, including after a wrap', () => {
    const lines = layoutReading(JOHN, { width: 24, mode: 'paragraph', theme, cursorVerse: 16 });
    const rows = lines.filter((l) => l.verse === 16);
    expect(rows.length).toBeGreaterThan(1);

    for (const row of rows) {
      const lit = row.segments.some((s) => s.style?.bg === theme.cursorVerse.bg);
      expect(lit).toBe(true);
    }
  });

  test('the spaces inside it are lit too, so the highlight is continuous', () => {
    const [line] = layoutReading([verse(1, 'alpha beta gamma')], {
      width: 40,
      mode: 'paragraph',
      theme,
      cursorVerse: 1,
    });
    const gaps = line!.segments.filter((s) => s.text.trim() === '' && s.text !== '');
    // Not a single unlit gap between the words of the highlighted verse.
    for (const gap of gaps) expect(gap.style?.bg).toBe(theme.cursorVerse.bg);
  });

  test('no verse is lit when the cursor is on none of them', () => {
    const lines = layoutReading(JOHN, { width: 40, mode: 'paragraph', theme, cursorVerse: 0 });
    for (const line of lines) {
      for (const segment of line.segments) expect(segment.style?.bg).toBeUndefined();
    }
  });

  test('a highlighted verse still emits one segment per style change, not per word', () => {
    const [line] = layoutReading([verse(1, 'one two three four five')], {
      width: 60,
      mode: 'paragraph',
      theme,
      cursorVerse: 1,
    });
    // Number, then the whole run: the merged style is memoised, so coalescing
    // by identity still works and the row does not cost five SGR pairs.
    expect(line!.segments.length).toBeLessThanOrEqual(3);
  });
});

describe('headings', () => {
  test('a psalm title is drawn above its verse and belongs to no verse', () => {
    const lines = layoutReading(
      [verse(1, 'Lord, how are they increased that trouble me!', { heading: 'A Psalm of David.' })],
      { width: 60, mode: 'paragraph', theme, cursorVerse: 0 },
    );
    const headingRow = lines.find((l) => textOf(l).includes('A Psalm of David.'));
    expect(headingRow).toBeDefined();
    expect(headingRow!.verse).toBeUndefined();
    expect(lines.indexOf(headingRow!)).toBeLessThan(findVerseRow(lines, 1));
  });
});

describe('row lookup', () => {
  test('findVerseEndRow finds the last row of a wrapped verse', () => {
    const lines = layoutReading(JOHN, { width: 24, mode: 'numbered', theme, cursorVerse: 0 });
    const start = findVerseRow(lines, 16);
    const end = findVerseEndRow(lines, 16);
    expect(end).toBeGreaterThanOrEqual(start);
    expect(lines[end]!.verse).toBe(16);
  });

  test('a verse that is not laid out reports -1 rather than 0', () => {
    const lines = layoutReading(JOHN, { width: 40, mode: 'numbered', theme, cursorVerse: 0 });
    expect(findVerseRow(lines, 99)).toBe(-1);
  });
});

describe('superscript', () => {
  test('every digit maps, including multi-digit numbers', () => {
    expect(superscript(16)).toBe('¹⁶');
    expect(superscript(176)).toBe('¹⁷⁶');
    expect(superscript(0)).toBe('⁰');
  });
});

describe('verse number styles', () => {
  const paragraph = (verseNumbers: 'superscript' | 'margin' | 'inline' | 'hidden'): string =>
    layoutReading(JOHN, { width: 60, mode: 'paragraph', theme, cursorVerse: 0, verseNumbers })
      .map(textOf)
      .join('\n');

  test('superscript is what a caller that says nothing gets', () => {
    const silent = layoutReading(JOHN, { width: 60, mode: 'paragraph', theme, cursorVerse: 0 });
    expect(silent.map(textOf).join('\n')).toBe(paragraph('superscript'));
  });

  test('inline writes the number in parentheses instead', () => {
    const text = paragraph('inline');
    expect(text).toContain('(14) And the Word');
    expect(text).not.toContain('¹⁴');
  });

  test('margin in prose draws the superscript, because prose has no margin', () => {
    expect(paragraph('margin')).toBe(paragraph('superscript'));
  });

  test('hidden leaves the words and nothing else', () => {
    const text = paragraph('hidden');
    expect(text).toStartWith('And the Word was made flesh');
    expect(text).not.toContain('14');
    expect(text).not.toContain('¹⁴');
  });

  test('a hidden number still leaves every row traceable to its verse', () => {
    // The row-to-verse mapping is what the cursor and the scroll clamp are built
    // on, so hiding the number must not hide the verse.
    const lines = layoutReading(JOHN, {
      width: 60,
      mode: 'paragraph',
      theme,
      cursorVerse: 0,
      verseNumbers: 'hidden',
    });
    expect(findVerseRow(lines, 15)).toBeGreaterThanOrEqual(0);
    expect(findVerseRow(lines, 16)).toBeGreaterThanOrEqual(0);
  });

  test('the numbered gutter is plain digits whichever of the two styles asks', () => {
    // Numbered mode *is* the margin style, so superscript and inline have nothing
    // left to distinguish there; the fallback is the same request read in context,
    // not a setting being quietly dropped.
    for (const verseNumbers of ['superscript', 'margin', 'inline'] as const) {
      const lines = layoutReading(JOHN, {
        width: 40,
        mode: 'numbered',
        theme,
        cursorVerse: 0,
        verseNumbers,
      });
      expect(textOf(lines[0]!)).toStartWith(' 14 ');
    }
  });

  test('hiding the number in numbered mode reclaims the gutter', () => {
    const lines = layoutReading(JOHN, {
      width: 40,
      mode: 'numbered',
      theme,
      cursorVerse: 0,
      verseNumbers: 'hidden',
    });
    // No number, and no empty column left where it used to be.
    expect(textOf(lines[0]!)).toStartWith('And the Word');
    for (const line of lines) expect(lineWidth(line.segments)).toBeLessThanOrEqual(40);
  });
});

describe('a break between verses', () => {
  test('prose gains a blank row before each verse but the first', () => {
    const without = layoutReading(JOHN, { width: 60, mode: 'paragraph', theme, cursorVerse: 0 });
    const with_ = layoutReading(JOHN, {
      width: 60,
      mode: 'paragraph',
      theme,
      cursorVerse: 0,
      breakOnVerse: true,
    });
    const blanks = (lines: readonly { segments: StyledLine }[]): number =>
      lines.filter((line) => textOf(line) === '').length;

    // Two more blanks for three verses: the break goes between them, not before
    // the first one.
    expect(blanks(with_)).toBe(blanks(without) + 2);
    expect(textOf(with_[0]!)).not.toBe('');
  });

  test('the break ends the paragraph rather than sitting inside it', () => {
    // A blank row pushed without flushing would land in the middle of a wrapped
    // paragraph and the row after it would continue mid-sentence.
    const lines = layoutReading(JOHN, {
      width: 60,
      mode: 'paragraph',
      theme,
      cursorVerse: 0,
      breakOnVerse: true,
    });
    lines.forEach((line, index) => {
      if (textOf(line) !== '' || index + 1 >= lines.length) return;
      expect(textOf(lines[index + 1]!)).toMatch(/^[¹²³⁴⁵⁶⁷⁸⁹⁰(A-Z]/);
    });
  });

  test('numbered mode gains the same blank between blocks', () => {
    const lines = layoutReading(JOHN, {
      width: 40,
      mode: 'numbered',
      theme,
      cursorVerse: 0,
      breakOnVerse: true,
    });
    expect(lines.filter((line) => textOf(line) === '')).toHaveLength(2);
  });
});
