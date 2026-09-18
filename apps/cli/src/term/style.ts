/**
 * Colour and text attributes.
 *
 * The reader has to distinguish several things at once — the cursor verse,
 * words of Christ, translator-supplied words, chrome — and a terminal has
 * exactly one mechanism for all of them. This module owns that mechanism so no
 * screen writes an escape sequence by hand.
 *
 * Two rules shape the design:
 *
 * 1. **A segment's style is self-contained.** Every styled segment emits its
 *    own SGR and its own reset, so no segment depends on what came before it.
 *    `screen.ts` can therefore cut a line at any column and reconstruct the
 *    active style exactly (see `sliceFromColumn`), which is what makes per-cell
 *    diffing work on coloured output.
 * 2. **Screens ask for a role, not a colour.** `theme.wordsOfChrist` rather
 *    than `{ fg: 174 }`. The theme resolves roles against what the terminal can
 *    actually do, so a 16-colour terminal and a `NO_COLOR` terminal both get a
 *    sensible answer without any screen knowing about them.
 */

/**
 * Text attributes for one run of text.
 *
 * `fg` / `bg` are xterm-256 palette indices. The theme downgrades them for
 * 16-colour terminals; nothing above the theme should set them directly.
 */
export interface Style {
  readonly fg?: number;
  readonly bg?: number;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  /** Swap foreground and background. The only emphasis available without colour. */
  readonly reverse?: boolean;
}

/** A run of text carrying one style. */
export interface StyledSegment {
  readonly text: string;
  readonly style?: Style;
}

/** One screen line, before it becomes a string. */
export type StyledLine = readonly StyledSegment[];

/** What the terminal can render. */
export type ColorDepth = 'none' | 'ansi16' | 'ansi256';

export const RESET = '\x1b[0m';

/** Matches an SGR sequence — the only escape that ever appears inside a line. */
export const SGR_PATTERN = /\x1b\[[0-9;]*m/;

/** Global, sticky version of {@link SGR_PATTERN}. Callers must reset `lastIndex`. */
const SGR_GLOBAL = /\x1b\[[0-9;]*m/g;

export interface ColorEnvironment {
  readonly NO_COLOR?: string | undefined;
  readonly FORCE_COLOR?: string | undefined;
  readonly COLORTERM?: string | undefined;
  readonly TERM?: string | undefined;
  readonly WT_SESSION?: string | undefined;
  readonly TERM_PROGRAM?: string | undefined;
}

/**
 * Work out how much colour to use.
 *
 * `NO_COLOR` wins over everything except an explicit `FORCE_COLOR`, per
 * no-color.org: the variable being *present and non-empty* is the signal, not
 * its value. `isTty` is separate from the environment because a piped or
 * redirected run should not emit escapes even on a colour-capable terminal.
 */
export function detectColorDepth(env: ColorEnvironment, isTty: boolean): ColorDepth {
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== '') {
    if (force === '0' || force === 'false') return 'none';
    return force === '1' ? 'ansi16' : 'ansi256';
  }

  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none';
  if (!isTty) return 'none';

  const term = env.TERM ?? '';
  if (term === 'dumb') return 'none';

  const colorterm = env.COLORTERM ?? '';
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'ansi256';
  if (term.includes('256color') || term.includes('direct')) return 'ansi256';

  // Windows Terminal sets neither TERM nor COLORTERM but is fully capable, and
  // conhost has been 256-colour since Windows 10 1511. `WT_SESSION` is the only
  // reliable marker for the former.
  if (env.WT_SESSION !== undefined && env.WT_SESSION !== '') return 'ansi256';
  if (env.TERM_PROGRAM === 'Apple_Terminal' || env.TERM_PROGRAM === 'iTerm.app') return 'ansi256';

  if (term === '') return 'none';
  return 'ansi16';
}

/**
 * Render a style as an SGR sequence. Empty string when the style is empty or
 * colour is off and nothing non-colour remains.
 */
export function sgr(style: Style | undefined, depth: ColorDepth): string {
  if (!style) return '';

  const codes: number[] = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.reverse) codes.push(7);

  if (depth === 'ansi256') {
    if (style.fg !== undefined) codes.push(38, 5, style.fg);
    if (style.bg !== undefined) codes.push(48, 5, style.bg);
  } else if (depth === 'ansi16') {
    // 30–37 / 90–97 for foreground, 40–47 / 100–107 for background.
    if (style.fg !== undefined) codes.push(toAnsi16(style.fg, 30));
    if (style.bg !== undefined) codes.push(toAnsi16(style.bg, 40));
  }

  return codes.length === 0 ? '' : `\x1b[${codes.join(';')}m`;
}

/**
 * Approximate an xterm-256 index in the 16-colour space.
 *
 * The 6×6×6 cube (16–231) is reduced by thresholding each channel, and the
 * greyscale ramp (232–255) collapses to black / bright black / white / bright
 * white. Crude, but it only has to keep text legible on terminals that predate
 * the 256-colour palette.
 */
