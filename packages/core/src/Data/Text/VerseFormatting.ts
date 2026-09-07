/**
 * Verse formatting - the `bible_verse.formatting` JSON column.
 *
 * The stored verse `text` is clean canonical UTF-8: no markup, no pilcrows, no
 * leading/trailing whitespace, whitespace collapsed to single spaces. Everything
 * presentational lives here instead, as *data records naming ranges of words* -
 * never as inline markup.
 *
 * A consumer that only wants text can ignore this column entirely.
 *
 * ## Offset convention
 *
 * `start` / `end` are **word indices, 0-based, inclusive**. The word sequence is
 * produced by {@link splitVerseWords} - whitespace split of the clean `text`.
 * Because `text` has already been normalized (whitespace collapsed, markup and
 * pilcrows removed), that split is unambiguous and stable across re-imports.
 *
 * ## Extending the format
 *
 * Extend by adding **span type names**, never by adding presentational attributes.
 * A span says what a range of words *is*, not how to draw it. The renderer owns
 * the mapping from span type to appearance.
 */

/** Schema version of the `formatting` JSON payload. */
export const VERSE_FORMATTING_VERSION = 1;

/**
 * Span vocabulary. Names are plain-English and self-documenting; the USFM
 * equivalent is published in {@link SPAN_TYPE_USFM} for interoperability.
 */
export type VerseSpanType =
  /** YHWH rendered LORD/GOD. USFM `\nd`. Rendered as small caps. */
  | 'divine_name'
  /** Translator-supplied words with no counterpart in the source. USFM `\add`. Rendered italic. */
  | 'supplied'
  /** Words of Christ. USFM `\wj`. Rendered red. */
  | 'words_of_christ'
  /** Genuine emphasis present in the source text. USFM `\em`. */
  | 'emphasis'
  /** Old Testament quotation inside the New Testament. USFM `\qt`. Quoted passage in `ref_start`/`ref_end`. */
  | 'quotation'
  /** Transliterated (not translated) word. USFM `\tl`. Rendered italic. */
  | 'transliteration'
  /**
   * A musical or liturgical performance direction embedded in the poetic text --
   * "Selah", "Higgaion. Selah". USFM `\qs`.
   *
   * A span rather than a block flag, because USFM `\qs` is a *character* marker
   * wrapping the words themselves, the notation can appear mid-verse as well as
   * at the end, and more than one term occupies this role. The words are part of
   * the verse's `text` like any others; the span only says which they are.
   */
  | 'musical_direction';

/** Every recognized span type, in documentation order. */
export const VERSE_SPAN_TYPES: readonly VerseSpanType[] = [
  'divine_name',
  'supplied',
  'words_of_christ',
  'emphasis',
  'quotation',
  'transliteration',
  'musical_direction',
];

/** Span type -> USFM marker. Published so other tools can round-trip the format. */
export const SPAN_TYPE_USFM: Readonly<Record<VerseSpanType, string>> = {
  divine_name: '\\nd',
  supplied: '\\add',
  words_of_christ: '\\wj',
  emphasis: '\\em',
  quotation: '\\qt',
  transliteration: '\\tl',
  musical_direction: '\\qs',
};

/** Block-level property name -> USFM marker. */
export const BLOCK_USFM: Readonly<Record<string, string>> = {
  paragraph_start: '\\p',
  poetry_level_1: '\\q1',
  poetry_level_2: '\\q2',
  poetry_level_3: '\\q3',
  heading: '\\d',
};

/** Poetry indent level. 1 is the outermost line, 3 the most deeply indented. */
export type PoetryLevel = 1 | 2 | 3;

/**
 * One poetic line inside a verse: the words it covers and how far it is indented.
 *
 * A verse is not one line of poetry. Psalm 1:1 is three lines, and Isaiah
 * alternates between indent levels inside a single verse constantly:
 *
 *   \q1 The LORD is my shepherd;
 *   \q2 I shall not want.
 *
 * `start` / `end` are word indices, 0-based and inclusive, in the same space as
 * {@link VerseSpan}. Lines are ordered, do not overlap, and together cover every
 * word of the verse -- a consumer can therefore render the verse by walking them
 * in order without consulting the raw text for gaps.
 */
