/**
 * Text layout and column width.
 *
 * Everything the renderer draws has to be padded to an exact column count, and
 * `String.length` is the wrong number in three separate ways. It counts UTF-16
 * code units, so an astral character counts twice. It counts combining marks —
 * Hebrew vowel points, Greek breathings that did not precompose — as occupying
 * a column when they occupy none. And it counts a CJK ideograph as one column
 * when terminals draw it in two.
 *
 * Counting code points after NFC normalisation would be exactly right for
 * precomposed Greek and wrong for everything else. This is the general
 * version, and the render-width assertion in `padTo` catches a row that is
 * silently too wide.
 *
 * ## What is deliberately not attempted
 *
 * **Bidirectional reordering.** Hebrew is stored in logical order and drawn
 * right-to-left by the *terminal emulator*, not by this code, and emulators
 * disagree about where the cursor ends up afterwards. Measuring the width of a
 * Hebrew run is well-defined and done here; deciding which column each glyph
 * lands in is not, and guessing would produce alignment that is wrong in a
 * different way on every terminal. Any screen that needs an answer should
 * settle it against real terminal output rather than in advance.
 */

import type { Style, StyledLine, StyledSegment } from './style';

/**
 * Characters that occupy no column: non-spacing marks (`Mn`), enclosing marks
 * (`Me`), and format characters (`Cf`, which covers the zero-width space, the
 * joiners, and the bidi controls).
 *
 * Taken from the engine's own Unicode tables rather than a hand-maintained
 * range list, so it is exact and cannot drift out of date.
 */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

/**
 * East Asian Wide and Fullwidth ranges, which terminals draw in two columns.
 *
 * This one *is* a table, because JavaScript exposes no East_Asian_Width
 * property. The ranges below are the standard consolidated set.
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2329, 0x232a],
  [0x2e80, 0x303e], // CJK radicals, Kangxi, punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, compatibility
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd], // CJK extension B and beyond
  [0x30000, 0x3fffd],
];

/** Display width of a single character, in terminal columns. */
export function charWidth(char: string): 0 | 1 | 2 {
  const code = char.codePointAt(0);
  if (code === undefined) return 0;

  // C0/C1 controls draw nothing. A tab is handled by the caller (it has no
  // intrinsic width — it depends on the column it starts from).
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;

  if (ZERO_WIDTH.test(char)) return 0;

  for (const [low, high] of WIDE_RANGES) {
    if (code >= low && code <= high) return 2;
    if (code < low) break; // ranges are sorted
  }

  return 1;
}

/**
 * Display width of a string, in terminal columns.
 *
 * Normalised to NFC first, so that text stored decomposed measures the same as
 * the equivalent precomposed text — otherwise the same verse could occupy
 * different widths depending on which module it came from.
 */
export function stringWidth(text: string): number {
  let width = 0;
  for (const char of text.normalize('NFC')) width += charWidth(char);
  return width;
}

/**
 * Pad to an exact column count.
 *
 * Throws on overflow rather than returning a too-long string. A row that is
 * one column too wide does not look like an error — it looks like the box
 * drawing is broken three rows further down, which is far harder to trace back.
 */
export function padTo(text: string, width: number): string {
  const actual = stringWidth(text);
  if (actual > width) {
    throw new RangeError(`text occupies ${actual} columns, exceeding ${width}: ${JSON.stringify(text)}`);
  }
  return text + ' '.repeat(width - actual);
}

/** Cut a string to at most `width` columns, never splitting a character. */
export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return '';

  let out = '';
  let used = 0;
  for (const char of text.normalize('NFC')) {
    const w = charWidth(char);
    if (used + w > width) break;
    out += char;
    used += w;
  }
  return out;
}

/** Cut to `width`, appending an ellipsis when anything was removed. */
export function ellipsize(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  if (width <= 1) return truncateToWidth(text, width);
  return `${truncateToWidth(text, width - 1)}…`;
}

export interface WrapOptions {
  /** Total column width available. */
  readonly width: number;
  /** Columns of indent on the first line. */
  readonly firstIndent?: number;
  /** Columns of indent on every line after the first — the hanging indent. */
  readonly hangingIndent?: number;
}

/**
 * The unit of wrapping: a group of segments that must not be split.
 *
 * Usually one word. It is a *group* because the reader glues a verse number to
 * the word after it — `¹⁶For` is two segments with different styles and one
 * break opportunity, and treating them as separate words would let a line end
 * on a lone superscript.
 */
