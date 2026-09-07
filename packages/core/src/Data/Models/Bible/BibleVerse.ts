import { VerseId, Metadata, WordRange } from '../../Core/Types';
import {
  PoetryLine,
  VerseFormatting,
  VerseSpan,
  createEmptyVerseFormatting,
  buildVerseFormatting,
  normalizeVerseText,
  splitVerseWords,
  type NormalizedVerse
} from '../../Text';

/**
 * Legacy `formatting_data` shape as consumed by the current renderer.
 *
 * @deprecated Use {@link VerseFormatting} (`bible_verse.formatting`) - plain
 * text plus structured word-range spans. This interface survives only because
 * several services outside the data layer (`VerseFormatter`, `BibleTextService`,
 * `BibleViewService`, the extension DTOs, and the desktop / web renderers) read
 * it directly. Delete it once those move to {@link BibleVerse.formatting}.
 */
export interface FormattingData {
  paragraphStart?: boolean;
  poetry?: {
    isPoetry: boolean;
    indentLevel?: number;
  };
  wordsOfChrist?: Array<{ start: number; end: number }>;
  addedWords?: Array<{ start: number; end: number }>;
  /**
   * Word ranges covering the Tetragrammaton, conventionally displayed in small
   * caps ("LORD"/"GOD"). Sources vary in how they encode it: OSIS modules mark
   * it up as `<divineName>` (which the converter turns into a `divine_name`
   * span, leaving the literal text in whatever case the source used - the
   * CrossWire KJV writes "Lord"), while some modules bake the capitals straight
   * into the text and carry no span at all. Rendering applies the casing, so
   * both conventions come out identical on screen.
   */
  divineName?: Array<{ start: number; end: number }>;
  sectionHeading?: string;
  footnotes?: Array<{
    position: number;
    marker: string;
    text: string;
  }>;
  crossReferences?: Array<{
    position: number;
    marker: string;
    references: VerseId[];
  }>;
}

/**
 * Bible verse entity from a Bible module database.
 *
 * ## Text representation
 *
 * `text` is clean canonical UTF-8 and is already plain - there is no separate
 * plain-text column. Structured formatting lives in the `formatting` column as
 * a {@link VerseFormatting} payload.
 *
 * The deprecated `formattingData` field is projected from `formatting` so
 * renderers that have not moved over yet keep working.
 *
 * Word offsets are **0-based and inclusive**.
 */
export class BibleVerse {
  verseId: VerseId;

  /**
   * Verse text as stored: clean canonical UTF-8.
   */
  text: string;

  /**
   * Plain verse text.
   *
   * @deprecated Use {@link text} - it is already clean UTF-8 - or
   * {@link getPlainText}. There is no `text_plain` column; the repository keeps
   * this field populated (equal to `text`) so consumers outside `@bible/core`
   * compile and behave unchanged.
   */
  textPlain?: string;

  /**
   * Structured formatting (`bible_verse.formatting`).
   *
   * Always present - an empty payload (`{ v: 1 }`) when the verse carries no
   * formatting at all, so callers never need a null check.
   */
  formatting: VerseFormatting;

  /**
   * The legacy `formatting_data` shape, projected from {@link formatting} so
   * existing renderers keep working unchanged.
   *
   * @deprecated Read {@link formatting} instead. `VerseFormatter`,
   * `BibleTextService`, `BibleViewService`, `Extensions/ExtensionApiDtos` and
   * the desktop/web renderers consume spans.
   */
  formattingData?: FormattingData;

  /** Number of whitespace-delimited words in `text`; span indices run 0..wordCount-1. */
  wordCount?: number;

  metadata?: Metadata;

  constructor(data: {
    verseId: VerseId;
    text: string;
    textPlain?: string;
    formatting?: VerseFormatting;
    formattingData?: FormattingData;
    wordCount?: number;
    metadata?: Metadata;
  }) {
    this.verseId = data.verseId;
    this.text = data.text;
    this.textPlain = data.textPlain;
    this.wordCount = data.wordCount;
    this.metadata = data.metadata;

    // Fill in whichever representation the caller did not supply, so both
    // legacy and structured consumers see the same verse.
    if (data.formatting !== undefined) {
      this.formatting = data.formatting;
      this.formattingData = data.formattingData ?? projectToLegacy(data.formatting);
    } else if (data.formattingData !== undefined) {
      this.formattingData = data.formattingData;
      this.formatting = projectBlockToStructured(data.formattingData, this.text);
    } else {
      this.formatting = createEmptyVerseFormatting();
      this.formattingData = undefined;
    }
  }

