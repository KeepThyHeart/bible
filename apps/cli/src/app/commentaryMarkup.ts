/**
 * Commentary (and dictionary, and book-section) markup → terminal rows.
 *
 * Extracted from the old `screens/Commentary.ts` rail-based screen when it
 * was removed (task 0001-bible-cli, "delete the old screens"): that screen's
 * own UI — the module rail, `<`/`>` by unit, the find box — is superseded by
 * `screens/Main.ts`'s `c`/`m` study views, but {@link layoutCommentary} is
 * pure and is reused unchanged, by `Main.ts` for a commentary entry and by
 * `app/studyPanes.ts`'s dictionary and book readers alike.
 *
 * Most module content is HTML, and not the tidy subset a Bible verse carries.
 * A tag census over the first 60 entries of each of the 25 installed
 * commentaries finds `br` (8,570), `li` (7,438), the SWORD-era `<!P>` /
 * `<!/P>` paragraph markers (7,071 between them), `i` (3,342), `a` (3,121),
 * `b` (1,670), `p` (934), `sup` (401), plus `ul`, `u`, `td`, `strong`,
 * `blockquote`, `table`, `sc` and `img`. Entities are rarer: `&amp;`, `&lt;`,
 * `&gt;`, and one module's stray `&D;`.
 *
 * The transform is therefore structural rather than a strip:
 *
 * - **Block tags become paragraph breaks**, which is the only vertical
 *   structure a terminal has. Stripping them instead runs a fifteen-point
 *   exposition together into one wall of text.
 * - **`<li>` gets a bullet and a hanging indent**, because a wrapped list item
 *   without one is indistinguishable from prose.
 * - **`<i>` is italic, `<b>` bold, `<u>` underlined** — attributes rather than
 *   colour, so they survive `NO_COLOR` exactly as `supplied` does in the
 *   reader.
 * - **`<sup>` digits become real superscripts**, matching how the reader
 *   draws a verse number, because in commentary text that is invariably what
 *   they are.
 * - **`<sc>` is uppercased**, for the reason the reader uppercases the divine
 *   name: a terminal has no small caps, and doing nothing loses a distinction
 *   the module was deliberately drawing.
 * - **Every other tag is dropped and its text kept.** An `<a>` is a scripture
 *   link, and following one belongs to the cross-reference list, not a pager.
 *
 * ## The minority that is Markdown
 *
 * Some modules store Markdown instead, and in one of those the HTML parser
 * matches no tag at all: the entry arrives as a single paragraph carrying
 * literal `##` and `**` where its structure should have been.
 * `term/markdown.ts` is the second parser for that case and emits the same
 * {@link Block}, so everything below this branch — wrapping, hanging
 * indents, styling — is untouched by which parser ran.
 *
 * **The choice is made per entry, and there is nowhere for it to be
 * cached.** A module is a bag of rows written over years, sometimes by a
 * converter that changed its mind, so the same module can hold HTML on one
 * verse and Markdown on the next. This function is called once per entry
 * drawn, which is exactly the granularity the question has.
 *
 * ## Why tokens rather than runs
 *
 * `wrapRuns` would be the shorter call, and it is wrong here: it
 * re-tokenises each run separately, so `<strong>…world</strong>,` — Gill's
 * opening line — would come out as `world ,` with a space the module never
 * wrote. A word can change style in the middle, so the unit that must not be
 * split is the word, not the run. That is precisely what {@link LayoutToken}
 * is for, and it is the same mechanism the reader uses to glue a verse
 * number to the word after it.
 */
import { decodeHtmlEntities } from '@bible/core';

import { looksLikeMarkdown, parseMarkdownBlocks, type Block } from '../term/markdown';
import { makeToken, wrapTokens, type LayoutToken } from '../term/layout';
import { superscript } from '../term/reading';
import type { Style, StyledLine, StyledSegment, Theme } from '../term/style';

export interface CommentaryLayoutOptions {
  readonly width: number;
  readonly theme: Theme;
}

export function layoutCommentary(content: string, options: CommentaryLayoutOptions): StyledLine[] {
  const lines: StyledLine[] = [];
  const blocks = looksLikeMarkdown(content)
    ? parseMarkdownBlocks(content, options.theme)
    : parseBlocks(content, options.theme);

  for (const block of blocks) {
    if (lines.length > 0) lines.push([]);
    const wrapped = wrapTokens(block.tokens, {
      width: options.width,
      firstIndent: block.indent,
      // A wrapped list item hangs past its bullet, so the bullet stays the
      // only thing in that column and the item reads as one thing.
      hangingIndent: block.indent + (block.bullet ? 2 : 0),
    });
    for (const line of wrapped) lines.push(line.segments);
  }

  return lines;
}

