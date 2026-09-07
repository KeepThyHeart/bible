/**
 * USFM exporter for Bible modules.
 *
 * This is a **pure function over already-fetched rows**: it performs no database
 * access and no file I/O, so it can be unit tested without a database and reused
 * from the main process, the renderer, a CLI, or a server.
 *
 * It re-assembles whole USFM *documents* (one per book) from `bible_verse` rows
 * plus their parsed `formatting` payload:
 *
 * - inline spans become USFM character markers per {@link SPAN_TYPE_USFM}
 * - `block` fields become USFM paragraph markers (`\p`, `\q1`-`\q3`, `\s`, `\d`)
 * - document structure is emitted as `\id` / `\ide` / `\h` / `\mt1` / `\c` / `\v`
 *
 * See `docs/Design/DataModel/ModuleFormat.md` for the normative format definition
 * and for the exporter's structural rules (paragraph inference, nesting, ...).
 */

import { splitVerseWords, SPAN_TYPE_USFM } from '../Data/Text/VerseFormatting';
import type { PoetryLevel, PoetryLine, VerseBlock, VerseFormatting, VerseSpan, VerseSpanType } from '../Data/Text/VerseFormatting';
import { getUsfmBookByNumber, usfmFileName, UsfmBook } from './UsfmBookCodes';
import { readHeadingKind } from './VerseFormatting';

/** Raised when a caller passes data the exporter cannot turn into a document. */
export class UsfmExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsfmExportError';
  }
}

/**
 * One already-fetched verse row.
 *
 * Callers map a `bible_verse` row onto this shape: `verse_id` -> `verseId`,
 * `text` -> `text`, and `parseVerseFormatting(row.formatting)` -> `formatting`.
 */
export interface UsfmVerseInput {
  /** `(book * 1000000) + (chapter * 1000) + verse`. */
  verseId: number;
  /** Plain canonical UTF-8 verse text. No markup. */
  text: string;
  /** Parsed contents of the `formatting` column, if any. */
  formatting?: VerseFormatting | null;
}

/** Subset of `module_info` used to populate the `\id` line and header. */
export interface UsfmModuleInfo {
  abbreviation?: string;
  fullName?: string;
  languageCode?: string;
  copyright?: string;
}

/** Resolves a book number to a display name. */
export type BookNameResolver =
  | ReadonlyMap<number, string>
  | ((bookNumber: number) => string | undefined);

export interface ToUsfmOptions {
  /** Identity of the module being exported; used for `\id` and `\rem` lines. */
  module?: UsfmModuleInfo;
  /** Override the default English book names used for `\h` and `\mt1`. */
  bookNames?: BookNameResolver;
  /** Emit `\ide UTF-8` after `\id`. Default `true`. */
  includeEncodingLine?: boolean;
  /** Emit `\mt1 <book name>`. Default `true`. */
  includeMainTitle?: boolean;
  /** Emit a `\rem` line carrying the module copyright, when present. Default `false`. */
  includeCopyrightRemark?: boolean;
  /** Line separator. Default `'\n'`. */
  lineEnding?: string;
  /** Receives non-fatal problems (dropped spans, unplaceable markers, ...). */
  onWarning?: (message: string) => void;
}

/** One exported USFM document (one book). */
export interface UsfmDocument {
  bookNumber: number;
  /** USFM book identifier, e.g. `JHN`. */
  bookCode: string;
  /** Book name used in the header. */
  bookName: string;
  /** Conventional filename, e.g. `44-JHN.usfm`. */
  fileName: string;
  /** The complete document text. */
  usfm: string;
}

/**
 * Span type -> bare USFM marker name (no leading backslash).
 *
 * Derived from the canonical {@link SPAN_TYPE_USFM} table rather than restated,
 * so the two cannot drift apart.
 */
export const SPAN_TYPE_TO_USFM_MARKER: Readonly<Record<string, string>> = Object.freeze(
  Object.entries(SPAN_TYPE_USFM).reduce<Record<string, string>>((acc, [type, marker]) => {
    acc[type] = marker.replace(/^\\/u, '');
    return acc;
  }, {})
);

/** Inverse of {@link SPAN_TYPE_TO_USFM_MARKER}. */
export const USFM_MARKER_TO_SPAN_TYPE: Readonly<Record<string, VerseSpanType>> = Object.freeze(
  Object.entries(SPAN_TYPE_TO_USFM_MARKER).reduce<Record<string, VerseSpanType>>((acc, [type, marker]) => {
    acc[marker] = type as VerseSpanType;
    return acc;
  }, {})
);