export interface LayoutToken {
  readonly segments: StyledLine;
  /** Display width, precomputed by {@link makeToken}. */
  readonly width: number;
  /**
   * Opaque tag naming where this token came from — the reader uses the verse
   * number. Reported as {@link WrappedLine.group} for every line the token lands
   * on, which is what lets a screen map a screen row back to a verse without
   * re-deriving the layout.
   */
  readonly group?: number;
  /**
   * Style for the space that follows this token, used only when the next token
   * shares its `group`. Without it a highlighted verse draws as separately lit
   * words with unlit gaps between them.
   */
  readonly gapStyle?: Style;
}

export interface WrappedLine {
  readonly segments: StyledLine;
  /** The `group` of the first grouped token on the line, if any. */
  readonly group: number | undefined;
}

/** Optional fields shared by the token constructors. */
export interface TokenOptions {
  readonly group?: number;
  readonly gapStyle?: Style;
}

export function makeToken(segments: StyledLine, options: TokenOptions = {}): LayoutToken {
  return {
    segments,
    width: lineWidth(segments),
    ...(options.group === undefined ? {} : { group: options.group }),
    ...(options.gapStyle === undefined ? {} : { gapStyle: options.gapStyle }),
  };
}

/**
 * Split plain text into one token per whitespace-separated word.
 *
 * `gapStyle` defaults to the run's own style, which is what lets the wrapper
 * coalesce a whole styled run into a single segment: without it, every
 * separator space is an unstyled segment and a five-word run costs five SGR
 * pairs instead of one.
 */
export function tokenizeText(
  text: string,
  options: TokenOptions & { style?: Style } = {},
): LayoutToken[] {
  const { style, ...tokenOptions } = options;
  const gapStyle = tokenOptions.gapStyle ?? style;
  return text
    .normalize('NFC')
    .split(/\s+/u)
    .filter((word) => word !== '')
    .map((word) =>
      makeToken([{ text: word, ...(style === undefined ? {} : { style }) }], {
        ...tokenOptions,
        ...(gapStyle === undefined ? {} : { gapStyle }),
      }),
    );
}

/**
 * Wrap tokens to a column width, separating them with single spaces.
 *
 * This is the one wrapping implementation; `wrapText` and `wrapRuns` are
 * conveniences over it. A token wider than the available width is broken by
 * *width* rather than by character count, so a run of CJK cannot overshoot the
 * frame by one column per character.
 */
export function wrapTokens(tokens: readonly LayoutToken[], options: WrapOptions): WrappedLine[] {
  const { width, firstIndent = 0, hangingIndent = 0 } = options;
  if (width <= 0) return [];

  const lines: WrappedLine[] = [];
  let indent = firstIndent;
  let current: StyledSegment[] = [];
  let group: number | undefined;
  let used = 0;

  const available = (): number => Math.max(1, width - indent);

  const emit = (segment: StyledSegment): void => {
    if (segment.text === '') return;
    const last = current[current.length - 1];
    if (last !== undefined && last.style === segment.style) {
      current[current.length - 1] = { ...last, text: last.text + segment.text };
    } else {
      current.push(segment);
    }
  };

  const flush = (): void => {
    const prefix: StyledSegment[] = indent > 0 ? [{ text: ' '.repeat(indent) }] : [];
    lines.push({ segments: [...prefix, ...current], group });
    indent = hangingIndent;
    current = [];
    group = undefined;
    used = 0;
  };

  let previous: LayoutToken | undefined;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;

    // The separator is part of the fit decision, not an afterthought. Deciding
    // the token fits and *then* discovering there is no room for the space in
    // front of it leaves the two words touching — `Plead` `my` rendered as
    // `Pleadmy` at exactly the wrap column, which is a wrong word rather than a
    // cosmetic slip.
    if (used > 0) {
      if (used + 1 + token.width > available()) {
        flush();
      } else {
        // Styled only *within* a group. At a group boundary — the join between
        // two verses — an unstyled space is what stops one verse's highlight
        // from bleeding into the next one's number.
        // Two ungrouped tokens count as the same group, which is what lets
        // `wrapRuns` coalesce a styled run into one segment instead of one
        // per word.
        const sameGroup = previous?.group === token.group;
        emit({
          text: ' ',
          ...(sameGroup && previous?.gapStyle !== undefined ? { style: previous.gapStyle } : {}),
        });
        used += 1;
      }
    }

    previous = token;
    if (group === undefined) group = token.group;

    if (token.width > available()) {
      placeOverWide(token, {
        available,
        emit,
        flush,
        used: () => used,
        setUsed: (value) => {
          used = value;
        },
        restoreGroup: () => {
          if (group === undefined) group = token.group;
        },
      });
    } else {
      for (const segment of token.segments) emit(segment);
      used += token.width;
    }
  }

  if (current.length > 0 || lines.length === 0) flush();

  return lines;
}