/** Tags that end the current paragraph. `!p` / `!/p` are SWORD's `<!P>` markers. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p', 'div', 'br', 'li', 'ul', 'ol', 'tr', 'table', 'blockquote', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', '!p', '!/p',
]);

/**
 * A tag, the `<!P>` / `<!/P>` markers, or a comment.
 *
 * Not `/<[^>]*>/`: that pattern eats `a < b > c`, and commentary prose
 * contains bare angle brackets far more often than it contains a tag this
 * needs to know about. Same reasoning as core's `HTML_TAG_PATTERN`.
 */
const TAG = /<(!\/?p)>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|<!--[\s\S]*?-->/gi;

function parseBlocks(html: string, theme: Theme): Block[] {
  const blocks: Block[] = [];
  let tokens: LayoutToken[] = [];
  let indent = 0;
  let bullet = false;

  /** The word being built, which may span several styled segments. */
  let word: StyledSegment[] = [];

  let italic = 0;
  let bold = 0;
  let underline = 0;
  let sup = 0;
  let caps = 0;

  const endWord = (): void => {
    if (word.length === 0) return;
    tokens.push(makeToken(word));
    word = [];
  };

  const flush = (): void => {
    endWord();
    if (tokens.length > 0) blocks.push({ tokens, indent, bullet });
    tokens = [];
    indent = 0;
    bullet = false;
  };

  const emit = (raw: string): void => {
    if (raw === '') return;
    const text = decodeHtmlEntities(raw);
    const style = styleFor(italic, bold, underline, theme);

    // Split so that whitespace ends a word and everything else extends it.
    // The whitespace itself is discarded — `wrapTokens` puts the separators
    // back, one space wide, which is what normalises a module's own erratic
    // spacing.
    for (const piece of text.split(/(\s+)/u)) {
      if (piece === '') continue;
      if (/^\s+$/u.test(piece)) {
        endWord();
        continue;
      }
      let content = piece;
      if (caps > 0) content = content.toUpperCase();
      if (sup > 0) content = toSuperscript(content);
      word.push(style === undefined ? { text: content } : { text: content, style });
    }
  };

  TAG.lastIndex = 0;
  let cursor = 0;
  for (let match = TAG.exec(html); match !== null; match = TAG.exec(html)) {
    emit(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const sword = match[1];
    const name = (sword ?? match[3] ?? '').toLowerCase();
    if (name === '') continue; // an HTML comment
    const closing = sword === undefined ? match[2] === '/' : name.startsWith('!/');

    if (BLOCK_TAGS.has(name)) {
      flush();
      if (name === 'li' && !closing) {
        indent = 2;
        bullet = true;
        tokens.push(makeToken([{ text: '•' }]));
      }
      continue;
    }

    switch (name) {
      case 'i':
      case 'em':
        italic = Math.max(0, italic + (closing ? -1 : 1));
        break;
      case 'b':
      case 'strong':
        bold = Math.max(0, bold + (closing ? -1 : 1));
        break;
      case 'u':
        underline = Math.max(0, underline + (closing ? -1 : 1));
        break;
      case 'sup':
        sup = Math.max(0, sup + (closing ? -1 : 1));
        break;
      case 'sc':
        caps = Math.max(0, caps + (closing ? -1 : 1));
        break;
      default:
        // `a`, `td`, `img`, `span`, `font`, anything a module invents: the
        // tag goes and its text stays.
        break;
    }
  }
  emit(html.slice(cursor));
  flush();

  return blocks;
}

function styleFor(italic: number, bold: number, underline: number, theme: Theme): Style | undefined {
  if (italic === 0 && bold === 0 && underline === 0) return undefined;
  return {
    // `theme.supplied` is italic and deliberately no colour, which is exactly
    // what emphasis in a commentary wants: it must not fight anything else.
    ...(italic > 0 ? theme.supplied : {}),
    ...(bold > 0 ? { bold: true } : {}),
    ...(underline > 0 ? { underline: true } : {}),
  };
}

/** `16` → `¹⁶`. Anything that is not a bare number is left as written. */
function toSuperscript(text: string): string {
  return /^\d+$/u.test(text) ? superscript(Number.parseInt(text, 10)) : text;
}
