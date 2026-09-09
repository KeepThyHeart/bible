/**
 * Legacy verse text normalizer.
 *
 * Converts the presentational HTML found in v1 `bible_verse.text` into clean
 * canonical UTF-8 plus a structured {@link VerseFormatting} payload.
 *
 * This is a **pure function**: no database access, no I/O, no globals, no
 * dependence on call order. It is written to be run by the Pass-2 converter
 * against every shipped module, and is unit-tested against fixture strings
 * extracted from real shipped verses.
 *
 * ## The legacy offset base (verified against all 53 shipped bible modules)
 *
 * `formatting_data` offsets are **0-based and inclusive**, but they index a
 * *different word sequence* than the one a reader sees: the legacy converter
 * replaced every HTML tag with a space before splitting on whitespace. So
 * `The L<font size="-1">ORD</font> <i>is</i> my shepherd` tokenizes as
 * `The | L | ORD | is | my | shepherd`, and `is` lands at index 3 - which looks
 * 1-based against the rendered text but is not. `words_of_christ` uses the exact
 * same rule; the two annotation kinds never disagreed.
 *
 * The normalizer therefore does not apply a constant shift. It rebuilds both
 * token sequences in one pass and maps legacy indices through to clean word
 * indices. Emitted offsets are always 0-based inclusive over
 * {@link splitVerseWords}`(text)`.
 */

import {
  buildVerseFormatting,
  splitVerseWords,
  VERSE_FORMATTING_VERSION,
  type LegacyFormattingData,
  type VerseBlock,
  type VerseFormatting,
  type VerseSpan,
  type VerseSpanType,
} from './VerseFormatting';

/** Result of normalizing one verse. */
export interface NormalizedVerse {
  /** Clean canonical UTF-8: no markup, no pilcrows, whitespace collapsed and trimmed. */
  readonly text: string;
  /** Structured formatting with 0-based inclusive word offsets. */
  readonly formatting: VerseFormatting;
}

/** Anything a caller might hand us for the legacy `formatting_data` column. */
export type LegacyFormattingInput =
  | string
  | LegacyFormattingData
  | Readonly<Record<string, unknown>>
  | null
  | undefined;

const PILCROW = '¶';

/**
 * Tags whose *content* is not part of the verse text. Only the SWORD footnote
 * marker (`<sup class="n">*n</sup>`, 6 occurrences across all shipped modules)
 * qualifies; everything else keeps its content.
 */
