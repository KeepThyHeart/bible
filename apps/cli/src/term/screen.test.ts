/**
 * The diffing renderer.
 *
 * The assertions are about *what is not written*. A renderer that repaints
 * everything passes any test that only checks the final contents, so these
 * measure the emitted bytes: an unchanged frame must emit nothing, and a
 * one-character edit must not emit the whole line.
 */
import { describe, expect, test } from 'bun:test';

import { Screen, type ScreenWriter, firstDifferingColumn, sliceFromColumn } from './screen';

class Recorder implements ScreenWriter {
  chunks: string[] = [];
  write(data: string): void {
    this.chunks.push(data);
  }
  get all(): string {
    return this.chunks.join('');
  }
  reset(): void {
    this.chunks = [];
  }
  /** Printable text only, with the escape sequences stripped out. */
  get text(): string {
    return this.all.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  }
}

function screen(rows = 10, columns = 40) {
  const out = new Recorder();
  const s = new Screen({ out, measure: () => ({ rows, columns }) });
  return { screen: s, out };
}

describe('alternate screen buffer', () => {
  test('start enters the alternate buffer and hides the cursor', () => {
    const { screen: s, out } = screen();
    s.start();
    expect(out.all).toContain('\x1b[?1049h');
    expect(out.all).toContain('\x1b[?25l');
    s.stop();
  });

  test('stop restores the buffer and the cursor', () => {
    const { screen: s, out } = screen();
    s.start();
    out.reset();
    s.stop();
    // Scrollback must come back, and the user's shell must have a cursor.
    expect(out.all).toContain('\x1b[?1049l');
    expect(out.all).toContain('\x1b[?25h');
  });

  test('start and stop are idempotent', () => {
    const { screen: s, out } = screen();
    s.start();
    s.start();
    s.stop();
    out.reset();
    s.stop();
    expect(out.all).toBe('');
  });
});

describe('diffing', () => {
  test('an unchanged frame emits nothing at all', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['alpha', 'beta']);
    out.reset();

    s.draw(['alpha', 'beta']);

    // This is what makes 30 redraws/sec free when nothing moved.
    expect(out.all).toBe('');
  });

  test('only the changed line is rewritten', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['alpha', 'beta', 'gamma']);
    out.reset();

    s.draw(['alpha', 'BETA', 'gamma']);

    expect(out.text).toContain('BETA');
    expect(out.text).not.toContain('alpha');
    expect(out.text).not.toContain('gamma');
  });

  test('within a line, only the changed suffix is rewritten', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['the quick brown fox']);
    out.reset();

    s.draw(['the quick brown FOX']);

    // Typing at the end of a long input line must not repaint the line.
    expect(out.text).toBe('FOX');
    expect(out.all).toContain('\x1b[1;17H');
  });

  test('a shortened line is erased to the right, not left as debris', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['a long line of text']);
    out.reset();

    s.draw(['a long']);

    expect(out.all).toContain('\x1b[K');
  });

  test('rows removed from the frame are cleared', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['one', 'two', 'three']);
    out.reset();

    s.draw(['one']);

    // Rows 2 and 3 must be visited and erased.
    expect(out.all).toContain('\x1b[2;1H');
    expect(out.all).toContain('\x1b[3;1H');
    expect(out.all).toContain('\x1b[K');
  });

  test('invalidate forces a full repaint', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['alpha', 'beta']);
    out.reset();

    s.invalidate();
    s.draw(['alpha', 'beta']);

    // After a resize the terminal has reflowed its own contents, so a diff
    // against the old frame would leave debris behind.
    expect(out.text).toContain('alpha');
    expect(out.text).toContain('beta');
  });

  test('the frame is clipped to the terminal height', () => {
    const { screen: s, out } = screen(3);
    s.start();
    out.reset();

    s.draw(['1', '2', '3', '4', '5']);

    expect(out.text).not.toContain('4');
    expect(out.text).not.toContain('5');
  });

  test('everything for one frame goes out in a single write', () => {
    const { screen: s, out } = screen();
    s.start();
    out.reset();

    s.draw(['alpha', 'beta', 'gamma']);

    // Several writes can flush separately, which is what visible tearing is.
    expect(out.chunks).toHaveLength(1);
  });
});

describe('cursor', () => {
  test('is placed and shown when a position is given', () => {
    const { screen: s, out } = screen();
    s.start();
    out.reset();

    s.draw(['prompt'], { row: 4, column: 6 });

    expect(out.all).toContain('\x1b[5;7H');
    expect(out.all).toEndWith('\x1b[?25h');
  });

  test('stays hidden when no position is given', () => {
    const { screen: s, out } = screen();
    s.start();
    out.reset();

    s.draw(['prompt']);

    expect(out.all).not.toContain('\x1b[?25h');
  });
});

