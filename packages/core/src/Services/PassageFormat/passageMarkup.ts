/**
 * Passage -> *markup* rendering: the note-insertion side of the format engine.
 *
 * The five formats in `formatRegistry` all render a passage as **plain lines**
 * - right for a clipboard, which has no structure to put a passage into. A
 * note does: it has blockquotes, headings and paragraphs, and an expository
 * preacher wants the passage laid into them ("each verse under its own H3,
 * quoted beneath"). Expressing that as newline-separated text and hoping the
 * editor guesses the structure does not work, so these four formats produce a
 * small block tree instead.
 *
 * What is shared with copy/export is everything below the structure:
 * `formatHelpers`' verse-text extraction (including the red-letter and
 * paragraph-marker rules) and its reference building, plus the `FormatOptions`
 * vocabulary - "display translation" and "words of Christ in red" mean exactly
 * what they mean in the copy dialog. What is not shared is the shape: a
 * `<blockquote>` has no meaning on a clipboard. {@link passageMarkupToMarkdown}
 * is the bridge for when it does - it renders the same block tree as Markdown,
 * which is what a clipboard consumer would want.
 *
 * Everything here is pure: no DOM, no editor, no storage. Persistence lives in
 * each app (the desktop renderer's `copyFormats/passageMarkupPreferences.ts`
 * and its web counterpart), which is why the option record is passed in rather
 * than read; `passageMarkupOptions.ts` beside this file is the shared half of
 * that - the validation both apps run over whatever they read back.
 */

import { PassageVerse, VerseContext, FormatOptions, DEFAULT_FORMAT_OPTIONS } from './types';
import { getVerseTextForFormat, buildPassageReference } from './formatHelpers';
import { escapeHtml, stripHtmlTags as stripTags } from './htmlText';

/** The four note-insertion formats. */
export const PASSAGE_MARKUP_FORMAT_IDS = [
  'blockquote',
  'blockquote-numbered',
  'heading-per-verse',
  'inline-quote',
] as const;

export type PassageMarkupFormatId = (typeof PASSAGE_MARKUP_FORMAT_IDS)[number];

export function isPassageMarkupFormat(id: string): id is PassageMarkupFormatId {
  return (PASSAGE_MARKUP_FORMAT_IDS as readonly string[]).includes(id);
}

/** How a verse number is written in front of its text. */
export type VerseNumberStyle = 'parenthetical' | 'superscript' | 'none';

/** Quote marks around an inline quotation. */
export type QuoteMarkStyle = 'double' | 'single' | 'none';

/**
 * Where the reference goes.
 *
 * Deliberately the same three choices as the Advanced copy format's
 * `ReferencePosition`, spelled `before`/`after` rather than `start`/`end`
 * because here it names a *block* on one side of the passage, not a position
 * within a line.
 */
export type PassageReferencePosition = 'before' | 'after' | 'none';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** The shape controls, over and above the two universal `FormatOptions`. */
export interface PassageMarkupShapeOptions {
  referencePosition: PassageReferencePosition;
  verseNumbers: VerseNumberStyle;
  /** Heading level for `heading-per-verse`. */
  headingLevel: HeadingLevel;
  /** Quote marks for `inline-quote`. */
  quoteMarks: QuoteMarkStyle;
  /**
   * Leave a labelled paragraph under each verse to write into.
   *
   * This is the expositor's layout - verse, then your comment on it, verse,
   * then your comment. Without it a verse-by-verse insertion arrives as an
   * unbroken run of quotations and the writer has to open every gap by hand.
   * Only the per-verse formats offer it; there is nothing to put a gap between
   * in a passage rendered as one quotation.
   */
  commentPlaceholders: boolean;
}

/** A fully resolved option set for one markup format. */
export interface PassageMarkupOptions extends FormatOptions, PassageMarkupShapeOptions {}

/**
 * What an insertion carries around: always the two universal options, plus
 * whichever shape options the chosen format understands.
 *
 * Partial on purpose - this is also what gets serialised into a note's
 * `data-expansion-options`, where a copy-format expansion has no shape options
 * at all and a markup one written by an older build may be missing a field
 * added since.
 */
export type PassageInsertOptions = FormatOptions & Partial<PassageMarkupShapeOptions>;

/** One rendered line: the same content as HTML and as plain text. */
export interface PassageMarkupLine {
  /** Ready-to-insert inline HTML (escaped, or red-letter markup). */
  html: string;
  /** The same line as plain text, which is what the document will show. */
  text: string;
}