/**
 * USFM marker for a Selah / Higgaion notation.
 *
 * Kept as a named export because callers reference it, but it needs no special
 * handling: `musical_direction` is an ordinary span type, so the words it covers
 * are already known and {@link SPAN_TYPE_TO_USFM_MARKER} renders it like any
 * other. It was previously a block flag, which forced the exporter to *guess*
 * which trailing words to wrap.
 */
export const SELAH_MARKER = SPAN_TYPE_USFM.musical_direction.replace(/^\\/u, '');

const DEFAULT_LINE_ENDING = '\n';

interface VerseAddress {
  bookNumber: number;
  chapter: number;
  verse: number;
}

function parseVerseId(verseId: number): VerseAddress {
  const bookNumber = Math.floor(verseId / 1000000);
  const remainder = verseId % 1000000;
  return {
    bookNumber,
    chapter: Math.floor(remainder / 1000),
    verse: remainder % 1000
  };
}

function resolveBookName(book: UsfmBook, resolver: BookNameResolver | undefined): string {
  if (!resolver) {
    return book.name;
  }
  const resolved = typeof resolver === 'function' ? resolver(book.bookNumber) : resolver.get(book.bookNumber);
  return resolved !== undefined && resolved.length > 0 ? resolved : book.name;
}

/**
 * USFM has no escape sequence for a backslash, so a conforming module must not
 * store one in `text`. Strip defensively rather than emit a broken document.
 */
function sanitizeText(text: string, warn: (message: string) => void, verseId: number): string {
  if (!text.includes('\\')) {
    return text;
  }
  warn(`verse ${verseId}: text contains a backslash, which is not representable in USFM; it was removed`);
  return text.replace(/\\/gu, '');
}

/**
 * Render a `quotation` span's source passage as a USFM attribute.
 *
 * A single-verse quotation emits the bare id (`x-ref="23007014"`); a multi-verse
 * one emits an inclusive range (`x-ref="24031031-24031034"`).
 */
function formatRefAttribute(span: VerseSpan): string {
  if (span.ref_start === undefined) {
    return '';
  }
  const end = span.ref_end ?? span.ref_start;
  return end > span.ref_start
    ? `|x-ref="${span.ref_start}-${end}"`
    : `|x-ref="${span.ref_start}"`;
}

interface PreparedSpan {
  readonly marker: string;
  readonly start: number;
  readonly end: number;
  readonly attributes: string;
}

function prepareSpans(
  spans: readonly VerseSpan[] | undefined,
  wordCount: number,
  verseId: number,
  warn: (message: string) => void
): PreparedSpan[] {
  if (spans === undefined || spans.length === 0) {
    return [];
  }

  const prepared: PreparedSpan[] = [];
  for (const span of spans) {
    const marker = SPAN_TYPE_TO_USFM_MARKER[span.type];
    if (marker === undefined) {
      warn(`verse ${verseId}: span type "${span.type}" has no USFM equivalent and was dropped`);
      continue;
    }
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) {
      warn(`verse ${verseId}: span "${span.type}" has non-integer offsets and was dropped`);
      continue;
    }
    if (span.start < 0 || span.end < span.start || span.end >= wordCount) {
      warn(
        `verse ${verseId}: span "${span.type}" [${span.start}..${span.end}] falls outside the verse's ` +
          `${wordCount} word(s) and was dropped`
      );
      continue;
    }
    const attributes = formatRefAttribute(span);
    prepared.push({ marker, start: span.start, end: span.end, attributes });
  }

  // Deterministic nesting order: earliest start first, then longest, then by
  // marker name so equal ranges are stable.
  prepared.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    return a.marker < b.marker ? -1 : a.marker > b.marker ? 1 : 0;
  });
  return prepared;
}

/**
 * Render a verse's plain text with its spans applied as USFM character markers.
 *
 * Spans of different types routinely nest - `words_of_christ` commonly contains
 * `supplied` - and may also *partially* overlap, which no nesting-based markup
 * can express directly. Rather than reject or silently mangle those, the
 * renderer walks the verse word by word, maintaining the set of markers that
 * should be open, and closes and re-opens markers where a partial overlap
 * requires it. The result is always well-nested, valid USFM.
 */
