/**
 * A reference decoder for the USFM subset that {@link toUSFM} produces.
 *
 * Scope, stated plainly: this is **not** a general-purpose USFM importer. It
 * understands the markers in the span and block vocabulary plus
 * the document scaffolding the exporter emits, and it ignores everything else.
 * Its purpose is twofold:
 *
 * 1. it makes the exporter's round trip verifiable without a database, and
 * 2. it gives an external integrator a worked, executable example of how the
 *    span model maps back out of USFM.
 *
 * Full USFM ingestion (footnotes, cross-reference notes, milestones, `\va`/`\vp`
 * alternate numbering) belongs to the module converter, not here.
 */

import { splitVerseWords } from '../Data/Text/VerseFormatting';
import type { PoetryLevel, PoetryLine, VerseFormatting, VerseSpan } from '../Data/Text/VerseFormatting';
import { mergeSpans } from '../Data/Text/normalizeVerseText';
import { getUsfmBookByCode } from './UsfmBookCodes';
import { USFM_MARKER_TO_SPAN_TYPE } from './toUSFM';
import { HeadingKind, VerseBlockWithHeadingKind } from './VerseFormatting';

/** Raised when the input is not a document this decoder can read. */
export class UsfmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsfmParseError';
  }
}

export interface ParsedUsfmVerse {
  verseId: number;
  text: string;
  formatting?: VerseFormatting;
}

export interface ParsedUsfmDocument {
  bookNumber: number;
  bookCode: string;
  bookName?: string;
  verses: ParsedUsfmVerse[];
}

export interface ParsedInlineUsfm {
  text: string;
  /**
   * Includes `\qs` Selah notations, which decode to a `musical_direction` span
   * like any other character marker rather than to a separate block flag.
   */
  spans: VerseSpan[];
}

const MARKER_RE = /\\([a-zA-Z0-9-]+)(\*?)/gu;

/**
 * Decode an `x-ref` attribute into an inclusive verse_id range. The attribute is
 * either a bare id (`x-ref="23007014"`) or a range (`x-ref="24031031-24031034"`);
 * a bare id decodes to a single-verse range.
 */
function parseRefAttribute(attributes: string): { start: number; end: number } | undefined {
  const match = /x-ref="(\d+)(?:-(\d+))?"/u.exec(attributes);
  if (match === null) {
    return undefined;
  }
  const start = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(start)) {
    return undefined;
  }
  const rawEnd = match[2];
  const end = rawEnd === undefined ? start : Number.parseInt(rawEnd, 10);
  return { start, end: Number.isFinite(end) && end >= start ? end : start };
}

interface OpenMarker {
  marker: string;
  startWord: number;
  attributes: string;
}

/**
 * Split a verse body into plain text plus 0-based inclusive word spans.
 */
export function parseInlineUsfm(raw: string): ParsedInlineUsfm {
  const spans: VerseSpan[] = [];
  const stack: OpenMarker[] = [];
  let plain = '';
  let cursor = 0;

  MARKER_RE.lastIndex = 0;
  let match = MARKER_RE.exec(raw);
  while (match !== null) {
    let literal = raw.slice(cursor, match.index);
    const isClosing = match[2] === '*';

    if (isClosing && stack.length > 0) {
      const pipe = literal.indexOf('|');
      if (pipe >= 0) {
        stack[stack.length - 1]!.attributes = literal.slice(pipe + 1);
        literal = literal.slice(0, pipe);
      }
    }
    plain += literal;

    cursor = match.index + match[0].length;
    if (isClosing) {
      const open = stack.pop();
      if (open !== undefined) {
        const end = splitVerseWords(plain).length - 1;
        const type = USFM_MARKER_TO_SPAN_TYPE[open.marker];
        if (type !== undefined && end >= open.startWord) {
          const ref = parseRefAttribute(open.attributes);
          const span: VerseSpan = ref === undefined
            ? { type, start: open.startWord, end }
            : { type, start: open.startWord, end, ref_start: ref.start, ref_end: ref.end };
          spans.push(span);
        }
      }
    } else {
      stack.push({ marker: match[1]!, startWord: splitVerseWords(plain).length, attributes: '' });
      if (raw[cursor] === ' ') {
        cursor += 1;
      }
    }

    MARKER_RE.lastIndex = cursor;
    match = MARKER_RE.exec(raw);
  }
  plain += raw.slice(cursor);

  spans.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  });
  return { text: plain.replace(/\s+/gu, ' ').trim(), spans };
}