  /**
   * Get readable plain text.
   *
   * Returns `text`, which is already clean.
   */
  getPlainText(): string {
    return this.textPlain ?? this.text.replace(/<[^>]*>/g, '');
  }

  /**
   * Clean text plus rebased 0-based spans.
   *
   * Runs the text through the spans normalizer. Callers get a new value; the
   * entity is not mutated.
   */
  toNormalized(): NormalizedVerse {
    return normalizeVerseText(this.text, {
      paragraph_start: this.legacyField<boolean>('paragraphStart', 'paragraph_start'),
      added_words: this.legacyAddedWords(),
      words_of_christ: this.legacyWordsOfChrist()
    });
  }

  /**
   * Read a key from the legacy payload, accepting both spellings.
   *
   * `formatting_data` is inconsistent: `paragraph_start`, `added_words` and
   * `words_of_christ` are snake_case while `sectionHeading` is camelCase.
   */
  private legacyField<T>(camel: string, snake: string): T | undefined {
    const fd = this.formattingData as Record<string, unknown> | undefined;
    return (fd?.[camel] ?? fd?.[snake]) as T | undefined;
  }

  /** Check if this verse starts a paragraph */
  isParagraphStart(): boolean {
    return (
      this.formatting.block?.paragraph_start ??
      this.legacyField<boolean>('paragraphStart', 'paragraph_start') ??
      false
    );
  }

  /** Check if this verse is poetry */
  isPoetry(): boolean {
    if ((this.formatting.block?.lines?.length ?? 0) > 0) return true;
    return this.formattingData?.poetry?.isPoetry ?? false;
  }

  /**
   * The poetic lines this verse breaks into, in order. Empty for prose.
   *
   * A verse is routinely more than one line and the indent can change between
   * them, so this -- not {@link getPoetryIndent} -- is what a renderer should
   * walk.
   */
  getPoetryLines(): readonly PoetryLine[] {
    return this.formatting.block?.lines ?? [];
  }

  /**
   * Opening indent level, or `0` for prose.
   *
   * A convenience for callers that only need the verse's overall shape. It
   * reports the FIRST line's level and says nothing about the rest; use
   * {@link getPoetryLines} to render.
   */
  getPoetryIndent(): number {
    return this.formatting.block?.lines?.[0]?.level ?? this.formattingData?.poetry?.indentLevel ?? 0;
  }

  /** Check if this verse has words of Christ */
  hasWordsOfChrist(): boolean {
    if (this.spansOfType('words_of_christ').length > 0) return true;
    return (this.legacyWordsOfChrist()?.length ?? 0) > 0;
  }

  /** Legacy words-of-Christ ranges, under either key spelling. */
  private legacyWordsOfChrist(): ReadonlyArray<{ start: number; end: number }> | undefined {
    return this.legacyField<Array<{ start: number; end: number }>>('wordsOfChrist', 'words_of_christ');
  }

  /** Legacy translator-supplied ranges, under either key spelling. */
  private legacyAddedWords(): ReadonlyArray<{ start: number; end: number }> | undefined {
    return this.legacyField<Array<{ start: number; end: number }>>('addedWords', 'added_words');
  }

  /** All spans of a given type, in stored order. */
  spansOfType(type: VerseSpan['type']): readonly VerseSpan[] {
    return (this.formatting.spans ?? []).filter(s => s.type === type);
  }

  /** Word ranges (0-based, inclusive) covered by spans of a given type. */
  wordRangesOfType(type: VerseSpan['type']): WordRange[] {
    return this.spansOfType(type).map(s => ({ start: s.start, end: s.end }));
  }

  /** Check if this verse has a section heading */
  hasSectionHeading(): boolean {
    return this.getSectionHeading() !== undefined;
  }

  /** Get section heading */
  getSectionHeading(): string | undefined {
    if (this.formatting.block?.heading !== undefined) return this.formatting.block.heading;
    return this.legacyField<string>('sectionHeading', 'section_heading');
  }

  /**
   * Get footnotes.
   *
   * Footnotes have no `formatting` representation yet; they are still read from
   * the legacy payload.
   */
  getFootnotes(): Array<{ position: number; marker: string; text: string }> {
    return this.formattingData?.footnotes ?? [];
  }

  /**
   * Get cross-references embedded in the formatting payload.
   *
   * Publisher cross-references live in the unified `verse_link` table
   * (`source_type='verse'`, `link_type='cross_reference'`); this accessor
   * remains for the legacy payload.
   */
  getCrossReferences(): Array<{ position: number; marker: string; references: VerseId[] }> {
    return this.formattingData?.crossReferences ?? [];
  }
}