describe('wide characters', () => {
  test('the diff column is a display column, not a string index', () => {
    // Two CJK characters occupy four columns, so the difference starts at 4.
    expect(firstDifferingColumn('漢字a', '漢字b')).toBe(4);
  });

  test('a common prefix of combining marks contributes no columns', () => {
    expect(firstDifferingColumn('éa', 'éb')).toBe(1);
  });

  test('identical lines report their full width', () => {
    expect(firstDifferingColumn('abc', 'abc')).toBe(3);
  });

  test('sliceFromColumn never splits a wide character', () => {
    expect(sliceFromColumn('漢字abc', 4)).toBe('abc');
    expect(sliceFromColumn('漢字abc', 2)).toBe('字abc');
  });

  test('sliceFromColumn at zero returns the whole line', () => {
    expect(sliceFromColumn('abc', 0)).toBe('abc');
  });

  test('a wide-character edit positions the cursor by column', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw(['漢字abc']);
    out.reset();

    s.draw(['漢字xbc']);

    // Column 5 in ANSI's 1-based counting = display column 4.
    expect(out.all).toContain('\x1b[1;5H');
    expect(out.text).toBe('xbc');
  });
});

/**
 * The reader made the diff ANSI-aware. Before that, `stringWidth` counted the bytes
 * of an escape sequence as visible columns, so any coloured line put the cursor
 * in the wrong place and corrupted every row after it.
 */
describe('coloured lines', () => {
  const RED = '\x1b[38;5;174m';
  const RESET = '\x1b[0m';

  test('an escape sequence occupies no columns', () => {
    // `abc` vs `<red>abc` differ at column 0, not at column 8.
    expect(firstDifferingColumn('abc', `${RED}abc`)).toBe(0);
    // Identical text, identical styling: no difference anywhere.
    expect(firstDifferingColumn(`${RED}abc${RESET}`, `${RED}abc${RESET}`)).toBe(3);
  });

  test('a style change alone is detected as a difference', () => {
    // The visible text is the same, so a width-only comparison would call these
    // equal and leave the old colour on screen.
    const a = `${RED}abc${RESET}`;
    const b = `\x1b[38;5;39mabc${RESET}`;
    expect(firstDifferingColumn(a, b)).toBe(0);
  });

  test('columns are counted past the escapes, not including them', () => {
    expect(firstDifferingColumn(`${RED}abc${RESET}def`, `${RED}abc${RESET}deX`)).toBe(5);
  });

  test('slicing re-establishes the style in force at the cut', () => {
    // Without the prefix the tail is written with no colour, and the highlight
    // appears to stop wherever the previous frame happened to differ.
    const sliced = sliceFromColumn(`${RED}abcdef${RESET}`, 3);
    expect(sliced).toStartWith(RED);
    expect(sliced.replace(/\x1b\[[0-9;]*m/g, '')).toBe('def');
  });

  test('a reset before the cut means the tail is unstyled', () => {
    const sliced = sliceFromColumn(`${RED}abc${RESET}def`, 4);
    expect(sliced).not.toStartWith(RED);
    expect(sliced.replace(/\x1b\[[0-9;]*m/g, '')).toBe('ef');
  });

  test('a redrawn row is reset before it is erased to the margin', () => {
    // `\x1b[K` fills to the right margin with the *current* background, so
    // erasing while a highlight is active paints a bar to the edge of the
    // screen. The reset has to come first.
    const { screen: s, out } = screen();
    s.start();
    s.draw(['plain']);
    out.reset();
    s.draw([`\x1b[48;5;238mlit${RESET}`]);

    const resetAt = out.all.lastIndexOf(RESET);
    const eraseAt = out.all.lastIndexOf('\x1b[K');
    expect(resetAt).toBeGreaterThan(-1);
    expect(resetAt).toBeLessThan(eraseAt);
  });

  test('an unchanged coloured frame still emits nothing', () => {
    const { screen: s, out } = screen();
    s.start();
    const frame = [`${RED}For God so loved${RESET}`, 'the world'];
    s.draw(frame);
    out.reset();
    s.draw(frame);
    expect(out.all).toBe('');
  });

  test('a colour change on one word does not rewrite the whole line', () => {
    const { screen: s, out } = screen();
    s.start();
    s.draw([`the ${RED}world${RESET} entire`]);
    out.reset();
    s.draw([`the \x1b[38;5;39mworld${RESET} entire`]);

    // Only from column 4 onward. If this ever rewrote from column 0 the diff
    // would be measuring bytes rather than columns again.
    expect(out.all).toContain('\x1b[1;5H');
    expect(out.all).not.toContain('\x1b[1;1H');
  });
});