interface PendingBlock {
  paragraphStart: boolean;
  poetryLevel?: PoetryLevel;
  heading?: string;
  headingKind?: HeadingKind;
}

/**
 * One line of a verse's body as it appeared in the document.
 *
 * A verse's text is not always one line: a poetic verse is broken across `\q`
 * markers, and each of those carries its own indent. `level` is the indent the
 * segment was introduced with, or `undefined` when the segment is prose.
 */
interface VerseSegment {
  raw: string;
  level?: PoetryLevel;
}

function emptyPending(): PendingBlock {
  return { paragraphStart: false };
}

function toPoetryLevel(value: number): PoetryLevel {
  return value <= 1 ? 1 : value >= 3 ? 3 : 2;
}

/**
 * Decode a verse's segments into clean text, verse-wide spans, and poetic lines.
 *
 * Each segment is parsed on its own and the results are shifted into the verse's
 * word space, which is what lets a `\q` break inside a verse become a
 * {@link PoetryLine} rather than being flattened away. Spans are merged
 * afterwards so a span the exporter had to close and re-open across a line break
 * comes back as the single span it started as.
 */
function decodeSegments(segments: readonly VerseSegment[]): {
  text: string;
  spans: VerseSpan[];
  lines: PoetryLine[];
} {
  const anyPoetry = segments.some(segment => segment.level !== undefined);
  const parts: string[] = [];
  const spans: VerseSpan[] = [];
  const lines: PoetryLine[] = [];
  let offset = 0;

  for (const segment of segments) {
    const parsed = parseInlineUsfm(segment.raw);
    const wordCount = splitVerseWords(parsed.text).length;
    if (wordCount === 0) {
      continue;
    }
    for (const span of parsed.spans) {
      spans.push({ ...span, start: span.start + offset, end: span.end + offset });
    }
    if (anyPoetry) {
      // A verse is either poetry or prose as a whole. A segment that arrived with
      // no marker of its own (the opening one, usually) takes level 1 so the line
      // list still covers every word.
      lines.push({ start: offset, end: offset + wordCount - 1, level: segment.level ?? 1 });
    }
    parts.push(parsed.text);
    offset += wordCount;
  }

  return {
    text: parts.join(' '),
    spans: segments.length > 1 ? mergeSpans(spans) : spans,
    lines
  };
}

function buildFormatting(
  pending: PendingBlock,
  spans: VerseSpan[],
  poetryLines: readonly PoetryLine[]
): VerseFormatting | undefined {
  const block: {
    paragraph_start?: boolean;
    lines?: readonly PoetryLine[];
    heading?: string;
    heading_kind?: HeadingKind;
  } = {};

  if (pending.paragraphStart) {
    block.paragraph_start = true;
  }
  if (poetryLines.length > 0) {
    block.lines = poetryLines;
  }
  if (pending.heading !== undefined) {
    block.heading = pending.heading;
    block.heading_kind = pending.headingKind ?? 'section';
  }
  const hasBlock = Object.keys(block).length > 0;
  if (!hasBlock && spans.length === 0) {
    return undefined;
  }

  const typedBlock: VerseBlockWithHeadingKind = block;
  if (hasBlock && spans.length > 0) {
    return { v: 1, block: typedBlock, spans };
  }
  if (hasBlock) {
    return { v: 1, block: typedBlock };
  }
  return { v: 1, spans };
}

/**
 * Decode a single-book USFM document produced by {@link toUSFM}.
 *
 * @throws {UsfmParseError} if there is no `\id` line, or its book identifier is
 *   not one of the 66 canonical books.
 */
