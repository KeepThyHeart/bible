/**
 * The two reading modes.
 *
 * Plain strings cannot carry the two things the reader needs from a laid-out
 * chapter:
 *
 * - **Which verse each line belongs to.** Scrolling has to keep the cursor
 *   verse on screen, and `↑` / `↓` move by verse rather than by line, so a row
 *   has to be traceable back to a verse. Re-deriving that by re-wrapping is
 *   both slow and a second implementation that can disagree with the first.
 * - **Style that survives a line break.** Words of Christ, supplied words and
 *   the cursor highlight all routinely straddle a wrap point.
 *
 * Both are solved by wrapping *tokens* rather than text — see
 * `layout.ts`'s `wrapTokens`.
 */
import type { DisplayVerse } from '../app/verseText';
import {
  makeToken,
  tokenizeText,
  wrapTokens,
  type LayoutToken,
} from './layout';
import { mergeStyle, type Style, type StyledLine, type StyledSegment, type Theme } from './style';

export type ReadingMode = 'paragraph' | 'numbered';

/**
 * Where a verse number goes, and what it looks like.
 *
 * Independent of {@link ReadingMode}: the mode decides how the *text* flows, this
 * decides how the *number* is drawn, and both modes honour all four values. They
 * are separate settings because they answer separate complaints — "I want one
 * verse per block" and "my font has no superscripts" are not the same request.
 *
 * - `superscript` — `¹⁶For God so loved…`. The default.
 * - `margin` — plain digits, right-aligned in a gutter with the text hanging
 *   beside it.
 * - `inline` — `(16) For God so loved…`, for a font that draws tofu instead of
 *   superscripts. That is a real problem with no terminal-side fix other than
 *   not using them.
 * - `hidden` — no number at all, and no gutter reserved for one. Numbered mode
 *   still puts each verse in its own block, so the verses stay distinguishable.
 *
 * The two modes cannot both honour all four distinctly, and pretending otherwise
 * would mean inventing renderings nobody asked for. Where a value has no meaning
 * in a mode it falls back to the nearest one that does, and the fallback is the
 * same request read in context rather than a value being ignored:
 *
 * - In **paragraph** mode there is no margin, so `margin` draws the superscript.
 * - In **numbered** mode the number is *already* in a margin, so `superscript`
 *   and `inline` both draw the plain-digit gutter. The only question left there
 *   is whether to show the number, which `hidden` answers.
 */
export type VerseNumberStyle = 'superscript' | 'margin' | 'inline' | 'hidden';

export interface ReadingOptions {
  readonly width: number;
  readonly mode: ReadingMode;
  readonly theme: Theme;
  /** Verse number the cursor sits on, or 0 for none. */
  readonly cursorVerse: number;
  /** Columns of gutter in numbered mode. Defaults to 4 — room for `119 `. */
  readonly numberWidth?: number;
  /** Defaults to `superscript`, which is what every caller wanted before this existed. */
  readonly verseNumbers?: VerseNumberStyle;
  /**
   * A blank line between every verse, on top of the module's own paragraph
   * breaks.
   *
   * Defaults to false. Vertical space is the scarcest thing in a terminal, and
   * a blank per verse spends half the window on nothing — but it is the only way
   * to see verse boundaries without leaving prose, so it is offered.
   */
  readonly breakOnVerse?: boolean;
}

export interface ReadingLine {
  readonly segments: StyledLine;
  /** The verse this row belongs to; `undefined` for blank rows and headings. */
  readonly verse: number | undefined;
}

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'] as const;

/**
 * Verse numbers as Unicode superscripts.
 *
 * Every one of these is BMP and East Asian Neutral, so `stringWidth` gives them
 * one column each and the frame arithmetic is unaffected. A font without them
 * draws tofu; that is a font problem with no terminal-side fix — which is what
 * `inline` in {@link VerseNumberStyle} exists to answer.
 */
export function superscript(value: number): string {
  return String(value)
    .split('')
    .map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join('');
}

/**
 * The number as it appears at the head of a verse in running prose.
 *
 * Empty when it is hidden, and the caller must then not emit a segment at all:
 * an empty segment is not nothing, it is a style change with no text, and
 * `wrapTokens` coalesces by style identity so it would split a run for no reason.
 */
