/**
 * Markdown commentary entries → the blocks the commentary layout already wraps.
 *
 * Most commentary modules store an entry as HTML, and the commentary screen
 * parses that HTML into blocks. A minority store Markdown instead, and on that
 * path the HTML parser matches no tag at all: the whole entry arrives as one
 * unbroken paragraph carrying literal `##` and `**` where its structure should
 * have been. This module is the second parser for that case, emitting the same
 * block shape so everything downstream — wrapping, hanging indents, styling —
 * is untouched.
 *
 * ## Why the decision is per entry, not per module
 *
 * A module is a bag of rows written over years, sometimes by a converter that
 * changed its mind. The same module can hold an HTML entry on one verse and a
 * Markdown entry on the next, so there is nothing at module level to declare.
 * {@link looksLikeMarkdown} therefore judges one string, and the caller asks it
 * again for every entry it draws.
 *
 * ## What the detection deliberately refuses
 *
 * The cost of a false positive is worse than the cost of a false negative: a
 * missed Markdown entry renders as it does today, whereas prose mistaken for
 * Markdown loses characters the author wrote. So every signal is anchored and
 * both of its ends are checked:
 *
 * - **An HTML tag anywhere disqualifies the whole entry**, using the same
 *   allow-list of tag names core uses to decide whether a dictionary definition
 *   is HTML — an allow-list rather than `<[^>]*>` because commentary prose
 *   contains bare angle brackets ("2 < 3") far more often than it contains a
 *   tag. The SWORD-era `<!P>` paragraph markers and `<sc>` are checked
 *   alongside it: they are not in core's list, and in these modules `<!P>` is
 *   one of the commonest markers there is, so an entry carrying nothing else
 *   would otherwise be handed to the wrong parser.
 * - **List and heading markers must start a line**, so an asterisk used as a
 *   footnote mark or a multiplication sign mid-sentence is not a bullet, and a
 *   marker must be followed by a space and then something non-blank, so
 *   `self-evident`, `well-known` and a bare `---` are not list items either.
 * - **`**bold**` must open and close on one line** with non-blank text against
 *   both markers, so `2 ** 3` and a lone `**` are not emphasis.
 *
 * Two judgement calls remain, both chosen knowingly:
 *
 * - A single line opening with `- ` or `* ` is read as a list even when the
 *   author meant a dash. That renders as one bullet, which is a small loss next
 *   to failing to detect a real one-item list.
 * - `3**2 and 4**5` in one line reads as emphasis. Exponent notation in a
 *   commentary is rare enough to accept, and the fallout is a bold stretch of
 *   text rather than missing characters.
 *
 * ## How the constructs are styled
 *
 * The theme has no Markdown roles, so each construct borrows the role the HTML
 * path already uses for the thing it means, and nothing invents a colour:
 *
 * - **Headings** take `theme.heading`, the role the reader gives a section
 *   heading, and the top two levels add bold on top of it so a title is
 *   distinguishable from the subheadings under it.
 * - **`*italic*` is `theme.supplied`** — italic and deliberately colourless,
 *   exactly as `<i>` is treated in an HTML entry.
 * - **`**bold**` is bold**, an attribute rather than a colour, so it survives a
 *   `NO_COLOR` terminal.
 * - **`` `code` `` is underlined**, because bold and italic are spoken for and
 *   underline is the last attribute a colourless terminal has left.
 * - **List items get the `•` and the two-column indent** the HTML path gives
 *   `<li>`, so a Markdown list and an HTML list look like the same list.
 */
import { decodeHtmlEntities, definitionHasHtmlMarkup } from '@bible/core';

import { makeToken, type LayoutToken } from './layout';
import type { Style, StyledSegment, Theme } from './style';

/**
 * One paragraph, list item or heading, ready for `wrapTokens`.
 *
 * Structurally identical to the block the commentary screen builds from HTML,
 * and separate only because that one is private to the screen. The two are
 * meant to be one declaration.
 */
export interface Block {
  readonly tokens: LayoutToken[];
  /** Columns the block is inset by. Two for a list item, none for prose. */
  readonly indent: number;
  /** Whether the first token is a list marker, which a wrapped line hangs past. */
  readonly bullet: boolean;
}

/** Markup the tag allow-list in core does not know, but these modules use. */
const SWORD_MARKUP = /<!\/?p>|<\/?sc\b[^>]*>/i;

/**
 * The per-line signals, applied one line at a time rather than with the `m`
 * flag so that detection and parsing cannot disagree about what a line is.
 */
const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/u;
const BULLET_ITEM = /^( {0,12})([*-])[ \t]+(\S.*)$/u;
/** `1.` and `1)` both, since a converter picks one and stays with it. */
const ORDERED_ITEM = /^( {0,12})(\d{1,9}[.)])[ \t]+(\S.*)$/u;