/**
 * Project the structured payload down to the legacy shape so consumers that
 * still read {@link FormattingData} keep working.
 */
function projectToLegacy(formatting: VerseFormatting): FormattingData | undefined {
  const legacy: FormattingData = {};
  const block = formatting.block;

  if (block?.paragraph_start !== undefined) legacy.paragraphStart = block.paragraph_start;
  const firstLine = block?.lines?.[0];
  if (firstLine !== undefined) {
    // The legacy shape has room for one indent per verse, so it records the
    // opening line's. Nothing reads it back into `lines`.
    legacy.poetry = { isPoetry: true, indentLevel: firstLine.level };
  }
  if (block?.heading !== undefined) legacy.sectionHeading = block.heading;

  const spans = formatting.spans ?? [];
  const woc = spans.filter(s => s.type === 'words_of_christ').map(s => ({ start: s.start, end: s.end }));
  const added = spans.filter(s => s.type === 'supplied').map(s => ({ start: s.start, end: s.end }));
  const divine = spans.filter(s => s.type === 'divine_name').map(s => ({ start: s.start, end: s.end }));
  if (woc.length > 0) legacy.wordsOfChrist = woc;
  if (added.length > 0) legacy.addedWords = added;
  if (divine.length > 0) legacy.divineName = divine;

  return Object.keys(legacy).length > 0 ? legacy : undefined;
}

/**
 * Project the *offset-free* parts of a legacy payload up to the structured shape.
 *
 * Deliberately does NOT carry `added_words` / `words_of_christ` across: those
 * offsets are expressed against the HTML word sequence with an inconsistent
 * base, so copying them into spans would produce confidently-wrong ranges.
 * {@link BibleVerse.toNormalized} performs the real conversion.
 */
function projectBlockToStructured(legacy: FormattingData, text: string): VerseFormatting {
  const raw = legacy as Record<string, unknown>;
  const block: {
    paragraph_start?: boolean;
    lines?: readonly PoetryLine[];
    heading?: string;
  } = {};

  // Shipped payloads mix camelCase and snake_case keys; accept either.
  if ((raw.paragraphStart ?? raw.paragraph_start) === true) block.paragraph_start = true;
  const indent = legacy.poetry?.isPoetry ? legacy.poetry.indentLevel ?? 1 : undefined;
  if (indent === 1 || indent === 2 || indent === 3) {
    // The legacy shape carries one indent and no line breaks, so the most it can
    // say is "this whole verse is one poetic line at this indent". Inventing
    // breaks it never recorded would be worse than under-describing it.
    const wordCount = splitVerseWords(text).length;
    if (wordCount > 0) {
      block.lines = [{ start: 0, end: wordCount - 1, level: indent }];
    }
  }
  const heading = (raw.sectionHeading ?? raw.section_heading) as string | undefined;
  if (heading !== undefined && heading !== '') {
    block.heading = heading;
  }

  return buildVerseFormatting(
    createEmptyVerseFormatting().v,
    Object.keys(block).length > 0 ? block : undefined,
    []
  );
}

/** One word range of an interlinear alignment. 0-based, inclusive. */
export interface InterlinearWordSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Decode `interlinear_word.extra_word_positions`.
 *
 * The stored form is a comma-separated list of ranges -- `"12-14,18"` -- where a
 * bare index means a single word. Malformed entries are skipped rather than
 * thrown, on the same principle as `parseVerseFormatting`: a bad annotation must
 * never stop a verse from being read.
 */
export function parseWordPositionList(raw: string | null | undefined): InterlinearWordSpan[] {
  if (raw === null || raw === undefined || raw === '') {
    return [];
  }
  const spans: InterlinearWordSpan[] = [];
  for (const entry of raw.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/u.exec(entry);
    if (match === null) {
      continue;
    }
    const start = Number.parseInt(match[1]!, 10);
    const rawEnd = match[2];
    const end = rawEnd === undefined ? start : Number.parseInt(rawEnd, 10);
    if (end < start) {
      continue;
    }
    spans.push({ start, end });
  }
  return spans;
}

/**
 * Encode extra alignment ranges for storage. Returns `null` for an empty list, so
 * callers write NULL rather than an empty string -- NULL is the "contiguous"
 * signal that lets a reader skip parsing entirely.
 */
export function stringifyWordPositionList(spans: readonly InterlinearWordSpan[]): string | null {
  if (spans.length === 0) {
    return null;
  }
  return spans.map(span => (span.end === span.start ? `${span.start}` : `${span.start}-${span.end}`)).join(',');
}

