/**
 * Colour capability and SGR emission.
 *
 * The interesting cases are all about *not* emitting colour: a piped run, a
 * `NO_COLOR` terminal, and a `TERM=dumb` one all have to produce output that is
 * still readable as plain text, because in every one of them something other
 * than a terminal is on the other end.
 */
import { describe, expect, test } from 'bun:test';

import {
  createTheme,
  detectColorDepth,
  mergeStyle,
  renderStyledLine,
  RESET,
  sgr,
  stripAnsi,
} from './style';

describe('detectColorDepth', () => {
  test('a pipe gets no colour even on a capable terminal', () => {
    expect(detectColorDepth({ TERM: 'xterm-256color' }, false)).toBe('none');
  });

  test('NO_COLOR wins over a capable terminal', () => {
    expect(detectColorDepth({ NO_COLOR: '1', TERM: 'xterm-256color' }, true)).toBe('none');
  });

  test('an empty NO_COLOR is not set — the convention is presence, not value', () => {
    expect(detectColorDepth({ NO_COLOR: '', TERM: 'xterm-256color' }, true)).toBe('ansi256');
  });

  test('FORCE_COLOR overrides both NO_COLOR and the pipe', () => {
    expect(detectColorDepth({ FORCE_COLOR: '3', NO_COLOR: '1' }, false)).toBe('ansi256');
    expect(detectColorDepth({ FORCE_COLOR: '1' }, false)).toBe('ansi16');
    expect(detectColorDepth({ FORCE_COLOR: '0', TERM: 'xterm-256color' }, true)).toBe('none');
  });

  test('TERM=dumb gets nothing', () => {
    expect(detectColorDepth({ TERM: 'dumb' }, true)).toBe('none');
  });

  test('Windows Terminal is recognised, which sets neither TERM nor COLORTERM', () => {
    expect(detectColorDepth({ WT_SESSION: 'abc' }, true)).toBe('ansi256');
  });

  test('a plain xterm gets 16 colours', () => {
    expect(detectColorDepth({ TERM: 'xterm' }, true)).toBe('ansi16');
  });

  test('COLORTERM=truecolor is enough on its own', () => {
    expect(detectColorDepth({ COLORTERM: 'truecolor' }, true)).toBe('ansi256');
  });
});

describe('sgr', () => {
  test('256-colour indices are emitted directly', () => {
    expect(sgr({ fg: 174, bg: 238 }, 'ansi256')).toBe('\x1b[38;5;174;48;5;238m');
  });

  test('a 256-colour index is approximated in the 16-colour space', () => {
    // 174 is a light red in the cube; it must not be emitted as `38;5;174`,
    // which a 16-colour terminal renders as nothing at all.
    const emitted = sgr({ fg: 174 }, 'ansi16');
    expect(emitted).not.toContain('38;5;');
    expect(emitted).toMatch(/^\x1b\[\d+m$/);
  });

  test('colour is dropped but attributes survive when colour is off', () => {
    expect(sgr({ fg: 174, italic: true }, 'none')).toBe('\x1b[3m');
  });

  test('an empty style emits nothing at all', () => {
    expect(sgr({}, 'ansi256')).toBe('');
    expect(sgr(undefined, 'ansi256')).toBe('');
  });
});

describe('renderStyledLine', () => {
  test('each styled segment closes itself', () => {
    const out = renderStyledLine([{ text: 'a', style: { bold: true } }, { text: 'b' }], 'ansi256');
    expect(out).toBe('\x1b[1ma' + RESET + 'b');
  });

  test('no colour means no escapes at all', () => {
    const out = renderStyledLine([{ text: 'a', style: { fg: 1 } }, { text: 'b' }], 'none');
    expect(out).toBe('ab');
  });

  test('stripAnsi recovers exactly what the user sees', () => {
    const line = [{ text: 'For God ', style: { fg: 174 } }, { text: 'so loved' }];
    expect(stripAnsi(renderStyledLine(line, 'ansi256'))).toBe('For God so loved');
  });
});

describe('mergeStyle', () => {
  test('the cursor highlight supplies a background without erasing red letter', () => {
    const merged = mergeStyle({ fg: 254, bg: 238 }, { fg: 174 });
    expect(merged).toEqual({ fg: 174, bg: 238 });
  });

  test('an undefined side is a no-op in either direction', () => {
    expect(mergeStyle(undefined, { bold: true })).toEqual({ bold: true });
    expect(mergeStyle({ bold: true }, undefined)).toEqual({ bold: true });
  });
});

describe('createTheme', () => {
  test('every role that sets a background also sets a foreground', () => {
    // A background alone is the classic terminal bug: dark grey behind the
    // user's own dark text is unreadable on a light theme.
    const theme = createTheme('ansi256');
    for (const [role, style] of Object.entries(theme)) {
      if (role === 'depth' || typeof style !== 'object') continue;
      if ((style as { bg?: number }).bg !== undefined) {
        expect((style as { fg?: number }).fg).toBeDefined();
      }
    }
  });

  test('without colour the cursor verse still has a mark', () => {
    // Reverse video is not colour, so it survives NO_COLOR — and it is the only
    // way left to show a verse that begins mid-line.
    expect(createTheme('none').cursorVerse.reverse).toBe(true);
  });
});
