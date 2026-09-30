/**
 * The frame every screen is drawn inside.
 *
 * One property matters more than all the others: **no row is ever wider than
 * the terminal.** A row that overshoots wraps, and a wrapped row pushes every
 * row below it down by one, so the diff writes to the wrong lines from then on.
 * A frame that is one column too wide does not look one column wrong; it looks
 * completely broken.
 */
import { describe, expect, test } from 'bun:test';

import { bodyMetrics, MARGIN, MAX_TEXT_WIDTH, renderFrame, type FrameOptions } from './frame';
import { createTheme, stripAnsi } from '../term/style';
import { stringWidth } from '../term/layout';

const theme = createTheme('ansi256');

function frame(overrides: Partial<FrameOptions> = {}) {
  return renderFrame({
    size: { columns: 88, rows: 24 },
    theme,
    inputOpen: true,
    tabs: [
      { label: 'John 3', active: true },
      { label: 'Romans 8', active: false },
    ],
    status: 'KJV  v16/36  ¶',
    body: [[{ text: 'John 3', style: theme.title }], [], [{ text: 'For God so loved…' }]],
    input: '',
    hints: '↑↓ verse  < > chapter',
    ...overrides,
  });
}

describe('frame geometry', () => {
  test('the frame is exactly as tall as the terminal', () => {
    expect(frame().lines).toHaveLength(24);
    expect(frame({ size: { columns: 88, rows: 9 } }).lines).toHaveLength(9);
  });

  test('no row is wider than the terminal', () => {
    for (const columns of [20, 40, 80, 88, 200]) {
      const rendered = frame({ size: { columns, rows: 24 } });
      for (const line of rendered.lines) {
        expect(stringWidth(stripAnsi(line))).toBeLessThanOrEqual(columns);
      }
    }
  });

  test('a body row too wide for the terminal is cut, not wrapped', () => {
    const wide = [{ text: 'x'.repeat(500) }];
    const rendered = frame({ size: { columns: 40, rows: 24 }, body: [wide] });
    expect(rendered.lines).toHaveLength(24);
    for (const line of rendered.lines) {
      expect(stringWidth(stripAnsi(line))).toBeLessThanOrEqual(40);
    }
  });

  test('short rows are not padded — the renderer erases to the margin itself', () => {
    // Padding would make every changed row cost the full terminal width on the
    // wire, which is exactly the cost the renderer's diff exists to avoid.
    const rendered = frame({ body: [[{ text: 'short' }]] });
    const bodyRow = rendered.lines.find((l) => stripAnsi(l).trim() === 'short');
    expect(bodyRow).toBeDefined();
    expect(stringWidth(stripAnsi(bodyRow!))).toBeLessThan(88);
  });
});

describe('bodyMetrics', () => {
  test('the reading column is capped even on a very wide terminal', () => {
    expect(bodyMetrics({ columns: 300, rows: 40 }).width).toBe(MAX_TEXT_WIDTH);
  });

  test('a narrow terminal gives up the margin last, not the text', () => {
    expect(bodyMetrics({ columns: 60, rows: 24 }).width).toBe(60 - MARGIN * 2);
  });

  test('the body shrinks by the chrome, and never below one row', () => {
    // Closed (the default): header, rule, body, rule, hints — 4 rows of chrome.
    expect(bodyMetrics({ columns: 88, rows: 24 }).height).toBe(20);
    expect(bodyMetrics({ columns: 88, rows: 4 }).height).toBeGreaterThanOrEqual(1);
  });

  test('the open input line costs the body a row, closing it gives that row back', () => {
    const closed = bodyMetrics({ columns: 88, rows: 24 }, 0, false).height;
    const open = bodyMetrics({ columns: 88, rows: 24 }, 0, true).height;
    expect(open).toBe(closed - 2); // the input row, and the rule beside it.
  });

  test('a short terminal drops chrome rather than the body', () => {
    // Six rows of chrome in a ten-row terminal would leave four for reading.
    const tall = bodyMetrics({ columns: 88, rows: 24 }).height;
    const short = bodyMetrics({ columns: 88, rows: 10 }).height;
    expect(short).toBeGreaterThan(10 - 6);
    expect(short).toBeLessThan(tall);
  });
});