/**
 * Interlinear word entity (for original language texts).
 *
 * **Word offsets are 0-based and inclusive**: `wordPositionStart` is the
 * index of the first word covered and `wordPositionEnd` the last, so a single
 * word has `start === end`.
 * (`CHECK (word_position_start > 0)`); the shipped modules all store 0-based
 * values matching this declaration, so there is no legacy data to rebase.
 *
 * They index the verse's whitespace-separated **English** word sequence - the
 * same index space `user_text_markup.text_start` / `text_end` (highlights,
 * underlines) and `formatting.spans` (words-of-christ, supplied) use. That is
 * verified against every shipped module by
 * `scripts/verify-interlinear-alignment.js`, and is what lets the desktop
 * interlinear view render each English word as an individually highlightable
 * span (`apps/desktop/src/ui/components/study/interlinearCells.ts`).
 *
 * Eight shipped bible modules populate `interlinear_word` (abp, asv, bsb,
 * darby, kjv, kjva, rlt, rwebster) - roughly 2.9M rows in total. An earlier
 * revision of this comment claimed none did; that was wrong.
 */
export class InterlinearWord {
  interlinearId?: number;
  verseId: VerseId;
  /** First word covered. 0-based, inclusive. */
  wordPositionStart: number;
  /** Last word covered. 0-based, inclusive; equal to start for a single word. */
  wordPositionEnd: number;
  /**
   * The original-language surface form. Optional: `original_word` is a
   * nullable column and the shipped modules leave it NULL for the entire OT
   * (Hebrew), carrying only `strongsNumber`/`lemma`/`gloss` there.
   */
  originalWord?: string;
  transliteration?: string;
  strongsNumber?: string;
  morphology?: string;
  lemma?: string;
  /**
   * Short out-of-context equivalent in the module's own language, e.g.
   * `logos` -> "word, speech". Not the rendering this translation chose, and not
   * a definition. May be absent when the module leaves glossing to a lexicon.
   */
  gloss?: string;
  /**
   * The SECOND and subsequent word ranges this original word aligns to, when the
   * alignment is discontiguous -- Greek `ou me` -> English "not ... at all".
   * Decoded from `interlinear_word.extra_word_positions`.
   *
   * Empty for the overwhelming majority of words, whose whole alignment is
   * `wordPositionStart`..`wordPositionEnd`. Prefer {@link getWordSpans} over
   * reading the start/end pair directly, which silently ignores these.
   */
  extraSpans: InterlinearWordSpan[];
  metadata?: Metadata;

  constructor(data: {
    interlinearId?: number;
    verseId: VerseId;
    wordPositionStart: number;
    wordPositionEnd: number;
    originalWord?: string;
    transliteration?: string;
    strongsNumber?: string;
    morphology?: string;
    lemma?: string;
    gloss?: string;
    extraSpans?: InterlinearWordSpan[];
    metadata?: Metadata;
  }) {
    this.interlinearId = data.interlinearId;
    this.verseId = data.verseId;
    this.wordPositionStart = data.wordPositionStart;
    this.wordPositionEnd = data.wordPositionEnd;
    this.originalWord = data.originalWord;
    this.transliteration = data.transliteration;
    this.strongsNumber = data.strongsNumber;
    this.morphology = data.morphology;
    this.lemma = data.lemma;
    this.gloss = data.gloss;
    this.extraSpans = data.extraSpans ?? [];
    this.metadata = data.metadata;
  }

  /**
   * Every word range this original word aligns to, in order: the row's own range
   * first, then any {@link extraSpans}.
   */
  getWordSpans(): InterlinearWordSpan[] {
    return [{ start: this.wordPositionStart, end: this.wordPositionEnd }, ...this.extraSpans];
  }

  /** True when the alignment is split across non-adjacent word ranges. */
  isDiscontiguous(): boolean {
    return this.extraSpans.length > 0;
  }

  /** The covered word range, 0-based and inclusive. */
  wordRange(): WordRange {
    return { start: this.wordPositionStart, end: this.wordPositionEnd };
  }

  /**
   * Check if this is a single word (not a phrase)
   */
  isSingleWord(): boolean {
    return this.wordPositionStart === this.wordPositionEnd;
  }

  /**
   * Check if this word has Strong's number
   */
  hasStrongsNumber(): boolean {
    return this.strongsNumber !== undefined;
  }

  /**
   * Get the language (Hebrew or Greek) based on Strong's number prefix
   */
  getLanguage(): 'Hebrew' | 'Greek' | 'Unknown' {
    if (!this.strongsNumber) return 'Unknown';
    if (this.strongsNumber.startsWith('H')) return 'Hebrew';
    if (this.strongsNumber.startsWith('G')) return 'Greek';
    return 'Unknown';
  }
}
