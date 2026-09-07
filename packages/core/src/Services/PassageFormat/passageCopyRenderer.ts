/**
 * The one renderer behind both fixed copy formats.
 *
 * **Standard** and **Combined** are two shapes of the same thing, not two
 * independent code paths: they read the same `AdvancedCopyOptions` record, build
 * the same block list from the same verse pieces, and differ only in how that
 * list is laid out and where the reference goes.
 *
 *   Standard - reference on its own line, passage beneath it, optionally one
 *              verse per line and optionally set as a block quote.
 *   Combined - the whole passage on one running line with the reference
 *              parenthesised and inlined.
 *
 * A shape ignores the options that mean nothing to it (`newLinePerVerse` and
 * `textFormat` are Standard's; `paragraphBreaks` is Combined's), so the panel
 * shows only the ones in force and the renderer never has to guess.
 *
 * Verse text is HTML when `wordsOfChristInRed` is on (red `<span>` runs) and
 * plain text otherwise - the same conditional the rest of the format engine
 * uses, so every consumer already sanitises it. Markdown mode forces the plain
 * path: the clipboard carries Markdown as *source text*, and shipping
 * red-letter HTML alongside would let a rich editor pick the HTML and silently
 * discard the Markdown the user asked for.
 */

import type { PassageVerse, VerseContext, FormatOptions } from './types';
import { getVerseTextForFormat, buildPassageReference } from './formatHelpers';
import type { AdvancedCopyOptions } from './copyOptions';

/** Which of the two fixed shapes to render. */
export type CopyShape = 'standard' | 'combined';

/**
 * A plain-text block quote has no `>`, so it is set off by indentation instead.
 * Four spaces, because that is what reads as "quoted" in a mail client, a chat
 * box and a sermon document alike.
 */
const PLAIN_QUOTE_INDENT = '    ';

/**
 * Combined runs verses together with a double space rather than a single one.
 * The passage arrives as one unbroken line, and the wider gap is the only cue
 * left that a new verse has started.
 */
const COMBINED_VERSE_GAP = '  ';

/**
 * The passage as a short list of blocks, which is what makes chapter headings
 * possible without threading a "are we inside a quote?" flag through the loop:
 * a heading is its own block, so the quote decoration below only ever sees
 * verse lines.
 */
type PassageBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; lines: string[] };

export function renderPassageCopy(
  verses: PassageVerse | PassageVerse[],
  context: VerseContext,
  options: FormatOptions,
  advanced: AdvancedCopyOptions,
  shape: CopyShape
): string {
  const list = Array.isArray(verses) ? verses : [verses];
  if (list.length === 0) {
    return '';
  }

  const { markdown } = advanced;
  const texts = list.map(v =>
    getVerseTextForFormat(v, options.wordsOfChristInRed && !markdown)
  );

  const isMultiChapter = list[0].chapter !== list[list.length - 1].chapter;
  const showChapterHeadings = isMultiChapter && advanced.includeChapterHeadings;
  // With a "Chapter N" heading above it, a bare verse number is unambiguous;
  // without one, the label has to carry the chapter itself.
  const needsChapterInLabel = isMultiChapter && !showChapterHeadings;

  const piece = (index: number): string => {
    const v = list[index];
    if (!advanced.includeVerseNumbers) return texts[index];
    const label = needsChapterInLabel ? `${v.chapter}:${v.verse}` : `${v.verse}`;
    return `(${label}) ${texts[index]}`;
  };

  // Standard is the only shape that can put a verse on its own line; Combined
  // is by definition one run. Likewise only Combined honours paragraph breaks -
  // Standard's line policy is `newLinePerVerse` and nothing else.
  const oneVersePerLine = shape === 'standard' && advanced.newLinePerVerse;
  const breakOnParagraph = shape === 'combined' && advanced.paragraphBreaks;
  const gap = shape === 'combined' ? COMBINED_VERSE_GAP : ' ';

  const blocks: PassageBlock[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) {
      blocks.push({ kind: 'text', lines: current });
      current = [];
    }
  };

  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    const startsChapter = i === 0 || v.chapter !== list[i - 1].chapter;

    if (showChapterHeadings && startsChapter) {
      flush();
      blocks.push({ kind: 'heading', text: `Chapter ${v.chapter}` });
    } else if (isMultiChapter && startsChapter) {
      // A chapter boundary still has to break even with headings switched off,
      // or the end of one chapter runs straight into the start of the next.
      flush();
    } else if (breakOnParagraph && v.is_paragraph_start) {
      flush();
    }

    if (oneVersePerLine || current.length === 0) {
      current.push(piece(i));
    } else {
      current[current.length - 1] = `${current[current.length - 1]}${gap}${piece(i)}`;
    }
  }
  flush();

  const withVersion = options.displayVersionNumber;
  // On its own line the reference cites itself - "John 3:16 (KJV)". Inline it is
  // parenthesised as a whole, so the version is appended rather than bringing a
  // second pair of parentheses: "(John 3:16, KJV)".
  const referenceLine = (): string => buildPassageReference(list, context, withVersion);
  const referenceInline = (): string =>
    `(${buildPassageReference(list, context, withVersion, 'appended')})`;

  if (shape === 'combined' && advanced.referencePosition !== 'none') {
    attachInlineReference(blocks, referenceInline(), advanced.referencePosition);
  }

  const quoted = shape === 'standard' && advanced.textFormat === 'blockquote';
  const body = blocks
    .map(block =>
      block.kind === 'heading'
        ? (markdown ? `### ${block.text}` : block.text)
        : renderTextBlock(block.lines, quoted, markdown)
    )
    .join('\n\n');

  if (shape === 'combined' || advanced.referencePosition === 'none') {
    return body;
  }

  return advanced.referencePosition === 'beginning'
    ? `${referenceLine()}\n\n${body}`
    : `${body}\n\n${referenceLine()}`;
}

/** Apply the block-quote decoration, if any, to one run of verse lines. */
function renderTextBlock(lines: string[], quoted: boolean, markdown: boolean): string {
  if (!quoted) return lines.join('\n');
  if (markdown) {
    // A bare `>` on an empty line keeps the quote contiguous rather than
    // splitting it into two quotes with a gap between them.
    return lines.map(line => (line ? `> ${line}` : '>')).join('\n');
  }
  return lines.map(line => (line ? `${PLAIN_QUOTE_INDENT}${line}` : '')).join('\n');
}

/**
 * Splice Combined's parenthesised reference into the passage itself.
 *
 * It goes *inside* the first or last text block rather than becoming a block of
 * its own, which is the whole point of the format: "(John 3:16-17, KJV) For God
 * so loved..." reads as one sentence. A passage that opens with a chapter heading
 * has no text block to open, so the reference gets one.
 */
function attachInlineReference(
  blocks: PassageBlock[],
  reference: string,
  position: 'beginning' | 'end'
): void {
  if (position === 'beginning') {
    for (const block of blocks) {
      if (block.kind === 'text' && block.lines.length > 0) {
        block.lines[0] = `${reference} ${block.lines[0]}`;
        return;
      }
    }
    blocks.unshift({ kind: 'text', lines: [reference] });
    return;
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.kind === 'text' && block.lines.length > 0) {
      const last = block.lines.length - 1;
      block.lines[last] = `${block.lines[last]} ${reference}`;
      return;
    }
  }
  blocks.push({ kind: 'text', lines: [reference] });
}