function toAnsi16(index: number, base: 30 | 40): number {
  if (index < 8) return base + index;
  if (index < 16) return base + 60 + (index - 8);

  if (index >= 232) {
    const level = index - 232; // 0..23
    if (level < 6) return base; // black
    if (level < 13) return base + 60; // bright black
    if (level < 20) return base + 7; // white
    return base + 60 + 7; // bright white
  }

  const cube = index - 16;
  const r = Math.floor(cube / 36);
  const g = Math.floor((cube % 36) / 6);
  const b = cube % 6;
  const bit = (channel: number): number => (channel >= 3 ? 1 : 0);
  const code = bit(r) + bit(g) * 2 + bit(b) * 4;
  const bright = Math.max(r, g, b) >= 4;
  return base + (bright ? 60 : 0) + code;
}

/**
 * Flatten a styled line into the string `screen.ts` will diff and write.
 *
 * Each segment is bracketed by its own SGR and a reset, never left open across
 * a boundary — see the note at the top of this file.
 */
export function renderStyledLine(line: StyledLine, depth: ColorDepth): string {
  let out = '';
  for (const segment of line) {
    if (segment.text === '') continue;
    const prefix = sgr(segment.style, depth);
    out += prefix === '' ? segment.text : prefix + segment.text + RESET;
  }
  return out;
}

/** Strip every SGR sequence, leaving what the user actually sees. */
export function stripAnsi(text: string): string {
  SGR_GLOBAL.lastIndex = 0;
  return text.replace(SGR_GLOBAL, '');
}

/** Convenience for a single unstyled segment. */
export function plain(text: string): StyledSegment {
  return { text };
}

/**
 * The palette, resolved for one terminal.
 *
 * Every role sets *both* foreground and background where it sets either, so the
 * result is legible whether the user's theme is light or dark. Highlighting
 * with a background alone is the classic terminal bug: dark grey behind the
 * theme's dark text is unreadable.
 */
export interface Theme {
  readonly depth: ColorDepth;
  /** Body text — deliberately unstyled, so the user's own foreground shows. */
  readonly text: Style;
  /** Inline verse numbers and the numbered-mode gutter. */
  readonly verseNumber: Style;
  /** Horizontal rules and other structural furniture. */
  readonly rule: Style;
  /** Footer hints, counts, anything secondary. */
  readonly muted: Style;
  /** The chapter title and other primary labels. */
  readonly title: Style;
  /** The active tab in the tab strip. */
  readonly tabActive: Style;
  readonly tabInactive: Style;
  /** The verse the cursor is on — a background, since it can start mid-line. */
  readonly cursorVerse: Style;
  /** Verse number of the cursor verse. */
  readonly cursorVerseNumber: Style;
  readonly wordsOfChrist: Style;
  /** Words the translators supplied — italic, as they are in a printed KJV. */
  readonly supplied: Style;
  /** Psalm titles and section headings. */
  readonly heading: Style;
  readonly error: Style;
  /** The `>` prompt on the input line. */
  readonly prompt: Style;
}

export function createTheme(depth: ColorDepth): Theme {
  if (depth === 'none') {
    return {
      depth,
      text: {},
      verseNumber: {},
      rule: {},
      muted: {},
      title: { bold: true },
      tabActive: { bold: true },
      tabInactive: {},
      // Reverse video is not colour, so it survives NO_COLOR — and it is the
      // only way left to mark a verse that begins in the middle of a line.
      cursorVerse: { reverse: true },
      cursorVerseNumber: { reverse: true },
      wordsOfChrist: {},
      supplied: { italic: true },
      heading: { italic: true },
      error: { bold: true },
      prompt: { bold: true },
    };
  }

  return {
    depth,
    text: {},
    verseNumber: { fg: 245 },
    rule: { fg: 239 },
    muted: { fg: 245 },
    title: { bold: true, fg: 254 },
    tabActive: { bold: true, fg: 81 },
    tabInactive: { fg: 245 },
    cursorVerse: { fg: 254, bg: 238 },
    cursorVerseNumber: { fg: 195, bg: 238, bold: true },
    wordsOfChrist: { fg: 174 },
    // Italic and *no colour*, on purpose. A word can be both supplied and
    // spoken by Christ, and the two styles are merged; a foreground here would
    // win the merge and quietly turn a red-letter word grey.
    supplied: { italic: true },
    heading: { italic: true, fg: 108 },
    error: { fg: 203, bold: true },
    prompt: { fg: 81, bold: true },
  };
}

/**
 * Merge two styles, with `over` winning field by field.
 *
 * Used where the cursor highlight has to sit *under* a word-level style: the
 * cursor verse supplies the background, words of Christ the foreground, and
 * neither should erase the other.
 */
export function mergeStyle(under: Style | undefined, over: Style | undefined): Style {
  if (!under) return over ?? {};
  if (!over) return under;
  return { ...under, ...stripUndefined(over) };
}

function stripUndefined(style: Style): Style {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Style;
}