function inlineNumber(verse: number, style: VerseNumberStyle): string {
  switch (style) {
    case 'hidden':
      return '';
    case 'inline':
      return `(${verse}) `;
    // Prose has no margin, so a request for one is a request for the superscript.
    case 'margin':
    case 'superscript':
      return superscript(verse);
  }
}

/**
 * The gutter label in numbered mode, right-aligned in `gutter` columns.
 *
 * Plain digits for every style but `hidden`, which the caller handles by asking
 * for no gutter at all. That is not a shortcut: **numbered mode already *is* the
 * margin style**, so the only question the setting can answer here is whether to
 * show the number. Superscripts in a gutter would be smaller for no gain, and
 * parentheses exist to separate a number from words beside it — nothing needs
 * separating in a column of its own.
 */
function gutterNumber(verse: number, gutter: number): string {
  return `${String(verse).padStart(Math.max(0, gutter - 1))} `;
}

export function layoutReading(
  verses: readonly DisplayVerse[],
  options: ReadingOptions,
): ReadingLine[] {
  return options.mode === 'numbered' ? layoutNumbered(verses, options) : layoutParagraph(verses, options);
}

/**
 * **Paragraph mode** — verses run together into prose with superscript numbers
 * inline, and a blank line only where the module's own formatting says a
 * paragraph begins.
 *
 * The blank lines come from `formatting.block.paragraph_start` (2,970 of them
 * across the bundled KJV), not from a fixed one-per-verse rule: in a terminal,
 * vertical space is the scarcest thing there is, and inventing double spacing
 * spends it on nothing.
 */
function layoutParagraph(
  verses: readonly DisplayVerse[],
  options: ReadingOptions,
): ReadingLine[] {
  const lines: ReadingLine[] = [];
  const highlight = highlighter(options);
  let paragraph: LayoutToken[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    for (const line of wrapTokens(paragraph, { width: options.width })) {
      lines.push({ segments: line.segments, verse: line.group });
    }
    paragraph = [];
  };

  const numbering = options.verseNumbers ?? 'superscript';

  for (const verse of verses) {
    if (verse.heading !== undefined && verse.heading !== '') {
      flush();
      if (lines.length > 0) lines.push(BLANK);
      lines.push(...headingLines(verse.heading, options));
    } else if ((verse.paragraphStart || options.breakOnVerse === true) && paragraph.length > 0) {
      // The module's own paragraph breaks, plus one per verse when it is asked
      // for. Ending the paragraph is what makes the break: pushing a blank row
      // without flushing would put it *inside* a paragraph still being wrapped.
      flush();
      lines.push(BLANK);
    }

    const style = highlight(verse.verse);
    const label = inlineNumber(verse.verse, numbering);
    // Nothing at all when the number is hidden, rather than an empty segment: an
    // empty segment is a style change with no text, and `wrapTokens` coalesces by
    // style identity, so it would break a run of words in two for no reason.
    const number: StyledSegment[] = label === '' ? [] : [{ text: label, style: style.number }];

    const words = verseTokens(verse, verse.verse, style);
    if (words.length === 0) {
      // A verse with no text still has to appear, or the row-to-verse mapping
      // skips it and the cursor cannot land there. With the number hidden there
      // is genuinely nothing to draw, and the group label goes on a blank token.
      paragraph.push(makeToken(number, { group: verse.verse }));
      continue;
    }

    // The number is glued to the first word: a line must never end on a lone
    // superscript with its verse starting on the next one.
    const [first, ...rest] = words;
    paragraph.push(
      makeToken([...number, ...first!.segments], {
        group: verse.verse,
        ...(first!.gapStyle === undefined ? {} : { gapStyle: first!.gapStyle }),
      }),
      ...rest,
    );
  }

  flush();
  return lines;
}

/**
 * **Numbered mode** (`¶` toggles) — one block per verse, the number in a left
 * gutter and the text hanging beside it. Denser to scan, and the right shape
 * for selection work.
 */