export function renderVerseTextAsUsfm(
  text: string,
  spans: readonly VerseSpan[] | undefined,
  verseId = 0,
  warn: (message: string) => void = () => undefined
): string {
  const words = splitVerseWords(text);
  const prepared = prepareSpans(spans, words.length, verseId, warn);
  if (prepared.length === 0) {
    return words.join(' ');
  }

  let out = '';
  const open: PreparedSpan[] = [];

  const closeTo = (depth: number): void => {
    while (open.length > depth) {
      const span = open.pop()!;
      out += `${span.attributes}\\${span.marker}*`;
    }
  };

  for (let i = 0; i < words.length; i++) {
    const active = prepared.filter((span) => span.start <= i && i <= span.end);

    // Keep the longest prefix of what is already open that still applies here.
    let shared = 0;
    while (shared < open.length && shared < active.length && open[shared] === active[shared]) {
      shared++;
    }
    closeTo(shared);

    if (i > 0) {
      out += ' ';
    }
    for (let j = shared; j < active.length; j++) {
      const span = active[j]!;
      open.push(span);
      out += `\\${span.marker} `;
    }
    out += words[i];
  }
  closeTo(0);

  return out;
}

function poetryMarker(level: number): string | undefined {
  if (!Number.isInteger(level) || level < 1) {
    return undefined;
  }
  return `q${Math.min(level, 3)}`;
}

function emitBlockMarkers(block: VerseBlock | undefined, isFirstVerseOfChapter: boolean): string[] {
  const lines: string[] = [];
  const heading = block?.heading;
  const hasHeading = typeof heading === 'string' && heading.trim().length > 0;

  if (hasHeading) {
    const marker = readHeadingKind(block) === 'psalm_title' ? 'd' : 's';
    lines.push(`\\${marker} ${heading.trim()}`);
  }

  // Only the FIRST poetic line's marker goes here, ahead of `\v`; the rest are
  // emitted between the lines of verse text by `toUSFMBook`.
  const firstLine = block?.lines?.[0];
  const poetry = firstLine !== undefined ? poetryMarker(firstLine.level) : undefined;
  if (poetry !== undefined) {
    if (block?.paragraph_start === true && !isFirstVerseOfChapter && !hasHeading) {
      // A blank line separates poetic stanzas.
      lines.push('\\b');
    }
    lines.push(`\\${poetry}`);
    return lines;
  }

  if (block?.paragraph_start === true || isFirstVerseOfChapter || hasHeading) {
    // USFM text may not follow \c or \s directly; a paragraph marker is required.
    lines.push('\\p');
  }
  return lines;
}

/** One poetic line of a verse, rendered as USFM. */
interface RenderedLine {
  readonly level: PoetryLevel;
  readonly rendered: string;
}

/**
 * True when `lines` partitions `wordCount` words exactly: in order, no gaps, no
 * overlaps, covering the whole verse.
 *
 * A partial or inconsistent list cannot be rendered without either dropping words
 * or inventing them, so the caller falls back to one line instead.
 */
function isCoveringLineSet(lines: readonly PoetryLine[], wordCount: number): boolean {
  let next = 0;
  for (const line of lines) {
    if (line.start !== next || line.end < line.start) {
      return false;
    }
    next = line.end + 1;
  }
  return next === wordCount;
}

/**
 * Render a verse as one USFM string per poetic line.
 *
 * Each line is rendered independently over its own word range, with the verse's
 * spans clipped to that range and re-based to it. A span that straddles a line
 * boundary is therefore closed and re-opened across the break -- which is what
 * USFM requires anyway, since a character marker cannot span a paragraph marker.
 * `parseUSFM` merges the halves back on the way in.
 */
function renderPoetryLines(
  text: string,
  spans: readonly VerseSpan[] | undefined,
  poetryLines: readonly PoetryLine[],
  verseId: number,
  warn: (message: string) => void
): RenderedLine[] {
  const words = splitVerseWords(text);
  return poetryLines.map(line => {
    const lineText = words.slice(line.start, line.end + 1).join(' ');
    const clipped = (spans ?? [])
      .filter(span => span.end >= line.start && span.start <= line.end)
      .map(span => ({
        ...span,
        start: Math.max(span.start, line.start) - line.start,
        end: Math.min(span.end, line.end) - line.start
      }));
    return { level: line.level, rendered: renderVerseTextAsUsfm(lineText, clipped, verseId, warn) };
  });
}

/**
 * Export one book's verses as a single USFM document.
 *
 * @throws {UsfmExportError} if the rows span more than one book, if the book
 *   number is outside the 66-book canon, or if `verses` is empty.
 */