/** The slice of `wrapTokens`'s state that {@link placeOverWide} needs. */
interface OverWideContext {
  available(): number;
  emit(segment: StyledSegment): void;
  flush(): void;
  used(): number;
  setUsed(value: number): void;
  restoreGroup(): void;
}

/**
 * Lay out a token that is wider than a whole line, breaking it by display width.
 *
 * A single character wider than the entire line is emitted on its own rather
 * than retried, which is what stops a one-column frame from looping forever.
 */
function placeOverWide(token: LayoutToken, ctx: OverWideContext): void {
  for (const segment of token.segments) {
    let remainder = segment.text;
    while (remainder !== '') {
      const room = ctx.available() - ctx.used();
      const head = room > 0 ? truncateToWidth(remainder, room) : '';

      if (head === '') {
        if (ctx.used() > 0) {
          ctx.flush();
          ctx.restoreGroup();
          continue;
        }
        const first = String.fromCodePoint(remainder.codePointAt(0)!);
        ctx.emit({ ...segment, text: first });
        ctx.setUsed(ctx.used() + stringWidth(first));
        remainder = remainder.slice(first.length);
        continue;
      }

      ctx.emit({ ...segment, text: head });
      ctx.setUsed(ctx.used() + stringWidth(head));
      remainder = remainder.slice(head.length);
    }
  }
}

/**
 * Wrap to a column width, breaking on spaces.
 *
 * A word longer than the available width is broken by *width*, not by character
 * count, so a run of CJK cannot overshoot the frame.
 */
export function wrapText(text: string, options: WrapOptions): string[] {
  return wrapTokens(tokenizeText(text), options).map((line) =>
    line.segments.map((segment) => segment.text).join(''),
  );
}

/**
 * The styled form of {@link wrapText}: each run keeps its style across whatever
 * line breaks the wrap chooses.
 */
export function wrapRuns(runs: readonly StyledSegment[], options: WrapOptions): StyledLine[] {
  const tokens = runs.flatMap((run) =>
    tokenizeText(run.text, run.style === undefined ? {} : { style: run.style }),
  );
  return wrapTokens(tokens, options).map((line) => line.segments);
}

/** Total display width of a styled line, ignoring the escapes it will emit. */
export function lineWidth(line: StyledLine): number {
  let total = 0;
  for (const segment of line) total += stringWidth(segment.text);
  return total;
}

/**
 * Pad a styled line out to `width` with unstyled spaces.
 *
 * Deliberately *unstyled*: padding inside the last segment would extend that
 * segment's background to the right margin, which turns a highlighted verse
 * into a full-width bar.
 */
export function padLineTo(line: StyledLine, width: number): StyledLine {
  const short = width - lineWidth(line);
  return short > 0 ? [...line, { text: ' '.repeat(short) }] : line;
}

/** Cut a styled line to `width`, dropping whole segments then part of one. */
export function truncateLineToWidth(line: StyledLine, width: number): StyledLine {
  const out: StyledSegment[] = [];
  let used = 0;
  for (const segment of line) {
    const segmentWidth = stringWidth(segment.text);
    if (used + segmentWidth <= width) {
      out.push(segment);
      used += segmentWidth;
      continue;
    }
    const head = truncateToWidth(segment.text, width - used);
    if (head !== '') out.push({ ...segment, text: head });
    break;
  }
  return out;
}

/**
 * The scroll offset that keeps row `cursorRow` inside a `window`-row view.
 *
 * A plain scroll clamp, kept beside the rest of this file's geometry rather
 * than inside a screen. `screens/Modules.ts` is its only caller.
 */
export function keepVisible(offset: number, cursorRow: number, window: number): number {
  if (cursorRow < offset) return cursorRow;
  if (cursorRow >= offset + window) return cursorRow - window + 1;
  return Math.max(0, offset);
}