const FOOTNOTE_MARKER_ATTR = /\bclass\s*=\s*["']?n["']?/i;

const TAG_MATCHER = /<[^<>]*>/g;
const PARAGRAPH_OPEN_TAG = /^<!\s*p\s*>$/i;
const PARAGRAPH_CLOSE_TAG = /^<!\s*\/\s*p\s*>$/i;
const CLOSE_TAG = /^<\s*\/\s*([a-z][a-z0-9]*)\s*>$/i;
const OPEN_TAG = /^<\s*([a-z][a-z0-9]*)([^>]*)>$/i;
const VOID_TAG_NAMES = ['br', 'hr', 'img', 'wbr', 'meta', 'link'];

/**
 * Tags that separate lines or blocks. They contribute a space to the clean text,
 * because the shipped data relies on them for word separation:
 * `written:<br />K<small>ING OF</small>` must not collapse to `written:KING`.
 * Inline tags (`<i>`, `<font>`, `<small>`, `<a>`) contribute nothing, because
 * `L<font size="-1">ORD</font>` must stay one word.
 */
const LAYOUT_TAG_NAMES = ['br', 'hr', 'p', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th', 'blockquote'];

const RED_COLOR = /\bcolor\s*=\s*["']?\s*(?:red|#ff0000|#f00)\b/i;
const SMALL_SIZE = /\bsize\s*=\s*["']?\s*-/i;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};
const ENTITY_MATCHER = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

type TagKind = 'open' | 'close' | 'void' | 'paragraph' | 'ignore';

interface TagInfo {
  readonly kind: TagKind;
  readonly name: string;
  readonly span: VerseSpanType | undefined;
  readonly dropContent: boolean;
  /** The tag separates lines/blocks, so it contributes a space to the clean text. */
  readonly layoutBreak: boolean;
}

interface OpenFrame {
  readonly name: string;
  readonly span: VerseSpanType | undefined;
  readonly dropContent: boolean;
  readonly cleanStart: number;
}

interface ClosedRun {
  readonly span: VerseSpanType;
  readonly cleanStart: number;
  readonly cleanEnd: number;
}

/** One source character that survived tag stripping, in *legacy* token space. */
interface LegacyUnit {
  readonly isWhitespace: boolean;
  /** Index into the clean text, or -1 when the character was dropped. */
  readonly cleanIndex: number;
  /** A tag boundary occurred immediately before this character. */
  readonly breakBefore: boolean;
}

interface LegacyRangeInput {
  readonly type: VerseSpanType;
  readonly start: number;
  readonly end: number;
}

/**
 * Normalize one legacy verse.
 *
 * @param rawText        the v1 `bible_verse.text` value (presentational HTML)
 * @param legacyFormatting  the v1 `bible_verse.formatting_data` value, as a JSON
 *                       string or an already-parsed object. Optional: the HTML in
 *                       `rawText` is authoritative and reproduces it, but any
 *                       range it carries is merged in so nothing is lost.
 */
export function normalizeVerseText(
  rawText: string,
  legacyFormatting?: LegacyFormattingInput
): NormalizedVerse {
  const scan = scanRawText(rawText);
  const text = scan.text;
  const wordOfChar = buildWordIndex(text);

  const spans: VerseSpan[] = [];
  for (const run of scan.runs) {
    const range = toWordRange(run.cleanStart, run.cleanEnd, text.length, wordOfChar);
    if (range !== undefined) {
      spans.push({ type: run.span, start: range[0], end: range[1] });
    }
  }

  const legacy = readLegacyFormatting(legacyFormatting);
  const paragraphStart = scan.paragraphStart || legacy.paragraphStart;

  if (legacy.ranges.length > 0) {
    const tokenWords = mapLegacyTokensToWords(scan.legacyUnits, wordOfChar);
    for (const range of legacy.ranges) {
      const start = tokenWords[range.start];
      const end = tokenWords[range.end];
      if (start === undefined || end === undefined || start < 0 || end < 0 || end < start) {
        continue;
      }
      spans.push({ type: range.type, start, end });
    }
  }

  const block: VerseBlock | undefined = paragraphStart ? { paragraph_start: true } : undefined;

  return {
    text,
    formatting: buildVerseFormatting(VERSE_FORMATTING_VERSION, block, mergeSpans(spans)),
  };
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

interface ScanResult {
  readonly text: string;
  readonly runs: readonly ClosedRun[];
  readonly legacyUnits: readonly LegacyUnit[];
  readonly paragraphStart: boolean;
}

function scanRawText(rawText: string): ScanResult {
  const cleanChars: string[] = [];
  const legacyUnits: LegacyUnit[] = [];
  const frames: OpenFrame[] = [];
  const runs: ClosedRun[] = [];

  let dropDepth = 0;
  let paragraphStart = false;
  let sawVisible = false;
  let pendingBreak = false;

  const emit = (ch: string): void => {
    const whitespace = isWhitespaceChar(ch);
    let cleanIndex = -1;
    if (whitespace) {
      if (cleanChars.length > 0 && cleanChars[cleanChars.length - 1] !== ' ') {
        cleanChars.push(' ');
      }
    } else if (ch === PILCROW) {
      if (!sawVisible) {
        paragraphStart = true;
      }
    } else if (dropDepth === 0) {
      cleanIndex = cleanChars.length;
      cleanChars.push(ch);
      sawVisible = true;
    }
    legacyUnits.push({ isWhitespace: whitespace, cleanIndex, breakBefore: pendingBreak });
    pendingBreak = false;
  };

  /**
   * A line/block separator contributes a space to the clean text but no legacy
   * unit - the legacy tokenizer already breaks at every tag boundary.
   */
  const emitLayoutSpace = (): void => {
    if (cleanChars.length > 0 && cleanChars[cleanChars.length - 1] !== ' ') {
      cleanChars.push(' ');
    }
  };

  const emitChunk = (chunk: string): void => {
    if (chunk.length === 0) {
      return;
    }
    for (const ch of decodeEntities(chunk)) {
      emit(ch);
    }
  };

  const closeFrame = (frame: OpenFrame): void => {
    if (frame.span !== undefined) {
      runs.push({ span: frame.span, cleanStart: frame.cleanStart, cleanEnd: cleanChars.length - 1 });
    }
  };

  TAG_MATCHER.lastIndex = 0;
  let cursor = 0;
  let match = TAG_MATCHER.exec(rawText);
  while (match !== null) {
    emitChunk(rawText.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const info = parseTag(match[0]);
    if (info.layoutBreak) {
      emitLayoutSpace();
    }
    if (info.kind === 'paragraph') {
      if (!sawVisible) {
        paragraphStart = true;
      }
    } else if (info.kind === 'open') {
      frames.push({
        name: info.name,
        span: info.span,
        dropContent: info.dropContent,
        cleanStart: cleanChars.length,
      });
      if (info.dropContent) {
        dropDepth++;
      }
    } else if (info.kind === 'close') {
      const index = lastIndexOfFrame(frames, info.name);
      if (index >= 0) {
        const frame = frames[index] as OpenFrame;
        frames.splice(index, 1);
        if (frame.dropContent) {
          dropDepth--;
        }
        closeFrame(frame);
      }
    }

    // Every tag boundary inserted a space in the legacy token space.
    pendingBreak = true;
    match = TAG_MATCHER.exec(rawText);
  }
  emitChunk(rawText.slice(cursor));

  // Unclosed tags are closed at end of verse.
  while (frames.length > 0) {
    const frame = frames.pop() as OpenFrame;
    if (frame.dropContent) {
      dropDepth--;
    }
    closeFrame(frame);
  }

  if (cleanChars.length > 0 && cleanChars[cleanChars.length - 1] === ' ') {
    cleanChars.pop();
  }

  return { text: cleanChars.join(''), runs, legacyUnits, paragraphStart };
}

function lastIndexOfFrame(frames: readonly OpenFrame[], name: string): number {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame !== undefined && frame.name === name) {
      return i;
    }
  }
  // `</font>` also closes `<font ...>` variants opened under a different spelling;
  // the name comparison above already handles that since all fonts share the name.
  return -1;
}

// ---------------------------------------------------------------------------
// Tag classification
// ---------------------------------------------------------------------------

function parseTag(raw: string): TagInfo {
  if (PARAGRAPH_OPEN_TAG.test(raw)) {
    return { kind: 'paragraph', name: '!p', span: undefined, dropContent: false, layoutBreak: true };
  }
  if (PARAGRAPH_CLOSE_TAG.test(raw)) {
    return { kind: 'ignore', name: '!/p', span: undefined, dropContent: false, layoutBreak: true };
  }

  const closeMatch = CLOSE_TAG.exec(raw);
  if (closeMatch !== null) {
    const name = (closeMatch[1] as string).toLowerCase();
    return { kind: 'close', name, span: undefined, dropContent: false, layoutBreak: isLayoutTag(name) };
  }

  const openMatch = OPEN_TAG.exec(raw);
  if (openMatch === null) {
    return { kind: 'ignore', name: '', span: undefined, dropContent: false, layoutBreak: false };
  }

  const name = (openMatch[1] as string).toLowerCase();
  const attrs = openMatch[2] ?? '';
  const layoutBreak = isLayoutTag(name);
  if (VOID_TAG_NAMES.indexOf(name) !== -1 || /\/\s*$/.test(attrs)) {
    return { kind: 'void', name, span: undefined, dropContent: false, layoutBreak };
  }

  return {
    kind: 'open',
    name,
    span: spanForTag(name, attrs),
    dropContent: name === 'sup' && FOOTNOTE_MARKER_ATTR.test(attrs),
    layoutBreak,
  };
}

function isLayoutTag(name: string): boolean {
  return LAYOUT_TAG_NAMES.indexOf(name) !== -1;
}

/**
 * Tag -> span mapping, derived from a full inventory of the 29 distinct tag
 * strings present across all 53 shipped bible modules.
 *
 * Deliberately unmapped (content kept, no span): `<small>` (presentational small
 * caps that is *not* the divine name - e.g. ISV's "BABYLON THE GREAT"), `<sup>`
 * (ABP word-order numerals), `<a>`, `<ul>`, `<li>`, `<br>`.
 */
function spanForTag(name: string, attrs: string): VerseSpanType | undefined {
  switch (name) {
    case 'i':
      return 'supplied';
    case 'em':
    case 'b':
    case 'strong':
      return 'emphasis';
    case 'cite':
    case 'q':
      return 'quotation';
    case 'font':
      if (RED_COLOR.test(attrs)) {
        return 'words_of_christ';
      }
      if (SMALL_SIZE.test(attrs)) {
        return 'divine_name';
      }
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Word indexing
// ---------------------------------------------------------------------------

/** For each character of `text`, the index of the word it belongs to, or -1. */
function buildWordIndex(text: string): number[] {
  const wordOfChar: number[] = new Array<number>(text.length).fill(-1);
  const matcher = /\S+/g;
  let wordIndex = 0;
  let match = matcher.exec(text);
  while (match !== null) {
    for (let i = match.index; i < match.index + match[0].length; i++) {
      wordOfChar[i] = wordIndex;
    }
    wordIndex++;
    match = matcher.exec(text);
  }
  return wordOfChar;
}

function toWordRange(
  cleanStart: number,
  cleanEnd: number,
  textLength: number,
  wordOfChar: readonly number[]
): [number, number] | undefined {
  const start = Math.max(0, cleanStart);
  const end = Math.min(textLength - 1, cleanEnd);
  let first = -1;
  let last = -1;
  for (let i = start; i <= end; i++) {
    const word = wordOfChar[i];
    if (word !== undefined && word >= 0) {
      if (first < 0) {
        first = word;
      }
      last = word;
    }
  }
  return first < 0 ? undefined : [first, last];
}

/**
 * Rebuild the legacy token sequence (tags replaced by a space, split on
 * whitespace) and map each legacy token index to the clean word index it landed
 * on. A token made entirely of dropped characters (a lone pilcrow, for example)
 * maps forward to the next surviving word.
 */
function mapLegacyTokensToWords(
  units: readonly LegacyUnit[],
  wordOfChar: readonly number[]
): number[] {
  const tokenWords: number[] = [];
  let i = 0;
  while (i < units.length) {
    const unit = units[i];
    if (unit === undefined || unit.isWhitespace) {
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < units.length) {
      const next = units[i];
      if (next === undefined || next.isWhitespace || next.breakBefore) {
        break;
      }
      i++;
    }
    tokenWords.push(resolveTokenWord(units, start, wordOfChar));
  }
  return tokenWords;
}

function resolveTokenWord(
  units: readonly LegacyUnit[],
  start: number,
  wordOfChar: readonly number[]
): number {
  for (let i = start; i < units.length; i++) {
    const unit = units[i];
    if (unit === undefined || unit.cleanIndex < 0) {
      continue;
    }
    const word = wordOfChar[unit.cleanIndex];
    if (word !== undefined && word >= 0) {
      return word;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Legacy formatting_data
// ---------------------------------------------------------------------------

interface LegacyReadResult {
  readonly paragraphStart: boolean;
  readonly ranges: readonly LegacyRangeInput[];
}

const LEGACY_KEY_TO_SPAN: Readonly<Record<string, VerseSpanType>> = {
  added_words: 'supplied',
  words_of_christ: 'words_of_christ',
};

function readLegacyFormatting(input: LegacyFormattingInput): LegacyReadResult {
  const source = toRecord(input);
  if (source === undefined) {
    return { paragraphStart: false, ranges: [] };
  }

  const ranges: LegacyRangeInput[] = [];
  for (const key of Object.keys(LEGACY_KEY_TO_SPAN)) {
    const type = LEGACY_KEY_TO_SPAN[key];
    const value = source[key];
    if (type === undefined || !Array.isArray(value)) {
      continue;
    }
    for (const candidate of value) {
      if (typeof candidate !== 'object' || candidate === null) {
        continue;
      }
      const record = candidate as Record<string, unknown>;
      const start = record['start'];
      const end = record['end'];
      if (!isNonNegativeInteger(start) || !isNonNegativeInteger(end) || end < start) {
        continue;
      }
      ranges.push({ type, start, end });
    }
  }

  return { paragraphStart: source['paragraph_start'] === true, ranges };
}

function toRecord(input: LegacyFormattingInput): Record<string, unknown> | undefined {
  if (input === null || input === undefined) {
    return undefined;
  }
  if (typeof input === 'string') {
    if (input.trim() === '') {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return undefined;
    }
    return isPlainObject(parsed) ? parsed : undefined;
  }
  return isPlainObject(input) ? input : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Span merging
// ---------------------------------------------------------------------------

/**
 * Canonicalize the span list: merge overlapping or touching spans that share a
 * type (and `ref`), then sort by start, end, type.
 *
 * Merging matters because the legacy HTML frequently splits one logical run
 * across several tags - `<i>the L</i><i>ord</i>`, or a red-letter quotation
 * broken at every `<br />`. Merging also makes the output independent of whether
 * the caller supplied `formatting_data`, since the two sources produce the same
 * ranges.
 */
export function mergeSpans(spans: readonly VerseSpan[]): VerseSpan[] {
  const buckets = new Map<string, VerseSpan[]>();
  for (const span of spans) {
    // '|' cannot occur in a span type name or a numeric verse id, so it is an
    // unambiguous separator. (It replaces a literal NUL, which worked but made
    // the whole file register as binary and vanish from grep.)
    const key = `${span.type}|${span.ref_start ?? ''}|${span.ref_end ?? ''}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [span]);
    } else {
      bucket.push(span);
    }
  }

  const merged: VerseSpan[] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.start - b.start || a.end - b.end);
    let current: VerseSpan | undefined;
    for (const span of bucket) {
      if (current === undefined) {
        current = span;
        continue;
      }
      if (span.start <= current.end + 1) {
        if (span.end > current.end) {
          current = { ...current, end: span.end };
        }
      } else {
        merged.push(current);
        current = span;
      }
    }
    if (current !== undefined) {
      merged.push(current);
    }
  }

  merged.sort((a, b) => a.start - b.start || a.end - b.end || a.type.localeCompare(b.type));
  return merged;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

function isWhitespaceChar(ch: string): boolean {
  if (/\s/.test(ch)) {
    return true;
  }
  const code = ch.codePointAt(0);
  // Stray control characters (U+000F occurs in shipped modules) behave as breaks.
  return code !== undefined && code < 0x20;
}

function decodeEntities(chunk: string): string {
  if (chunk.indexOf('&') === -1) {
    return chunk;
  }
  ENTITY_MATCHER.lastIndex = 0;
  return chunk.replace(ENTITY_MATCHER, (whole: string, body: string): string => {
    if (body.charAt(0) === '#') {
      const isHex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}
