/**
 * Column width and wrapping.
 *
 * The width tests are the point. Each one is a case where `String.length`
 * gives a different answer, which is precisely how a terminal UI ends up with
 * box drawing that drifts a column at a time.
 */
import { describe, expect, test } from 'bun:test';

import {
  charWidth,
  ellipsize,
  lineWidth,
  makeToken,
  padLineTo,
  padTo,
  stringWidth,
  tokenizeText,
  truncateLineToWidth,
  truncateToWidth,
  wrapRuns,
  wrapText,
  wrapTokens,
} from './layout';

describe('charWidth', () => {
  test('ASCII is one column', () => {
    expect(charWidth('a')).toBe(1);
    expect(charWidth(' ')).toBe(1);
  });

  test('precomposed Greek is one column', () => {
    expect(charWidth('θ')).toBe(1);
    expect(charWidth('ὸ')).toBe(1);
  });

  test('combining marks occupy no column', () => {
    expect(charWidth('́')).toBe(0); // combining acute
    expect(charWidth('ִ')).toBe(0); // Hebrew hiriq
    expect(charWidth('֑')).toBe(0); // Hebrew cantillation etnahta
  });

  test('CJK is two columns', () => {
    expect(charWidth('漢')).toBe(2);
    expect(charWidth('あ')).toBe(2);
    expect(charWidth('한')).toBe(2);
  });

  test('zero-width and formatting characters occupy no column', () => {
    expect(charWidth('​')).toBe(0); // zero-width space
    expect(charWidth('‍')).toBe(0); // zero-width joiner
    expect(charWidth('‏')).toBe(0); // right-to-left mark
  });

  test('control characters occupy no column', () => {
    expect(charWidth('\x1b')).toBe(0);
    expect(charWidth('\x00')).toBe(0);
  });
});

describe('stringWidth', () => {
  test('matches length for plain ASCII', () => {
    expect(stringWidth('John 3:16')).toBe(9);
  });

  test('Hebrew with vowel points is narrower than its length', () => {
    // בְּרֵאשִׁית — 10 code points, of which 4 are combining marks.
    const withPoints = 'בְּרֵאשִׁית';
    expect(withPoints.length).toBeGreaterThan(stringWidth(withPoints));
    expect(stringWidth(withPoints)).toBe(
      [...withPoints].filter((c) => charWidth(c) === 1).length,
    );
  });

  test('CJK is wider than its length', () => {
    expect('漢字'.length).toBe(2);
    expect(stringWidth('漢字')).toBe(4);
  });

  test('an astral character counts once, not twice', () => {
    // '𝕏' is a surrogate pair: two UTF-16 code units, one column.
    expect('𝕏'.length).toBe(2);
    expect(stringWidth('𝕏')).toBe(1);
  });

  test('decomposed and precomposed forms measure the same', () => {
    const precomposed = 'é';
    const decomposed = 'é';
    expect(precomposed.normalize('NFD')).toBe(decomposed);
    expect(stringWidth(precomposed)).toBe(stringWidth(decomposed));
  });

  test('polytonic Greek measures as drawn', () => {
    expect(stringWidth('οὕτως')).toBe(5);
    expect(stringWidth('ἠγάπησεν')).toBe(8);
  });
});

describe('padTo', () => {
  test('pads to an exact column count', () => {
    expect(padTo('ab', 5)).toBe('ab   ');
    expect(stringWidth(padTo('漢', 5))).toBe(5);
    expect(stringWidth(padTo('בְּרֵאשִׁית', 20))).toBe(20);
  });

  test('throws rather than returning an over-wide row', () => {
    // A row that is silently too wide would break the frame arithmetic, so
    // the assertion belongs at runtime.
    expect(() => padTo('too long', 3)).toThrow(/exceeding 3/);
  });

  test('an exact fit is left alone', () => {
    expect(padTo('abc', 3)).toBe('abc');
  });
});

describe('truncateToWidth and ellipsize', () => {
  test('never splits a wide character in half', () => {
    expect(truncateToWidth('漢漢漢', 5)).toBe('漢漢');
    expect(stringWidth(truncateToWidth('漢漢漢', 5))).toBe(4);
  });

  test('keeps combining marks with the character they belong to', () => {
    // Written decomposed (e + combining acute); truncateToWidth normalises to
    // NFC, so compare normalised forms rather than code-point sequences.
    const text = 'éabc';
    const cut = truncateToWidth(text, 2);
    expect(cut).toBe('éa'.normalize('NFC'));
    expect(stringWidth(cut)).toBe(2);
  });

  test('ellipsize marks that something was cut', () => {
    expect(ellipsize('Matthew Henry', 8)).toBe('Matthew…');
    expect(stringWidth(ellipsize('Matthew Henry', 8))).toBe(8);
  });

  test('ellipsize leaves a short string alone', () => {
    expect(ellipsize('Mark', 8)).toBe('Mark');
  });
});

describe('wrapText', () => {
  test('wraps on spaces within the width', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', { width: 12 });
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(12);
    expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      'the quick brown fox jumps over the lazy dog',
    );
  });

  test('applies a hanging indent to continuation lines', () => {
    const lines = wrapText('one two three four five six', { width: 12, hangingIndent: 3 });
    expect(lines[0]).not.toStartWith(' ');
    for (const line of lines.slice(1)) expect(line).toStartWith('   ');
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(12);
  });

  test('a word longer than the line is broken by width, not by character count', () => {
    const lines = wrapText('漢'.repeat(10), { width: 7 });
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(7);
    expect(lines.join('')).toBe('漢'.repeat(10));
  });

  test('no line exceeds the width for mixed-width text', () => {
    const lines = wrapText('word 漢字 another בְּרֵאשִׁית more text here', { width: 10 });
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(10);
  });

  test('empty text yields a single empty line', () => {
    expect(wrapText('', { width: 10 })).toEqual(['']);
  });
});