export interface PoetryLine {
  /** First word of the line. 0-based, inclusive. */
  readonly start: number;
  /** Last word of the line. 0-based, inclusive. */
  readonly end: number;
  /** Indent level 1-3. USFM `\q1`-`\q3`. */
  readonly level: PoetryLevel;
}

/**
 * A range of words carrying a semantic role.
 *
 * `start` and `end` are 0-based, inclusive word indices into
 * {@link splitVerseWords}`(text)`. A single-word span has `start === end`.
 */
export interface VerseSpan {
  readonly type: VerseSpanType;
  /** First word covered. 0-based, inclusive. */
  readonly start: number;
  /** Last word covered. 0-based, inclusive. */
  readonly end: number;
  /**
   * Only meaningful for `quotation`: the passage being quoted, as an INCLUSIVE
   * `verse_id` range. Quotations are routinely multi-verse -- Heb 8:8-12 quotes
   * Jer 31:31-34 -- so a single id cannot express them.
   *
   * The two fields travel together: both present or both absent, never one
   * without the other, and `ref_end >= ref_start`. A single-verse quotation is
   * `ref_end === ref_start`. Both omitted when the source is unknown.
   */
  readonly ref_start?: number;
  readonly ref_end?: number;
}

/**
 * Properties of the verse as a whole, rather than of a range of words.
 * Every field is optional; the object is omitted entirely when nothing applies.
 */
export interface VerseBlock {
  /** This verse begins a new paragraph. USFM `\p`. */
  readonly paragraph_start?: boolean;
  /**
   * The poetic lines this verse breaks into, in order. Omitted entirely for prose.
   *
   * This replaces a single `poetry_level` per verse, which could neither express a
   * line break inside a verse nor a change of indent across one -- and both are
   * ordinary in the Psalms and the Prophets. A verse that is one poetic line has
   * one entry here.
   */
  readonly lines?: readonly PoetryLine[];
  /** Superscription or section heading attached to this verse. USFM `\d` / `\s`. */
  readonly heading?: string;
  /**
   * Which kind of heading {@link heading} is. One USFM marker cannot express both:
   * `\d` is specifically a psalm/Hebrew *descriptive title*, so emitting it for a
   * section heading like "The Beatitudes" produces invalid USFM.
   *
   * Omitted when unknown - consumers default to `'section'`. A module converted from
   * Legacy HTML generally will not have it, since `<b>` was used ambiguously for both.
   */
  readonly heading_kind?: HeadingKind;
}

/** Which USFM heading marker {@link VerseBlock.heading} corresponds to. */
export type HeadingKind = 'section' | 'psalm_title';

/**
 * Provenance for a verse whose source numbered it differently from KJV versification.
 *
 * The canon is fixed to 66 books and standard English (KJV) versification, so a source
 * verse with no KJV address - e.g. Rev 12:18 in NHEB, which KJV numbers as Rev 13:1a, or
 * 3 John 15, which KJV folds into v14 - is merged into its canonical host verse at
 * conversion rather than dropped. This records what was merged, so the original
 * numbering can still be displayed and nothing about the source is lost.
 */
export interface SourceVerseRef {
  /** The verse number the source itself used, e.g. `18` for NHEB Rev 12:18. */
  readonly verse: number;
  /** Chapter in the source's numbering, when it differs from the host verse's. */
  readonly chapter?: number;
  /** Where the merged text sits within the host verse. */
  readonly position?: 'prefix' | 'suffix';
  /** Word range within the host verse that came from this source verse, 0-based inclusive. */
  readonly start?: number;
  readonly end?: number;
}

/** The `bible_verse.formatting` payload. */
export interface VerseFormatting {
  /** Schema version. Currently {@link VERSE_FORMATTING_VERSION}. */
  readonly v: number;
  readonly block?: VerseBlock;
  readonly spans?: readonly VerseSpan[];
  /**
   * Present only when this verse absorbed a source verse that KJV versification has no
   * address for. See {@link SourceVerseRef}. Absent for the overwhelming majority of
   * verses.
   */
  readonly source_verses?: readonly SourceVerseRef[];
}