export function parseUSFM(usfm: string): ParsedUsfmDocument {
  const lines = usfm.split(/\r?\n/u);

  let bookNumber = -1;
  let bookCode = '';
  let bookName: string | undefined;
  let chapter = 0;
  let pending = emptyPending();
  const verses: ParsedUsfmVerse[] = [];
  let currentSegments: VerseSegment[] | undefined;
  let currentVerseNumber = 0;
  let currentPending = emptyPending();

  const flushVerse = (): void => {
    if (currentSegments === undefined) {
      return;
    }
    const { text, spans, lines } = decodeSegments(currentSegments);
    const verseId = bookNumber * 1000000 + chapter * 1000 + currentVerseNumber;
    const formatting = buildFormatting(currentPending, spans, lines);
    const verse: ParsedUsfmVerse = formatting === undefined
      ? { verseId, text }
      : { verseId, text, formatting };
    verses.push(verse);
    currentSegments = undefined;
  };

  /** Append continuation text to the segment currently being built. */
  const appendToCurrentSegment = (fragment: string): void => {
    const last = currentSegments?.[currentSegments.length - 1];
    if (last !== undefined) {
      last.raw += ` ${fragment}`;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (!line.startsWith('\\')) {
      // Continuation of the previous verse's text.
      appendToCurrentSegment(line);
      continue;
    }

    const spaceIndex = line.indexOf(' ');
    const marker = (spaceIndex === -1 ? line.slice(1) : line.slice(1, spaceIndex)).toLowerCase();
    const rest = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1).trim();

    switch (marker) {
      case 'id': {
        const code = rest.split(/\s+/u)[0] ?? '';
        const book = getUsfmBookByCode(code);
        if (book === undefined) {
          throw new UsfmParseError(`unrecognized USFM book identifier "${code}"`);
        }
        bookNumber = book.bookNumber;
        bookCode = book.code;
        break;
      }
      case 'h':
      case 'h1':
        bookName = rest;
        break;
      case 'c': {
        flushVerse();
        const parsed = Number.parseInt(rest, 10);
        if (!Number.isFinite(parsed)) {
          throw new UsfmParseError(`invalid chapter marker: "${line}"`);
        }
        chapter = parsed;
        // The first verse of a chapter is implicitly a paragraph start: USFM text
        // may not follow \c directly, so the exporter always emits a paragraph
        // marker there.
        pending = emptyPending();
        pending.paragraphStart = true;
        break;
      }
      case 'v': {
        flushVerse();
        const verseSpace = rest.indexOf(' ');
        const numberPart = verseSpace === -1 ? rest : rest.slice(0, verseSpace);
        const parsed = Number.parseInt(numberPart, 10);
        if (!Number.isFinite(parsed)) {
          throw new UsfmParseError(`invalid verse marker: "${line}"`);
        }
        currentVerseNumber = parsed;
        currentSegments = [
          {
            raw: verseSpace === -1 ? '' : rest.slice(verseSpace + 1),
            ...(pending.poetryLevel !== undefined ? { level: pending.poetryLevel } : {})
          }
        ];
        currentPending = pending;
        pending = emptyPending();
        break;
      }
      case 'b':
        flushVerse();
        pending.paragraphStart = true;
        break;
      case 'd':
        flushVerse();
        pending.heading = rest;
        pending.headingKind = 'psalm_title';
        break;
      default: {
        if (/^s\d?$/u.test(marker)) {
          flushVerse();
          pending.heading = rest;
          pending.headingKind = 'section';
        } else if (/^q\d?$/u.test(marker)) {
          const level = toPoetryLevel(marker.length === 1 ? 1 : Number.parseInt(marker.slice(1), 10));
          if (rest.length > 0 && currentSegments !== undefined) {
            // `\q2 I shall not want.` -- a further poetic line of the verse that is
            // already open, not the start of a new one. This is what the exporter
            // emits for every line after the first.
            currentSegments.push({ raw: rest, level });
          } else {
            // A bare `\q1` line introduces the NEXT verse's first line.
            flushVerse();
            pending.poetryLevel = level;
          }
        } else if (/^(p|m|pi\d?|mi|pc|pr|cls|nb)$/u.test(marker)) {
          flushVerse();
          pending.paragraphStart = true;
        } else if (currentSegments !== undefined) {
          // An unrecognized *line-initial* marker inside a verse: keep the text.
          appendToCurrentSegment(rest);
        }
        break;
      }
    }
  }
  flushVerse();

  if (bookNumber === -1) {
    throw new UsfmParseError('document has no \\id line, so its book cannot be determined');
  }

  return bookName === undefined
    ? { bookNumber, bookCode, verses }
    : { bookNumber, bookCode, bookName, verses };
}