export type PassageMarkupBlock =
  | { kind: 'paragraph'; line: PassageMarkupLine }
  | { kind: 'heading'; level: HeadingLevel; line: PassageMarkupLine }
  | { kind: 'quote'; lines: PassageMarkupLine[] }
  /** A writing prompt under a verse - rendered muted, meant to be typed over. */
  | { kind: 'placeholder'; line: PassageMarkupLine };

export interface PassageMarkup {
  /**
   * True when the whole passage is a single inline run with no block of its
   * own, so it can be dropped into the middle of a sentence.
   */
  inline: boolean;
  blocks: PassageMarkupBlock[];
}

/** Labels the renderer cannot produce itself, because they are localized. */
export interface PassageMarkupLabels {
  /** Heading template for `heading-per-verse`. `{verse}` and `{chapter}`. */
  verseHeading: string;
  /** Placeholder template under each verse. `{reference}`. */
  commentPlaceholder: string;
}

export const DEFAULT_PASSAGE_MARKUP_LABELS: PassageMarkupLabels = {
  verseHeading: 'Verse {verse}',
  commentPlaceholder: '[Comments for {reference}]',
};

/** Which shape controls a format actually uses - the rest are not shown. */
export interface PassageMarkupFormatMeta {
  id: PassageMarkupFormatId;
  /** English name; the UI resolves `ui.passageInsert.format.<id>.name` first. */
  name: string;
  description: string;
  controls: ReadonlyArray<keyof PassageMarkupShapeOptions>;
}

export const PASSAGE_MARKUP_FORMATS: readonly PassageMarkupFormatMeta[] = [
  {
    id: 'blockquote',
    name: 'Block quote',
    description: 'The whole passage as one quote, broken only where the text is',
    controls: ['referencePosition', 'verseNumbers'],
  },
  {
    id: 'blockquote-numbered',
    name: 'Numbered quote',
    description: 'A quote with each verse numbered, on its own line',
    controls: ['referencePosition', 'verseNumbers', 'commentPlaceholders'],
  },
  {
    id: 'heading-per-verse',
    name: 'Verse headings',
    description: 'A heading per verse with the verse quoted beneath it',
    controls: ['referencePosition', 'verseNumbers', 'headingLevel', 'commentPlaceholders'],
  },
  {
    id: 'inline-quote',
    name: 'Inline quote',
    description: 'Reference and quotation on one line, inside the sentence',
    controls: ['referencePosition', 'verseNumbers', 'quoteMarks'],
  },
];

export function getPassageMarkupFormat(id: string): PassageMarkupFormatMeta | undefined {
  return PASSAGE_MARKUP_FORMATS.find(f => f.id === id);
}

/**
 * Per-format defaults.
 *
 * They differ because the formats are for different jobs: a plain block quote
 * is a reading, so it carries no verse numbers and cites itself underneath; a
 * numbered quote is for working through a passage, so the numbers lead and the
 * reference heads it.
 */
export const DEFAULT_PASSAGE_MARKUP_OPTIONS: Readonly<
  Record<PassageMarkupFormatId, PassageMarkupOptions>
> = {
  blockquote: {
    ...DEFAULT_FORMAT_OPTIONS,
    referencePosition: 'after',
    verseNumbers: 'none',
    headingLevel: 3,
    quoteMarks: 'none',
    commentPlaceholders: false,
  },
  'blockquote-numbered': {
    ...DEFAULT_FORMAT_OPTIONS,
    referencePosition: 'before',
    verseNumbers: 'parenthetical',
    headingLevel: 3,
    quoteMarks: 'none',
    commentPlaceholders: false,
  },
  'heading-per-verse': {
    ...DEFAULT_FORMAT_OPTIONS,
    referencePosition: 'before',
    verseNumbers: 'parenthetical',
    headingLevel: 3,
    quoteMarks: 'none',
    commentPlaceholders: false,
  },
  'inline-quote': {
    ...DEFAULT_FORMAT_OPTIONS,
    referencePosition: 'before',
    verseNumbers: 'none',
    headingLevel: 3,
    quoteMarks: 'double',
    commentPlaceholders: false,
  },
};