/** Legacy `formatting_data` range. */
export interface LegacyFormattingRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The legacy `bible_verse.formatting_data` shape.
 *
 * Only three keys occur across all 53 shipped bible modules: `paragraph_start`
 * (always `false`), `added_words`, and `words_of_christ`. Its offsets are in the
 * *legacy* word space - see `normalizeVerseText` for the conversion.
 */
export interface LegacyFormattingData {
  readonly paragraph_start?: boolean;
  readonly added_words?: readonly LegacyFormattingRange[];
  readonly words_of_christ?: readonly LegacyFormattingRange[];
}

/** True when `value` is a recognized span type. */
export function isVerseSpanType(value: unknown): value is VerseSpanType {
  return typeof value === 'string' && (VERSE_SPAN_TYPES as readonly string[]).indexOf(value) !== -1;
}

/**
 * The canonical word tokenization for verse text.
 *
 * This single rule defines the space that every word offset in the format is
 * expressed in - `formatting.spans`, `user_text_markup`, and `interlinear_word`.
 * Because `text` is normalized first, the rule is simply "split on whitespace".
 */
export function splitVerseWords(text: string): string[] {
  const words: string[] = [];
  const matcher = /\S+/g;
  let match = matcher.exec(text);
  while (match !== null) {
    words.push(match[0]);
    match = matcher.exec(text);
  }
  return words;
}

/** An empty (but valid) formatting payload. */
export function createEmptyVerseFormatting(): VerseFormatting {
  return { v: VERSE_FORMATTING_VERSION };
}

/** True when the payload carries no block properties and no spans. */
export function isEmptyVerseFormatting(formatting: VerseFormatting): boolean {
  const hasSpans = formatting.spans !== undefined && formatting.spans.length > 0;
  const hasBlock = formatting.block !== undefined && Object.keys(formatting.block).length > 0;
  // `source_verses` counts as content on its own: a merged variant verse (e.g. NHEB
  // Rev 12:18 folded into Rev 13:1) may carry no spans and no block, and dropping the
  // payload would lose the only record that the merge happened.
  const hasSourceVerses =
    formatting.source_verses !== undefined && formatting.source_verses.length > 0;
  return !hasSpans && !hasBlock && !hasSourceVerses;
}

/**
 * Serialize for storage. Returns `null` when there is nothing worth storing, so
 * callers can write `NULL` into the column rather than a meaningless `{"v":1}`.
 */
export function stringifyVerseFormatting(formatting: VerseFormatting): string | null {
  return isEmptyVerseFormatting(formatting) ? null : JSON.stringify(formatting);
}

/**
 * Parse a stored `formatting` value defensively. Unknown span types, malformed
 * ranges, and non-object payloads are discarded rather than thrown, because a
 * bad annotation must never prevent a verse from being read.
 */
export function parseVerseFormatting(raw: string | null | undefined): VerseFormatting {
  if (raw === null || raw === undefined || raw === '') {
    return createEmptyVerseFormatting();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyVerseFormatting();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return createEmptyVerseFormatting();
  }
  const source = parsed as Record<string, unknown>;

  const spans: VerseSpan[] = [];
  const rawSpans = source['spans'];
  if (Array.isArray(rawSpans)) {
    for (const candidate of rawSpans) {
      const span = toVerseSpan(candidate);
      if (span !== undefined) {
        spans.push(span);
      }
    }
  }

  const block = toVerseBlock(source['block']);
  const sourceVerses = toSourceVerses(source['source_verses']);
  const version = typeof source['v'] === 'number' ? source['v'] : VERSE_FORMATTING_VERSION;

  return buildVerseFormatting(version, block, spans, sourceVerses);
}