export function toUSFMBook(verses: readonly UsfmVerseInput[], options: ToUsfmOptions = {}): UsfmDocument {
  if (verses.length === 0) {
    throw new UsfmExportError('toUSFMBook requires at least one verse');
  }

  const first = parseVerseId(verses[0]!.verseId);
  for (const verse of verses) {
    const address = parseVerseId(verse.verseId);
    if (address.bookNumber !== first.bookNumber) {
      throw new UsfmExportError(
        `toUSFMBook requires all verses from a single book; found books ${first.bookNumber} and ${address.bookNumber}`
      );
    }
  }

  const book = getUsfmBookByNumber(first.bookNumber);
  if (book === undefined) {
    throw new UsfmExportError(
      `book number ${first.bookNumber} is outside the 66-book canon and has no USFM identifier`
    );
  }

  const eol = options.lineEnding ?? DEFAULT_LINE_ENDING;
  const warn = options.onWarning ?? ((): void => undefined);
  const bookName = resolveBookName(book, options.bookNames);

  const sorted = [...verses].sort((a, b) => a.verseId - b.verseId);
  const lines: string[] = [];

  const idParts = [book.code];
  const abbreviation = options.module?.abbreviation;
  const fullName = options.module?.fullName;
  if (abbreviation !== undefined && abbreviation.length > 0 && fullName !== undefined && fullName.length > 0) {
    idParts.push(`${abbreviation} - ${fullName}`);
  } else if (abbreviation !== undefined && abbreviation.length > 0) {
    idParts.push(abbreviation);
  } else if (fullName !== undefined && fullName.length > 0) {
    idParts.push(fullName);
  }
  lines.push(`\\id ${idParts.join(' ')}`);

  if (options.includeEncodingLine !== false) {
    lines.push('\\ide UTF-8');
  }
  const copyright = options.module?.copyright;
  if (options.includeCopyrightRemark === true && copyright !== undefined && copyright.length > 0) {
    lines.push(`\\rem ${copyright.replace(/\s+/gu, ' ').trim()}`);
  }
  lines.push(`\\h ${bookName}`);
  if (options.includeMainTitle !== false) {
    lines.push(`\\mt1 ${bookName}`);
  }

  let currentChapter = -1;
  for (const verse of sorted) {
    const address = parseVerseId(verse.verseId);
    const isFirstVerseOfChapter = address.chapter !== currentChapter;
    if (isFirstVerseOfChapter) {
      lines.push(`\\c ${address.chapter}`);
      currentChapter = address.chapter;
    }

    const block = verse.formatting?.block;
    for (const line of emitBlockMarkers(block, isFirstVerseOfChapter)) {
      lines.push(line);
    }

    const safeText = sanitizeText(verse.text, warn, verse.verseId);
    const poetryLines = block?.lines;
    const wordCount = splitVerseWords(safeText).length;

    if (poetryLines !== undefined && poetryLines.length > 1) {
      if (isCoveringLineSet(poetryLines, wordCount)) {
        const rendered = renderPoetryLines(safeText, verse.formatting?.spans, poetryLines, verse.verseId, warn);
        lines.push(`\\v ${address.verse} ${rendered[0]!.rendered}`.trimEnd());
        for (const line of rendered.slice(1)) {
          lines.push(`\\${poetryMarker(line.level) ?? 'q1'} ${line.rendered}`.trimEnd());
        }
        continue;
      }
      warn(
        `verse ${verse.verseId}: block.lines do not cover its ${wordCount} word(s) in order, ` +
          `so the verse was emitted as a single poetic line`
      );
    }

    const rendered = renderVerseTextAsUsfm(safeText, verse.formatting?.spans, verse.verseId, warn);
    lines.push(`\\v ${address.verse} ${rendered}`.trimEnd());
  }

  return {
    bookNumber: book.bookNumber,
    bookCode: book.code,
    bookName,
    fileName: usfmFileName(book),
    usfm: lines.join(eol) + eol
  };
}

/**
 * Export verses as one USFM document per book, in canonical book order.
 *
 * Verses may arrive in any order and may span any number of books.
 */
export function toUSFM(verses: readonly UsfmVerseInput[], options: ToUsfmOptions = {}): UsfmDocument[] {
  const byBook = new Map<number, UsfmVerseInput[]>();
  for (const verse of verses) {
    const { bookNumber } = parseVerseId(verse.verseId);
    const bucket = byBook.get(bookNumber);
    if (bucket !== undefined) {
      bucket.push(verse);
    } else {
      byBook.set(bookNumber, [verse]);
    }
  }

  return [...byBook.keys()]
    .sort((a, b) => a - b)
    .map((bookNumber) => toUSFMBook(byBook.get(bookNumber)!, options));
}