/** Fill any missing field from the format's own defaults. */
export function resolvePassageMarkupOptions(
  formatId: PassageMarkupFormatId,
  options: PassageInsertOptions | null | undefined,
): PassageMarkupOptions {
  const defaults = DEFAULT_PASSAGE_MARKUP_OPTIONS[formatId];
  if (!options) return { ...defaults };
  return {
    displayVersionNumber:
      typeof options.displayVersionNumber === 'boolean'
        ? options.displayVersionNumber
        : defaults.displayVersionNumber,
    wordsOfChristInRed:
      typeof options.wordsOfChristInRed === 'boolean'
        ? options.wordsOfChristInRed
        : defaults.wordsOfChristInRed,
    referencePosition: options.referencePosition ?? defaults.referencePosition,
    verseNumbers: options.verseNumbers ?? defaults.verseNumbers,
    headingLevel: options.headingLevel ?? defaults.headingLevel,
    quoteMarks: options.quoteMarks ?? defaults.quoteMarks,
    commentPlaceholders: options.commentPlaceholders ?? defaults.commentPlaceholders,
  };
}

const QUOTE_MARKS: Record<QuoteMarkStyle, { open: string; close: string }> = {
  double: { open: '“', close: '”' },
  single: { open: '‘', close: '’' },
  none: { open: '', close: '' },
};

/**
 * Verse text as both flavours.
 *
 * `getVerseTextForFormat` returns *HTML* when red letters are on and *raw
 * text* when they are off - the copy engine's long-standing asymmetry. The
 * plain branch is escaped here rather than left to a downstream sanitiser, so
 * an ampersand in the text survives as an ampersand instead of being read as
 * the start of an entity.
 */
function verseText(verse: PassageVerse, options: PassageMarkupOptions): PassageMarkupLine {
  if (options.wordsOfChristInRed) {
    const html = getVerseTextForFormat(verse, true);
    return { html, text: stripTags(html) };
  }
  const text = getVerseTextForFormat(verse, false);
  return { html: escapeHtml(text), text };
}

/**
 * A separator between two runs *inside* one line, in both flavours at once.
 *
 * The two are not always the same character: a soft break is `<br>` in HTML
 * and a bare newline in text, which a single `string` separator could not say.
 */
interface LineSeparator {
  html: string;
  text: string;
}

/** Running prose: verses flow together in one paragraph. */
const RUN_ON: LineSeparator = { html: ' ', text: ' ' };

/**
 * A line break within a paragraph - Shift+Enter, not Enter.
 *
 * This is what separates the verses of a numbered quote. Each verse gets its
 * own line because it carries its own number, but the verses still belong to
 * one paragraph, so they must not be `<p>`-separated: in TipTap, Word, or any
 * rich paste target that reads as a blank line between every verse.
 */
const SOFT_BREAK: LineSeparator = { html: '<br>', text: '\n' };

function joinLines(lines: PassageMarkupLine[], separator: LineSeparator = RUN_ON): PassageMarkupLine {
  return {
    html: lines.map(l => l.html).join(separator.html),
    text: lines.map(l => l.text).join(separator.text),
  };
}

function plain(text: string): PassageMarkupLine {
  return { html: escapeHtml(text), text };
}

function prefix(label: PassageMarkupLine, line: PassageMarkupLine): PassageMarkupLine {
  if (!label.text && !label.html) return line;
  return { html: `${label.html}${line.html}`, text: `${label.text}${line.text}` };
}

/**
 * The number in front of a verse.
 *
 * Carries the chapter when the passage crosses one, because in a numbered
 * quote of "John 3:35-4:2" a bare `(1)` says nothing about which chapter it
 * came from - the same rule the Advanced copy format uses for its labels.
 */
function verseLabel(
  verse: PassageVerse,
  options: PassageMarkupOptions,
  multiChapter: boolean,
): PassageMarkupLine {
  const number = multiChapter ? `${verse.chapter}:${verse.verse}` : String(verse.verse);
  switch (options.verseNumbers) {
    case 'parenthetical':
      return plain(`(${number}) `);
    case 'superscript':
      return { html: `<sup>${escapeHtml(number)}</sup> `, text: `${number} ` };
    case 'none':
    default:
      return { html: '', text: '' };
  }
}