describe('header', () => {
  test('the active tab is marked and the status is right-aligned', () => {
    const header = stripAnsi(frame().lines[0]!);
    expect(header).toContain('▸John 3');
    expect(header).toContain('Romans 8');
    expect(header.trimEnd()).toEndWith('KJV  v16/36  ¶');
  });

  test('a long tab strip is truncated before the status is', () => {
    // The far end of a long strip is the tab you are least likely to want; the
    // status tells you where you are and is short and fixed.
    const many = Array.from({ length: 30 }, (_, i) => ({
      label: `Book ${i} 1`,
      active: i === 0,
    }));
    const header = stripAnsi(frame({ tabs: many }).lines[0]!);
    expect(header.trimEnd()).toEndWith('KJV  v16/36  ¶');
    expect(stringWidth(header)).toBeLessThanOrEqual(88);
  });
});

describe('input line and hints', () => {
  test('the cursor is reported at the end of what is typed', () => {
    const rendered = frame({ input: '16-17' });
    expect(rendered.cursor).toBeDefined();
    expect(rendered.cursor!.column).toBe(2 + '16-17'.length);
    expect(stripAnsi(rendered.lines[rendered.cursor!.row]!)).toBe('> 16-17');
  });

  test('a message replaces the hints rather than shifting the layout', () => {
    const withHints = frame();
    const withMessage = frame({ message: { text: 'Nothing to copy.', tone: 'info' } });
    expect(withHints.lines).toHaveLength(withMessage.lines.length);
    expect(stripAnsi(withMessage.lines[23]!)).toContain('Nothing to copy.');
    expect(stripAnsi(withMessage.lines[23]!)).not.toContain('↑↓ verse');
  });

  test('a notice sits directly above the input line', () => {
    const rendered = frame({ notice: [[{ text: 'John 3:16-17 selected' }]] });
    const noticeRow = rendered.lines.findIndex((l) => stripAnsi(l).includes('selected'));
    expect(rendered.cursor).toBeDefined();
    const inputRow = rendered.cursor!.row;
    expect(noticeRow).toBeGreaterThan(-1);
    // Notice, then a rule, then the input line.
    expect(inputRow - noticeRow).toBe(2);
  });

  test('the input row does not exist while the line is closed', () => {
    const rendered = frame({ inputOpen: false });
    expect(rendered.cursor).toBeUndefined();
    expect(rendered.lines.some((l) => stripAnsi(l).startsWith('> '))).toBe(false);
  });

  test('the footer says how to open the line only while it is closed', () => {
    const closed = stripAnsi(frame({ inputOpen: false }).lines[23]!);
    const open = stripAnsi(frame({ inputOpen: true }).lines[23]!);
    expect(closed).toContain('/ go to or search');
    expect(open).not.toContain('/ go to or search');
  });
});

describe('no colour', () => {
  test('no colour is emitted, though attributes still are', () => {
    // `NO_COLOR` asks for no *colour*. Bold, italic and reverse video are
    // attributes rather than colours, and the theme keeps them on purpose —
    // reverse video is the only mark left for a verse that starts mid-line.
    const plain = renderFrame({
      size: { columns: 60, rows: 20 },
      theme: createTheme('none'),
      tabs: [{ label: 'John 3', active: true }],
      status: 'KJV',
      body: [[{ text: 'For God so loved…', style: { fg: 174 } }]],
      input: '',
      inputOpen: true,
      hints: 'q quit',
    });
    for (const line of plain.lines) {
      for (const [, codes] of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
        for (const code of codes!.split(';')) expect(Number(code)).toBeLessThanOrEqual(9);
      }
    }
  });
});