function layoutNumbered(
  verses: readonly DisplayVerse[],
  options: ReadingOptions,
): ReadingLine[] {
  const numbering = options.verseNumbers ?? 'superscript';
  // A hidden number reserves no gutter. Each verse still begins its own block, so
  // the verses stay distinguishable; keeping an empty gutter would indent the
  // whole chapter to make room for something that is not being drawn.
  const gutter = numbering === 'hidden' ? 0 : (options.numberWidth ?? 4);
  const lines: ReadingLine[] = [];
  const highlight = highlighter(options);

  for (const verse of verses) {
    if (verse.heading !== undefined && verse.heading !== '') {
      if (lines.length > 0) lines.push(BLANK);
      lines.push(...headingLines(verse.heading, options));
    } else if (options.breakOnVerse === true && lines.length > 0) {
      lines.push(BLANK);
    }

    const style = highlight(verse.verse);
    const wrapped = wrapTokens(verseTokens(verse, verse.verse, style), {
      width: options.width,
      firstIndent: gutter,
      hangingIndent: gutter,
    });

    const label: StyledSegment = {
      text: gutterNumber(verse.verse, gutter),
      style: style.number,
    };

    wrapped.forEach((line, index) => {
      // `wrapTokens` puts the indent in its own leading segment, so the first
      // row's indent is replaced by the label rather than drawn over. With no
      // gutter there is no indent segment to replace, and the row stands as it is.
      const segments =
        index === 0 && gutter > 0 ? [label, ...line.segments.slice(1)] : line.segments;
      lines.push({ segments, verse: verse.verse });
    });
  }

  return lines;
}

const BLANK: ReadingLine = { segments: [], verse: undefined };

/** Styles that apply to one verse, given whether the cursor is on it. */
interface VerseStyles {
  readonly number: Style;
  /** Applied under each word's own style, so the highlight does not erase red letter. */
  under: (base: Style | undefined) => Style | undefined;
}

/**
 * Build the per-verse style resolver.
 *
 * Merged styles are fresh objects, and `wrapTokens` coalesces adjacent segments
 * by style *identity*, so the merge is memoised per base style. Without that,
 * a highlighted verse emits one SGR pair per word instead of one per style
 * change — several hundred wasted bytes on every cursor move.
 */
function highlighter(options: ReadingOptions): (verse: number) => VerseStyles {
  const { theme, cursorVerse } = options;
  const merged = new Map<Style | undefined, Style>();

  const plainStyles: VerseStyles = {
    number: theme.verseNumber,
    under: (base) => base,
  };

  const cursorStyles: VerseStyles = {
    number: theme.cursorVerseNumber,
    under: (base) => {
      const cached = merged.get(base);
      if (cached !== undefined) return cached;
      const style = mergeStyle(theme.cursorVerse, base);
      merged.set(base, style);
      return style;
    },
  };

  return (verse) => (verse === cursorVerse ? cursorStyles : plainStyles);
}

function verseTokens(verse: DisplayVerse, group: number, style: VerseStyles): LayoutToken[] {
  return verse.runs.flatMap((run) => {
    // The resolved style doubles as the gap style, so the spaces inside a
    // highlighted verse are lit too. A highlight drawn only under the words is
    // a row of separately lit boxes, not a lit verse.
    const resolved = style.under(run.style);
    return tokenizeText(run.text, {
      group,
      ...(resolved === undefined ? {} : { style: resolved }),
    });
  });
}

/**
 * A psalm title or section heading, above the verse it belongs to.
 *
 * 138 verses in the bundled KJV carry one — every one of them a psalm
 * superscription such as "A Psalm of David, when he fled from Absalom his son."
 */
function headingLines(heading: string, options: ReadingOptions): ReadingLine[] {
  return wrapTokens(tokenizeText(heading, { style: options.theme.heading }), {
    width: options.width,
  }).map((line) => ({ segments: line.segments, verse: undefined }));
}

/**
 * The scroll offset that keeps a verse on screen, moving as little as possible.
 *
 * The rule is "move only if you must": an offset already showing the verse is
 * returned unchanged, so scrolling with `alt+↑↓` and then moving the cursor does
 * not snap the page back to where it was.
 */
export function clampScroll(
  lines: readonly ReadingLine[],
  verse: number,
  offset: number,
  window: number,
): number {
  const maxOffset = Math.max(0, lines.length - window);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.verse !== verse) continue;
    if (start === -1) start = i;
    end = i;
  }
  if (start === -1) return Math.min(Math.max(0, offset), maxOffset);

  let next = Math.min(Math.max(0, offset), maxOffset);
  if (end >= next + window) next = Math.min(end - window + 1, maxOffset);
  if (start < next) next = start;
  return Math.min(Math.max(0, next), maxOffset);
}