/** Group verses into paragraphs the way the source text marks them. */
function paragraphsOf(verses: PassageVerse[]): PassageVerse[][] {
  const paragraphs: PassageVerse[][] = [];
  let current: PassageVerse[] = [];
  verses.forEach((verse, index) => {
    if (index > 0 && verse.is_paragraph_start && current.length > 0) {
      paragraphs.push(current);
      current = [];
    }
    current.push(verse);
  });
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

function referenceBlocks(
  reference: string,
  position: PassageReferencePosition,
): { before: PassageMarkupBlock[]; after: PassageMarkupBlock[] } {
  if (!reference || position === 'none') return { before: [], after: [] };
  if (position === 'before') {
    return { before: [{ kind: 'paragraph', line: plain(reference) }], after: [] };
  }
  return { before: [], after: [{ kind: 'paragraph', line: plain(`— ${reference}`) }] };
}

/**
 * Render a passage into blocks.
 *
 * `verses` must be in document order and non-empty; an empty array renders an
 * empty markup rather than throwing, so a caller racing a fetch cannot crash
 * a preview.
 */
export function renderPassageMarkup(
  verses: PassageVerse | PassageVerse[],
  context: VerseContext,
  formatId: PassageMarkupFormatId,
  options: PassageInsertOptions | null | undefined,
  labels: PassageMarkupLabels = DEFAULT_PASSAGE_MARKUP_LABELS,
): PassageMarkup {
  const list = Array.isArray(verses) ? verses : [verses];
  if (list.length === 0) return { inline: formatId === 'inline-quote', blocks: [] };

  const resolved = resolvePassageMarkupOptions(formatId, options);
  const multiChapter = list[0].chapter !== list[list.length - 1].chapter;

  if (formatId === 'inline-quote') {
    return renderInlineQuote(list, context, resolved, multiChapter);
  }

  const reference = buildPassageReference(list, context, resolved.displayVersionNumber);
  const { before, after } = referenceBlocks(reference, resolved.referencePosition);

  if (formatId === 'heading-per-verse') {
    const blocks: PassageMarkupBlock[] = [...before];
    for (const verse of list) {
      blocks.push({
        kind: 'heading',
        level: resolved.headingLevel,
        line: plain(headingFor(verse, labels)),
      });
      blocks.push({
        kind: 'quote',
        lines: [prefix(verseLabel(verse, resolved, multiChapter), verseText(verse, resolved))],
      });
      if (resolved.commentPlaceholders) {
        blocks.push({ kind: 'placeholder', line: plain(placeholderFor(verse, context, labels)) });
      }
    }
    return { inline: false, blocks: [...blocks, ...after] };
  }

  // A numbered quote with placeholders has to break into one quote block per
  // verse, since the prompt goes *between* the verses rather than after the
  // passage. Without placeholders it stays a single quote, which is the shape
  // the format is named for.
  if (formatId === 'blockquote-numbered' && resolved.commentPlaceholders) {
    const blocks: PassageMarkupBlock[] = [...before];
    for (const verse of list) {
      blocks.push({
        kind: 'quote',
        lines: [prefix(verseLabel(verse, resolved, multiChapter), verseText(verse, resolved))],
      });
      blocks.push({ kind: 'placeholder', line: plain(placeholderFor(verse, context, labels)) });
    }
    return { inline: false, blocks: [...blocks, ...after] };
  }

  // Both shapes group by the source's own paragraphs; they differ only in what
  // separates two verses *within* one paragraph. A plain quote runs them
  // together as prose. A numbered quote gives each verse its own line - it
  // carries its own number, so running them on would be unreadable - but a
  // *line*, not a paragraph, so that the only blank lines in the output are the
  // ones the text actually has.
  const separator = formatId === 'blockquote-numbered' ? SOFT_BREAK : RUN_ON;
  const lines: PassageMarkupLine[] = paragraphsOf(list).map(paragraph =>
    joinLines(
      paragraph.map(verse =>
        prefix(verseLabel(verse, resolved, multiChapter), verseText(verse, resolved)),
      ),
      separator,
    ),
  );

  return { inline: false, blocks: [...before, { kind: 'quote', lines }, ...after] };
}

/** `[Comments for John 3:16]` - the prompt written under one verse. */
function placeholderFor(
  verse: PassageVerse,
  context: VerseContext,
  labels: PassageMarkupLabels,
): string {
  // Always the single verse's own reference, never the whole passage's, and
  // never carrying the translation - it names the line above it, and it is
  // going to be typed over.
  const reference = buildPassageReference([verse], context, false);
  return labels.commentPlaceholder.replace(/\{reference\}/g, reference);
}

function headingFor(verse: PassageVerse, labels: PassageMarkupLabels): string {
  return labels.verseHeading
    .replace(/\{verse\}/g, String(verse.verse))
    .replace(/\{chapter\}/g, String(verse.chapter));
}

/**
 * `John 3:16-17: “For God so loved the world...”` - one run, no block of its
 * own, so it can be dropped into a sentence being written.
 */
function renderInlineQuote(
  verses: PassageVerse[],
  context: VerseContext,
  options: PassageMarkupOptions,
  multiChapter: boolean,
): PassageMarkup {
  const marks = QUOTE_MARKS[options.quoteMarks];
  const body = joinLines(
    verses.map((verse, index) =>
      // The first verse's number is redundant - the reference just gave it.
      prefix(index === 0 ? { html: '', text: '' } : verseLabel(verse, options, multiChapter), verseText(verse, options)),
    ),
  );
  const quoted: PassageMarkupLine = {
    html: `${marks.open}${body.html}${marks.close}`,
    text: `${marks.open}${body.text}${marks.close}`,
  };

  if (options.referencePosition === 'before') {
    const reference = buildPassageReference(verses, context, options.displayVersionNumber);
    return { inline: true, blocks: [{ kind: 'paragraph', line: prefix(plain(`${reference}: `), quoted) }] };
  }
  if (options.referencePosition === 'after') {
    // 'appended' - the parentheses are added here, so the translation must not
    // bring a second pair: "(John 3:16, KJV)", never "(John 3:16 (KJV))".
    const reference = buildPassageReference(verses, context, options.displayVersionNumber, 'appended');
    const tail = plain(` (${reference})`);
    return {
      inline: true,
      blocks: [{ kind: 'paragraph', line: { html: `${quoted.html}${tail.html}`, text: `${quoted.text}${tail.text}` } }],
    };
  }
  return { inline: true, blocks: [{ kind: 'paragraph', line: quoted }] };
}

export interface PassageMarkupHtmlOptions {
  /**
   * Wraps every line's inner HTML. This is how the expansion mark gets onto
   * the content: the mark is inline, so it has to go *inside* each block
   * rather than around the passage.
   */
  wrapInner?: (inner: string) => string;
  /**
   * Force an inline result into a paragraph of its own. Tab uses this when it
   * appends a passage beneath a sentence, where even a one-line format has to
   * be its own block.
   */
  forceBlock?: boolean;
}

/** Assemble the block tree as HTML ready for TipTap's `insertContentAt`. */
export function passageMarkupToHtml(
  markup: PassageMarkup,
  { wrapInner, forceBlock = false }: PassageMarkupHtmlOptions = {},
): string {
  const wrap = wrapInner ?? ((inner: string) => inner);
  if (markup.inline && !forceBlock) {
    return markup.blocks
      .map(block => (block.kind === 'quote' ? block.lines.map(l => wrap(l.html)).join(' ') : wrap(block.line.html)))
      .join(' ');
  }

  return markup.blocks
    .map(block => {
      switch (block.kind) {
        case 'heading':
          return `<h${block.level}>${wrap(block.line.html)}</h${block.level}>`;
        case 'quote':
          return `<blockquote>${block.lines.map(l => `<p>${wrap(l.html)}</p>`).join('')}</blockquote>`;
        case 'placeholder':
          // Deliberately *outside* `wrap`: the expansion mark fingerprints the
          // text it covers, and a placeholder exists to be typed over. Marking
          // it would make the passage read as edited the moment the writer did
          // the one thing the placeholder asks for, withdrawing the offer to
          // re-format it.
          return `<p><em>${block.line.html}</em></p>`;
        case 'paragraph':
        default:
          return `<p>${wrap(block.line.html)}</p>`;
      }
    })
    .join('');
}

/**
 * The passage's text exactly as the document will show it - no markup, no
 * decoration.
 *
 * This is what the expansion fingerprint is taken over
 * (`expansionContentHash`), so it must contain the same characters the marked
 * runs will hold and nothing more. Adding Markdown decoration here would make
 * every freshly inserted passage look edited.
 */
export function passageMarkupToText(markup: PassageMarkup): string {
  return markup.blocks
    // Placeholders are excluded for the same reason they are not wrapped in
    // the mark: they are prompts, not passage text, and the fingerprint has to
    // survive the writer replacing them.
    .filter(block => block.kind !== 'placeholder')
    .map(block => (block.kind === 'quote' ? block.lines.map(l => l.text).join('\n') : block.line.text))
    .join('\n');
}

/**
 * A plain-text block quote has no `>`, so it is set off by indentation
 * instead. Four spaces, the same as `passageCopyRenderer`'s - the two families
 * must not disagree about what "quoted" looks like on a clipboard.
 */
const PLAIN_QUOTE_INDENT = '    ';

export interface PassageMarkupSourceOptions {
  /**
   * Emit Markdown for the structure: `#` headings, `> ` quote lines, italic
   * placeholders. Off, the same tree is written as bare lines with an indent
   * standing in for the quote bar.
   */
  markdown?: boolean;
  /**
   * Decorate quote blocks at all. This is the clipboard's Block Quote/Inline
   * choice, which these shapes honour exactly as the Standard format does:
   * `blockquote` is a *shape* in a note and a *decoration* on a clipboard, and
   * a user pasting into a plain-text field wants the option of neither.
   */
  blockQuote?: boolean;
  /**
   * Use each line's HTML flavour (the red-letter `<span>` runs) rather than
   * its plain text. Mirrors `renderPassageCopy`'s long-standing asymmetry, so
   * the consumer's existing "is this HTML?" rule - red letters on and Markdown
   * off - keeps working unchanged for these formats too.
   */
  richText?: boolean;
}

/**
 * The same block tree as source text, for a consumer with no structure to put
 * it into.
 *
 * The clipboard has no blockquote and no `<h3>`, so a copy of one of these
 * shapes has to be written out - which is what the copy dialog's `markdown`
 * option already does for the Standard shape. This is the call the clipboard
 * path makes; {@link passageMarkupToHtml} remains the one a note makes.
 */
export function passageMarkupToSourceText(
  markup: PassageMarkup,
  { markdown = false, blockQuote = true, richText = false }: PassageMarkupSourceOptions = {},
): string {
  // In `richText` the line's HTML flavour is read for its red-letter spans, but
  // this function still returns *source text*: the caller derives the plain
  // clipboard flavour from it by reading `textContent`, which drops a `<br>`
  // without leaving a newline behind - running a numbered quote's verses
  // together. The genuine HTML flavour is built separately by
  // `passageMarkupToHtml`, where `<br>` is exactly right.
  const read = (line: PassageMarkupLine): string =>
    richText ? line.html.replace(/<br\s*\/?>/gi, '\n') : line.text;

  // A numbered quote's paragraphs carry a soft break between verses, so one
  // `PassageMarkupLine` can already be several physical lines. Whatever marks a
  // line as quoted - the `> ` or the indent - has to go on every one of them,
  // or the second verse onwards falls out of the quote.
  const quoted = (line: PassageMarkupLine, marker: string, softBreak = '\n'): string =>
    read(line)
      .split('\n')
      .map(physical => `${marker}${physical}`)
      .join(softBreak);

  const quoteLines = (lines: PassageMarkupLine[]): string => {
    if (!blockQuote) return lines.map(read).join('\n');
    if (markdown) {
      // Two trailing spaces are Markdown's own Shift+Enter: they end the line
      // without ending the paragraph, which is exactly what separates the
      // verses of a numbered quote.
      // A bare `>` between paragraphs keeps one quote contiguous rather than
      // splitting it into several with gaps between them.
      return lines.map(l => quoted(l, '> ', '  \n')).join('\n>\n');
    }
    return lines.map(l => quoted(l, PLAIN_QUOTE_INDENT)).join('\n');
  };

  return markup.blocks
    .map(block => {
      switch (block.kind) {
        case 'heading':
          return markdown
            ? `${'#'.repeat(block.level)} ${read(block.line)}`
            : read(block.line);
        case 'quote':
          return quoteLines(block.lines);
        case 'placeholder':
          return markdown ? `*${read(block.line)}*` : read(block.line);
        case 'paragraph':
        default:
          return read(block.line);
      }
    })
    .join(markup.inline ? ' ' : '\n\n');
}

/**
 * The same block tree as Markdown - the fully decorated form of
 * {@link passageMarkupToSourceText}.
 */
export function passageMarkupToMarkdown(markup: PassageMarkup): string {
  return passageMarkupToSourceText(markup, { markdown: true, blockQuote: true });
}