/**
 * The reader extended the wrapper to carry style and provenance. These cover the two
 * properties the reader depends on and `wrapText` cannot express: a style that
 * survives a line break, and a token that cannot be split across one.
 */
describe('styled wrapping', () => {
  const red = { fg: 174 };

  test('a run keeps its style across a line break', () => {
    const lines = wrapRuns([{ text: 'alpha beta gamma delta', style: red }], { width: 12 });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      for (const segment of line) {
        if (segment.text.trim() === '') continue;
        expect(segment.style).toBe(red);
      }
    }
  });

  test('adjacent words sharing a style coalesce into one segment', () => {
    const [line] = wrapRuns([{ text: 'one two three', style: red }], { width: 40 });
    // One segment, not three: the emitted SGR count tracks style changes, not
    // word count, which is what keeps a redrawn line cheap.
    expect(line).toHaveLength(1);
    expect(line![0]!.text).toBe('one two three');
  });

  test('a token is never split across a line break', () => {
    // The reader glues a verse number to the word after it. If the wrapper could
    // break there, a line could end on a lone superscript.
    const glued = makeToken([{ text: '¹⁶' }, { text: 'Beginning' }]);
    const tokens = [...tokenizeText('padding padding'), glued];
    const lines = wrapTokens(tokens, { width: 20 });

    const rendered = lines.map((l) => l.segments.map((s) => s.text).join(''));
    expect(rendered.some((line) => line.includes('¹⁶Beginning'))).toBe(true);
    expect(rendered.some((line) => line.trimEnd().endsWith('¹⁶'))).toBe(false);
  });

  test('a group tag is reported for every line the token lands on', () => {
    const tokens = tokenizeText('one two three four five six', { group: 7 });
    for (const line of wrapTokens(tokens, { width: 10 })) expect(line.group).toBe(7);
  });

  test('the gap style applies only between tokens of the same group', () => {
    // Both groups are styled, so the *only* unstyled thing on the line can be
    // the space at the group boundary — which is what stops one verse's
    // highlight bleeding into the next verse's number.
    const tokens = [
      ...tokenizeText('alpha beta', { group: 1, style: red }),
      ...tokenizeText('gamma', { group: 2, style: red }),
    ];
    const [line] = wrapTokens(tokens, { width: 40 });

    expect(line!.segments.map((s) => s.text)).toEqual(['alpha beta', ' ', 'gamma']);
    expect(line!.segments[0]!.style).toBe(red);
    expect(line!.segments[1]!.style).toBeUndefined();
    expect(line!.segments[2]!.style).toBe(red);
  });

  test('an over-wide token is broken by width, not by character count', () => {
    const wide = '一'.repeat(20); // 40 columns
    const lines = wrapRuns([{ text: wide }], { width: 10 });
    for (const line of lines) expect(lineWidth(line)).toBeLessThanOrEqual(10);
    expect(lines.map((l) => l.map((s) => s.text).join('')).join('')).toBe(wide);
  });

  test('a single character wider than the whole line does not loop', () => {
    const lines = wrapRuns([{ text: '一一' }], { width: 1 });
    expect(lines.map((l) => l.map((s) => s.text).join('')).join('')).toBe('一一');
  });
});

describe('styled line measurement', () => {
  test('lineWidth ignores nothing and counts wide characters as two', () => {
    expect(lineWidth([{ text: 'ab' }, { text: '一' }])).toBe(4);
  });

  test('padLineTo pads with an unstyled segment', () => {
    // Deliberately unstyled: padding inside the last segment would drag its
    // background out to the right margin.
    const padded = padLineTo([{ text: 'ab', style: { bg: 238 } }], 6);
    expect(lineWidth(padded)).toBe(6);
    expect(padded[padded.length - 1]!.style).toBeUndefined();
  });

  test('truncateLineToWidth cuts inside a segment without splitting a wide char', () => {
    const cut = truncateLineToWidth([{ text: 'ab' }, { text: '一一' }], 3);
    expect(lineWidth(cut)).toBe(2);
    expect(cut.map((s) => s.text).join('')).toBe('ab');
  });
});

describe('the separator space', () => {
  test('a word never touches the one before it at the wrap column', () => {
    // Regression: if the separator is emitted *after* a token, a token
    // that fits without its leading space stayed on the line glued to the
    // previous word. In the reader that rendered "Plead my" as "Pleadmy" —
    // a wrong word, at exactly the wrap column, in ordinary prose.
    const text = 'Plead my cause and deliver me quicken me according to thy word';
    // From the longest word upward, so nothing here is the over-wide case.
    for (let width = 10; width <= 40; width += 1) {
      const lines = wrapText(text, { width });
      expect(lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(text);
    }
  });

  test('no line ends in a trailing space', () => {
    for (let width = 8; width <= 40; width += 1) {
      for (const line of wrapText('alpha beta gamma delta epsilon zeta', { width })) {
        expect(line).toBe(line.trimEnd());
      }
    }
  });
});