/** `**bold**`, closing on the line it opened, with text against both markers. */
const STRONG_RUN = /\*\*(?=\S)[^\n]*?\S\*\*/u;

const NEWLINE = /\r?\n/u;

/** Punctuation a backslash may hide, per Markdown's own escapable set. */
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>|~]/u;

/**
 * Is this entry Markdown rather than HTML?
 *
 * See the header for what each signal refuses and why the answer is per entry.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (text === '') return false;
  if (definitionHasHtmlMarkup(text) || SWORD_MARKUP.test(text)) return false;
  if (STRONG_RUN.test(text)) return true;

  return text
    .split(NEWLINE)
    .some(
      (line) => ATX_HEADING.test(line) || BULLET_ITEM.test(line) || ORDERED_ITEM.test(line),
    );
}

/** A block being accumulated, before its text becomes tokens. */
interface PendingBlock {
  readonly indent: number;
  readonly bullet: boolean;
  /** The list marker to draw, if this block is a list item. */
  readonly marker: string | undefined;
  /** Style every word inherits — a heading's, or nothing for body text. */
  readonly base: Style | undefined;
  readonly lines: string[];
}

/**
 * Markdown → blocks.
 *
 * Structure is decided line by line and emphasis is decided over the finished
 * paragraph, which is what lets a `**bold**` span survive a line break the
 * author happened to type in the middle of it. A line that is neither blank nor
 * a marker continues whatever block is open, so a wrapped list item stays part
 * of its item rather than becoming a paragraph of its own.
 */
export function parseMarkdownBlocks(text: string, theme: Theme): Block[] {
  const blocks: Block[] = [];
  let pending: PendingBlock | undefined;

  const flush = (): void => {
    if (pending === undefined) return;
    const tokens: LayoutToken[] = [];
    if (pending.marker !== undefined) tokens.push(makeToken([{ text: pending.marker }]));
    tokens.push(...inlineTokens(pending.lines.join('\n'), pending.base, theme));
    if (tokens.length > 0) {
      blocks.push({ tokens, indent: pending.indent, bullet: pending.bullet });
    }
    pending = undefined;
  };

  for (const line of text.split(NEWLINE)) {
    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      flush();
      pending = {
        indent: 0,
        bullet: false,
        marker: undefined,
        base: headingStyle(heading[1]?.length ?? 1, theme),
        lines: [stripClosingHashes(heading[2] ?? '')],
      };
      // A heading is a block on its own: what follows it is the text it heads,
      // not more of the heading.
      flush();
      continue;
    }

    const item = BULLET_ITEM.exec(line) ?? ORDERED_ITEM.exec(line);
    if (item !== null) {
      flush();
      const leading = (item[1] ?? '').length;
      const marker = item[2] ?? '';
      pending = {
        // Two columns per nesting level, from the author's own indentation, and
        // capped so a runaway indent cannot push the text off a narrow screen.
        indent: 2 + 2 * Math.min(3, Math.floor(leading / 2)),
        bullet: true,
        marker: marker === '*' || marker === '-' ? '•' : marker,
        base: undefined,
        lines: [item[3] ?? ''],
      };
      continue;
    }

    if (pending === undefined) {
      pending = { indent: 0, bullet: false, marker: undefined, base: undefined, lines: [] };
    }
    pending.lines.push(line.trim());
  }
  flush();

  return blocks;
}

/**
 * A heading's style by level.
 *
 * `theme.heading` alone would render all six levels identically, which loses
 * the only thing the extra hashes were saying. Bold on the top two levels is
 * the distinction a terminal can actually draw; below that the hierarchy is
 * carried by the text, as it is in print.
 */
function headingStyle(level: number, theme: Theme): Style {
  return level <= 2 ? { ...theme.heading, bold: true } : theme.heading;
}