/** Assemble a payload, omitting `block` / `spans` / `source_verses` when they carry nothing. */
export function buildVerseFormatting(
  version: number,
  block: VerseBlock | undefined,
  spans: readonly VerseSpan[],
  sourceVerses: readonly SourceVerseRef[] = []
): VerseFormatting {
  const hasBlock = block !== undefined && Object.keys(block).length > 0;
  const result: {
    v: number;
    block?: VerseBlock;
    spans?: readonly VerseSpan[];
    source_verses?: readonly SourceVerseRef[];
  } = { v: version };
  if (hasBlock) {
    result.block = block;
  }
  if (spans.length > 0) {
    result.spans = spans;
  }
  if (sourceVerses.length > 0) {
    result.source_verses = sourceVerses;
  }
  return result;
}

function toVerseSpan(candidate: unknown): VerseSpan | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  const type = record['type'];
  const start = record['start'];
  const end = record['end'];
  if (!isVerseSpanType(type)) {
    return undefined;
  }
  if (!isWordIndex(start) || !isWordIndex(end) || end < start) {
    return undefined;
  }
  const refStart = record['ref_start'];
  if (typeof refStart === 'number' && Number.isInteger(refStart) && refStart > 0) {
    // Be lenient on read: a payload carrying only `ref_start` is completed to a
    // single-verse range rather than discarded, so the reference still resolves.
    const refEnd = record['ref_end'];
    const resolvedEnd =
      typeof refEnd === 'number' && Number.isInteger(refEnd) && refEnd >= refStart ? refEnd : refStart;
    return { type, start, end, ref_start: refStart, ref_end: resolvedEnd };
  }
  return { type, start, end };
}

function toVerseBlock(candidate: unknown): VerseBlock | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  const block: {
    paragraph_start?: boolean;
    lines?: readonly PoetryLine[];
    heading?: string;
    heading_kind?: HeadingKind;
  } = {};
  if (record['paragraph_start'] === true) {
    block.paragraph_start = true;
  }
  const lines = toPoetryLines(record['lines']);
  if (lines.length > 0) {
    block.lines = lines;
  }
  const heading = record['heading'];
  if (typeof heading === 'string' && heading.length > 0) {
    block.heading = heading;
    // Only meaningful alongside a heading; a bare kind with no text is discarded.
    const kind = record['heading_kind'];
    if (kind === 'section' || kind === 'psalm_title') {
      block.heading_kind = kind;
    }
  }
  return Object.keys(block).length > 0 ? block : undefined;
}

/**
 * Read the poetic line list defensively. A malformed entry is dropped rather than
 * discarding the whole block, on the same principle as everything else here: a
 * bad annotation must never stop a verse from being read.
 */
function toPoetryLines(candidate: unknown): PoetryLine[] {
  if (!Array.isArray(candidate)) {
    return [];
  }
  const lines: PoetryLine[] = [];
  for (const entry of candidate) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const start = record['start'];
    const end = record['end'];
    const level = record['level'];
    if (!isWordIndex(start) || !isWordIndex(end) || end < start) {
      continue;
    }
    if (level !== 1 && level !== 2 && level !== 3) {
      continue;
    }
    lines.push({ start, end, level });
  }
  return lines;
}

/**
 * Read variant-verse provenance defensively. Malformed entries are dropped
 * individually rather than discarding the whole list.
 */
function toSourceVerses(candidate: unknown): SourceVerseRef[] {
  if (!Array.isArray(candidate)) {
    return [];
  }
  const result: SourceVerseRef[] = [];
  for (const entry of candidate) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const verse = record['verse'];
    if (typeof verse !== 'number' || !Number.isInteger(verse) || verse <= 0) {
      continue;
    }
    const ref: {
      verse: number;
      chapter?: number;
      position?: 'prefix' | 'suffix';
      start?: number;
      end?: number;
    } = { verse };
    const chapter = record['chapter'];
    if (typeof chapter === 'number' && Number.isInteger(chapter) && chapter > 0) {
      ref.chapter = chapter;
    }
    const position = record['position'];
    if (position === 'prefix' || position === 'suffix') {
      ref.position = position;
    }
    const start = record['start'];
    const end = record['end'];
    if (isWordIndex(start) && isWordIndex(end) && end >= start) {
      ref.start = start;
      ref.end = end;
    }
    result.push(ref);
  }
  return result;
}

function isWordIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