/** `## Verse 16 ##` → `Verse 16`. The closing run is decoration, not text. */
function stripClosingHashes(content: string): string {
  return content.replace(/[ \t]+#+[ \t]*$/u, '');
}

/** The emphasis delimiters, which differ in where they are allowed to open. */
type Emphasis = '*' | '_';

/**
 * Inline markers → one token per word.
 *
 * The unit that must not be split is the word, not the styled run: `**word**,`
 * has a style change inside a word, and tokenising each run separately would
 * put a space before the comma the author never wrote. This is the same reason
 * the HTML path builds tokens rather than runs.
 *
 * A marker only takes effect when its partner is actually there. Everything
 * else falls through to literal text, so an entry that merely mentions an
 * asterisk still shows the asterisk.
 */
function inlineTokens(text: string, base: Style | undefined, theme: Theme): LayoutToken[] {
  const tokens: LayoutToken[] = [];

  /** The word being built, which may span several styled segments. */
  let word: StyledSegment[] = [];
  let emphasis: Emphasis | undefined;
  let bold = false;
  let code = false;

  /** Literal text since the last marker, still to be emitted at that style. */
  let literal = '';

  const endWord = (): void => {
    if (word.length === 0) return;
    tokens.push(makeToken(word));
    word = [];
  };

  const flushLiteral = (): void => {
    if (literal === '') return;
    const style = styleFor(base, emphasis !== undefined, bold, code, theme);

    // Whitespace ends a word and is then discarded: `wrapTokens` puts the
    // separators back one space wide, which normalises the author's own line
    // breaks and double spaces. Entities are decoded here rather than up front,
    // so a decoded `&#42;` cannot be mistaken for a marker the author never
    // typed.
    for (const piece of decodeHtmlEntities(literal).split(/(\s+)/u)) {
      if (piece === '') continue;
      if (/^\s+$/u.test(piece)) {
        endWord();
        continue;
      }
      word.push(style === undefined ? { text: piece } : { text: piece, style });
    }
    literal = '';
  };

  for (let i = 0; i < text.length; ) {
    const char = text[i] ?? '';

    // Inside code, nothing is a marker except the backtick that ends it.
    if (code) {
      if (char === '`') {
        flushLiteral();
        code = false;
      } else {
        literal += char;
      }
      i += 1;
      continue;
    }

    const next = text[i + 1] ?? '';

    if (char === '\\' && ESCAPABLE.test(next)) {
      literal += next;
      i += 2;
      continue;
    }

    if (char === '`' && text.includes('`', i + 1)) {
      flushLiteral();
      code = true;
      i += 1;
      continue;
    }

    if (char === '*' && next === '*') {
      if (bold) {
        flushLiteral();
        bold = false;
      } else if (canOpen(text, i, '**')) {
        flushLiteral();
        bold = true;
      } else {
        literal += '**';
      }
      i += 2;
      continue;
    }

    if (char === '*' || char === '_') {
      if (emphasis === char && isCloser(text, i, char)) {
        flushLiteral();
        emphasis = undefined;
      } else if (emphasis === undefined && canOpen(text, i, char)) {
        flushLiteral();
        emphasis = char;
      } else {
        literal += char;
      }
      i += 1;
      continue;
    }

    literal += char;
    i += 1;
  }

  flushLiteral();
  endWord();

  return tokens;
}

/**
 * May a delimiter at `i` open a span?
 *
 * Only with text hard against it and a partner further on — an opener whose
 * closer never arrives is not a delimiter at all, it is the character the
 * author typed. `_` additionally may not open inside a word, so an identifier
 * or a transliteration with underscores in it survives intact.
 */
function canOpen(text: string, i: number, marker: Emphasis | '**'): boolean {
  const after = text[i + marker.length] ?? '';
  if (after === '' || /\s/u.test(after)) return false;
  if (marker === '_' && /[\p{L}\p{N}]/u.test(text[i - 1] ?? '')) return false;
  return findCloser(text, i + marker.length, marker) !== -1;
}

/** Is the delimiter at `i` able to close a span opened earlier? */
function isCloser(text: string, i: number, marker: Emphasis | '**'): boolean {
  const before = text[i - 1] ?? '';
  if (before === '' || /\s/u.test(before)) return false;
  const after = text[i + marker.length] ?? '';
  // A single `*` that is really half of a `**` belongs to the bold run.
  if (marker === '*' && after === '*') return false;
  if (marker === '_' && /[\p{L}\p{N}]/u.test(after)) return false;
  return true;
}

/** Index of the delimiter that would close a span opened before `from`, or -1. */
function findCloser(text: string, from: number, marker: Emphasis | '**'): number {
  for (let i = text.indexOf(marker, from); i !== -1; i = text.indexOf(marker, i + 1)) {
    if (isCloser(text, i, marker)) return i;
  }
  return -1;
}

/**
 * The style for one run of inline text.
 *
 * `undefined` when nothing applies, matching the HTML path: an unstyled segment
 * costs no escape sequence and shows the user's own foreground.
 */
function styleFor(
  base: Style | undefined,
  italic: boolean,
  bold: boolean,
  code: boolean,
  theme: Theme,
): Style | undefined {
  const style: Style = {
    ...(base ?? {}),
    ...(italic ? theme.supplied : {}),
    ...(bold ? { bold: true } : {}),
    ...(code ? { underline: true } : {}),
  };
  return Object.keys(style).length === 0 ? undefined : style;
}
