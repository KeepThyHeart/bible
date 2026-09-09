/**
 * Common types used throughout the data layer
 */

/**
 * Verse ID format: (book_number * 1000000) + (chapter * 1000) + verse
 * Example: John 3:16 = 43003016
 */
export type VerseId = number;

/**
 * Bible book enumeration
 * Uses 1-based indexing matching the standard Protestant Bible order
 */
export enum Book {
  // Old Testament - Law (Torah/Pentateuch)
  Genesis = 1,
  Exodus = 2,
  Leviticus = 3,
  Numbers = 4,
  Deuteronomy = 5,

  // Old Testament - Historical Books
  Joshua = 6,
  Judges = 7,
  Ruth = 8,
  FirstSamuel = 9,
  SecondSamuel = 10,
  FirstKings = 11,
  SecondKings = 12,
  FirstChronicles = 13,
  SecondChronicles = 14,
  Ezra = 15,
  Nehemiah = 16,
  Esther = 17,

  // Old Testament - Wisdom/Poetry
  Job = 18,
  Psalms = 19,
  Proverbs = 20,
  Ecclesiastes = 21,
  SongOfSolomon = 22,

  // Old Testament - Major Prophets
  Isaiah = 23,
  Jeremiah = 24,
  Lamentations = 25,
  Ezekiel = 26,
  Daniel = 27,

  // Old Testament - Minor Prophets
  Hosea = 28,
  Joel = 29,
  Amos = 30,
  Obadiah = 31,
  Jonah = 32,
  Micah = 33,
  Nahum = 34,
  Habakkuk = 35,
  Zephaniah = 36,
  Haggai = 37,
  Zechariah = 38,
  Malachi = 39,

  // New Testament - Gospels
  Matthew = 40,
  Mark = 41,
  Luke = 42,
  John = 43,

  // New Testament - History
  Acts = 44,

  // New Testament - Pauline Epistles
  Romans = 45,
  FirstCorinthians = 46,
  SecondCorinthians = 47,
  Galatians = 48,
  Ephesians = 49,
  Philippians = 50,
  Colossians = 51,
  FirstThessalonians = 52,
  SecondThessalonians = 53,
  FirstTimothy = 54,
  SecondTimothy = 55,
  Titus = 56,
  Philemon = 57,

  // New Testament - General Epistles
  Hebrews = 58,
  James = 59,
  FirstPeter = 60,
  SecondPeter = 61,
  FirstJohn = 62,
  SecondJohn = 63,
  ThirdJohn = 64,
  Jude = 65,

  // New Testament - Apocalyptic
  Revelation = 66
}

/**
 * Book number type - can be either the Book enum or a raw number
 */
export type BookNumber = Book | number;

// ============================================================================
// Open enums - single source of truth
// ============================================================================
//
// SQLite cannot alter a CHECK constraint, so an "open" set of values trapped in
// one is unfixable without rebuilding the table. The schemas therefore DROP
// the CHECK constraints for the value sets below and move validation here.
//
// Closed sets fixed by the domain (`testament`, `content_format`, boolean 0/1
// flags such as `right_to_left`) keep their CHECK constraints in SQL and
// are NOT validated here.
//
// Enforce these at the repository boundary - i.e. validate on write, and be
// lenient on read so an unexpected value in an already-shipped module surfaces
// as data rather than a crash.

/** Error thrown when a value fails an open-enum validation at the repository boundary. */
export class InvalidEnumValueError extends Error {
  constructor(
    public readonly enumName: string,
    public readonly value: unknown,
    public readonly allowed: readonly string[]
  ) {
    super(
      `Invalid ${enumName} value ${JSON.stringify(value)}. Allowed: ${allowed.join(', ')}`
    );
    this.name = 'InvalidEnumValueError';
  }
}

/** Build a `(is, assert)` validator pair for a closed string union. */
function enumValidators<T extends string>(enumName: string, values: readonly T[]): {
  is: (value: unknown) => value is T;
  assert: (value: unknown) => T;
} {
  const allowed = new Set<string>(values);
  const is = (value: unknown): value is T =>
    typeof value === 'string' && allowed.has(value);
  const assert = (value: unknown): T => {
    if (!is(value)) {
      throw new InvalidEnumValueError(enumName, value, values);
    }
    return value;
  };
  return { is, assert };
}

/**
 * Module types recognised by the application.
 *
 * `tag_graph` is a first-class module type (models and build script exist).
 *
 * Deliberately NOT module types: `semantic_*.db` and `enrichments_*.db`. Those
 * are app-private caches that sit outside the published module contract - they
 * carry no `module_info`, are never registered in `module_metadata`, and must
 * not be validated as modules.
 */
export const MODULE_TYPES = [
  'bible',
  'commentary',
  'dictionary',
  'book',
  'devotional',
  'lexicon',
  'topical_index',
  'cross_reference',
  'tag_graph'
] as const;

/** Module types supported by the application. */
export type ModuleType = (typeof MODULE_TYPES)[number];

const moduleTypeValidator = enumValidators('module_type', MODULE_TYPES);
export const isModuleType = moduleTypeValidator.is;
export const assertModuleType = moduleTypeValidator.assert;

/** Dictionary sub-types (`module_info.dictionary_type`). */
export const DICTIONARY_TYPES = [
  'strongs',
  'greek_lexicon',
  'hebrew_lexicon',
  'bible_dictionary',
  'topical'
] as const;
export type DictionaryType = (typeof DICTIONARY_TYPES)[number];
const dictionaryTypeValidator = enumValidators('dictionary_type', DICTIONARY_TYPES);
export const isDictionaryType = dictionaryTypeValidator.is;
export const assertDictionaryType = dictionaryTypeValidator.assert;

/** User note types (`user_note.note_type`). */
export const NOTE_TYPES = [
  'verse_note',
  'document',
  'sermon',
  'study',
  'journal',
  'prayer'
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
const noteTypeValidator = enumValidators('note_type', NOTE_TYPES);
export const isNoteType = noteTypeValidator.is;
export const assertNoteType = noteTypeValidator.assert;

/** Pinned-item types (`pinned_item.item_type`). */
export const ITEM_TYPES = [
  'verse',
  'passage',
  'note',
  'commentary',
  'dictionary_entry',
  'book_section',
  'image'
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
const itemTypeValidator = enumValidators('item_type', ITEM_TYPES);
export const isItemType = itemTypeValidator.is;
export const assertItemType = itemTypeValidator.assert;

/**
 * Known cross-reference relationship types (`cross_reference.relationship_type`).
 *
 * This is a genuinely OPEN set - that is precisely why the CHECK constraint is
 * dropped. {@link isRelationshipType} accepts any well-formed token so that a
 * module publisher can introduce a new relationship without a schema change;
 * {@link RELATIONSHIP_TYPES} documents the vocabulary we ship.
 */
export const RELATIONSHIP_TYPES = [
  'parallel',
  'quote',
  'theme',
  'prophecy_fulfillment',
  'allusion',
  'contrast'
] as const;
export type KnownRelationshipType = (typeof RELATIONSHIP_TYPES)[number];
/** Open union: the known vocabulary plus any well-formed extension token. */
export type RelationshipType = KnownRelationshipType | (string & {});

/** Token shape shared by all open extension enums: `lower_snake_case`. */
const EXTENSION_TOKEN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** True if the value is a well-formed relationship type token. */
export function isRelationshipType(value: unknown): value is RelationshipType {
  return typeof value === 'string' && EXTENSION_TOKEN.test(value);
}

/** Validate a relationship type, throwing if it is not a well-formed token. */
export function assertRelationshipType(value: unknown): RelationshipType {
  if (!isRelationshipType(value)) {
    throw new InvalidEnumValueError(
      'relationship_type',
      value,
      [...RELATIONSHIP_TYPES, '<lower_snake_case extension>']
    );
  }
  return value;
}

/** Reading plan types (`reading_plan.plan_type`). */
export const PLAN_TYPES = [
  'canonical',
  'chronological',
  'thematic',
  'nt_only',
  'ot_only',
  'gospels',
  'custom'
] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
/** @deprecated Use {@link PlanType}. Retained for source compatibility. */
export type ReadingPlanType = PlanType;
const planTypeValidator = enumValidators('plan_type', PLAN_TYPES);
export const isPlanType = planTypeValidator.is;
export const assertPlanType = planTypeValidator.assert;

/** Saved-search types (`saved_search.search_type`). */
export const SEARCH_TYPES = [
  'multi-word',
  'phrase',
  'proximity',
  'verse-proximity',
  'boolean',
  'fuzzy',
  'regex',
  'strongs'
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
const searchTypeValidator = enumValidators('search_type', SEARCH_TYPES);
export const isSearchType = searchTypeValidator.is;
export const assertSearchType = searchTypeValidator.assert;

/** Verse-link kinds (`verse_link.link_type`). */
export const LINK_TYPES = [
  'reference',
  'annotation',
  'primary_passage',
  'cross_reference'
] as const;
export type LinkType = (typeof LINK_TYPES)[number];
const linkTypeValidator = enumValidators('link_type', LINK_TYPES);
export const isLinkType = linkTypeValidator.is;
export const assertLinkType = linkTypeValidator.assert;

/**
 * What a `verse_link` row hangs off (`verse_link.source_type`).
 * One value per content table that can reference scripture.
 */
export const SOURCE_TYPES = [
  'commentary_entry',
  'book_section',
  'dictionary_entry',
  'devotional_entry',
  'topic',
  'note',
  'journal',
  'prayer',
  // Additional sources
  'verse',                  // bible module shipping publisher cross-references
  'cross_reference_group',  // xref module: the phrase group owning the targets
  'entity_facet',           // tag graph: the only integer-keyed link source
  'user_data_item'          // generic user store: a module's own verse metadata
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
const sourceTypeValidator = enumValidators('source_type', SOURCE_TYPES);
export const isSourceType = sourceTypeValidator.is;
export const assertSourceType = sourceTypeValidator.assert;

/** Commentary entry granularity (`commentary_entry.entry_level`). */
export const ENTRY_LEVELS = ['book', 'chapter', 'passage', 'verse'] as const;
export type EntryLevel = (typeof ENTRY_LEVELS)[number];
const entryLevelValidator = enumValidators('entry_level', ENTRY_LEVELS);
export const isEntryLevel = entryLevelValidator.is;
export const assertEntryLevel = entryLevelValidator.assert;

// ============================================================================
// Closed enums - these keep their SQL CHECK constraints
// ============================================================================

/**
 * Bible testaments
 */
export type Testament = 'OT' | 'NT';

/**
 * Content formats for user-generated content
 */
export type ContentFormat = 'html' | 'markdown' | 'plain';

/**
 * Visibility levels
 */
export type Visibility = 'private' | 'public';

/**
 * Highlight colour *names*.
 *
 * Storage is hex `#RRGGBB` (matching `collection.color`); these six
 * names remain the UI palette. See `Core/Colors.ts` for the name<->hex mapping and
 * {@link normalizeMarkupColor} for the read path that accepts both.
 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'purple' | 'orange';

/**
 * Underline styles
 */
export type UnderlineStyle = 'solid' | 'wavy' | 'dotted' | 'dashed';

/**
 * Markup type
 */
export type MarkupType = 'highlight' | 'underline' | 'both';

/**
 * Prayer item status
 */
export type PrayerStatus = 'active' | 'answered' | 'ongoing' | 'archived';

/**
 * Session status
 */
export type SessionStatus = 'active' | 'paused' | 'completed';

/**
 * Metadata JSON container for extensible data
 */
export type Metadata = Record<string, unknown>;

// ============================================================================
// vvv RANGE CONVENTION - SINGLE NORMATIVE STATEMENT vvv
// ============================================================================
//
// This block is the ONE place the verse-range convention is defined for the
// data layer. Every other file references it rather than restating it, so a
// change here is a single edit rather than a dozen.
//
//   * Column spelling is `verse_id_start` / `verse_id_end`.
//     Never `start_verse_id` / `end_verse_id`.
//   * `verse_id_start` is INCLUSIVE.
//   * `verse_id_end` is INCLUSIVE.
//   * A single verse is `verse_id_end = verse_id_start`. NOT NULL (R-1).
//
// R-1: `verse_id_end` is NOT NULL wherever the range is
//   mandatory. Every containment query is therefore uniform --
//   `verse_id_start <= X AND verse_id_end >= X` -- with no `OR verse_id_end IS
//   NULL` branch whose omission silently drops single-verse rows (the majority).
//
//   Where the ANCHOR ITSELF is optional -- `user_note` (a note need not point at
//   scripture), `pinned_item`, `commentary_entry` (book/chapter-level entries
//   comment on no verse range) -- BOTH columns are nullable together. Never one
//   without the other. So the invariant is:
//
//       (start IS NULL AND end IS NULL) OR (start IS NOT NULL AND end IS NOT NULL)
//
//   Reads still go through {@link resolveRangeEnd}: older databases predate this
//   rule and legitimately carry NULL ends, and the user database is migrated in
//   place rather than regenerated.
//
// ============================================================================

/**
 * Normalise an inclusive range end to a concrete verse ID.
 *
 * Returns `start` when `end` is null/undefined (the "single verse" encoding),
 * otherwise `end`. Use this everywhere instead of branching on NULL, so the
 * range convention can change in one place.
 */
export function resolveRangeEnd(start: VerseId, end: VerseId | null | undefined): VerseId {
  return end ?? start;
}

/**
 * The write-side companion to {@link resolveRangeEnd}, for tables whose verse
 * anchor is OPTIONAL (`user_note`, `pinned_item`, `commentary_entry`).
 *
 * Those tables keep both range columns nullable, but only together:
 *
 *     (start IS NULL AND end IS NULL) OR (start IS NOT NULL AND end IS NOT NULL)
 *
 * A half-populated row (start set, end NULL) is the exact shape R-1 exists to
 * eliminate, so writers pass their start/end through here rather than emitting
 * `?? null` for each column independently.
 */
export function resolveOptionalRangeEnd(
  start: VerseId | null | undefined,
  end: VerseId | null | undefined
): VerseId | null {
  if (start === null || start === undefined) return null;
  return end ?? start;
}

/**
 * Verse reference range (in-memory).
 *
 * Semantics per the range convention block above. The property names here
 * predate the convention and are used pervasively across packages as an
 * in-memory range type; they carry exactly the same meaning as the canonical
 * `verse_id_start` / `verse_id_end` columns.
 */
export interface VerseRange {
  startVerseId: VerseId;
  endVerseId?: VerseId;
}

/**
 * A range of words within a verse.
 *
 * **Word offset convention: 0-based and inclusive.** `start` is the
 * index of the first word, `end` the index of the last word (so a single word
 * has `start === end`). This matches `user_text_markup` (the only offset field
 * with live user data), JS array indexing in the renderer, and the `formatting`
 * span offsets. `interlinear_word` moves from 1-based to 0-based in v2.
 */
export interface WordRange {
  start: number;
  end: number;
}

/**
 * Verse reference with book/chapter/verse components
 */
export interface VerseReference {
  bookNumber: number;
  chapter: number;
  verse: number;
}

/**
 * Helper class for verse ID calculations
 */
export class VerseIdHelper {
  /**
   * Calculate verse ID from components
   * Format: (book_number * 1000000) + (chapter * 1000) + verse
   *
   * @example
   * ```typescript
   * // Using book number
   * const id1 = VerseIdHelper.calculate(43, 3, 16); // John 3:16
   *
   * // Using Book enum
   * const id2 = VerseIdHelper.calculate(Book.John, 3, 16); // John 3:16
   * ```
   */
  static calculate(book: BookNumber, chapter: number, verse: number): VerseId {
    const bookNumber = typeof book === 'number' ? book : book as number;
    return bookNumber * 1000000 + chapter * 1000 + verse;
  }

  /**
   * Parse verse ID into components
   */
  static parse(verseId: VerseId): VerseReference {
    const bookNumber = Math.floor(verseId / 1000000);
    const remainder = verseId % 1000000;
    const chapter = Math.floor(remainder / 1000);
    const verse = remainder % 1000;

    return { bookNumber, chapter, verse };
  }

  /**
   * Format verse ID as a human-readable string (requires book name lookup)
   */
  static format(verseId: VerseId): string {
    const { bookNumber, chapter, verse } = this.parse(verseId);
    return `${bookNumber}:${chapter}:${verse}`;
  }

  /**
   * Check if a verse ID is valid
   */
  static isValid(verseId: VerseId): boolean {
    // The integer guard matters: without it a fractional id like 43003016.7
    // parses to a plausible book/chapter/verse and passes.
    if (!Number.isInteger(verseId)) return false;
    const { bookNumber, chapter, verse } = this.parse(verseId);
    return bookNumber >= 1 && bookNumber <= 66 && chapter >= 1 && verse >= 1;
  }

  /**
   * Get verse range from start to end chapter
   *
   * @example
   * ```typescript
   * // Using book number
   * const range1 = VerseIdHelper.getChapterRange(43, 3); // John 3
   *
   * // Using Book enum
   * const range2 = VerseIdHelper.getChapterRange(Book.John, 3); // John 3
   * ```
   */
  static getChapterRange(book: BookNumber, chapter: number): VerseRange {
    return {
      startVerseId: this.calculate(book, chapter, 1),
      endVerseId: this.calculate(book, chapter, 999)
    };
  }

  /**
   * Get book name from Book enum value
   */
  static getBookName(book: Book): string {
    return Book[book];
  }

  /**
   * Get Book enum from book number
   */
  static getBookEnum(bookNumber: number): Book | undefined {
    if (bookNumber >= 1 && bookNumber <= 66) {
      return bookNumber as Book;
    }
    return undefined;
  }

  /**
   * Format a verse range as a human-readable reference string.
   * Accepts a book name lookup function or Map to resolve book numbers to names.
   *
   * @example
   * ```typescript
   * const bookNames = new Map([[43, 'John'], [45, 'Romans']]);
   * VerseIdHelper.formatReference(43003016, 43003016, bookNames); // "John 3:16"
   * VerseIdHelper.formatReference(43003016, 43003018, bookNames); // "John 3:16-18"
   * VerseIdHelper.formatReference(43003016, 43004005, bookNames); // "John 3:16 - 4:5"
   * ```
   */
  static formatReference(
    startVerseId: VerseId,
    endVerseId: VerseId,
    bookNames: Map<number, string> | ((bookNum: number) => string)
  ): string {
    const start = this.parse(startVerseId);
    const resolveName = typeof bookNames === 'function'
      ? bookNames
      : (num: number) => bookNames.get(num) || `Book ${num}`;
    const bookName = resolveName(start.bookNumber);

    if (startVerseId === endVerseId) {
      return `${bookName} ${start.chapter}:${start.verse}`;
    }

    const end = this.parse(endVerseId);
    if (start.chapter === end.chapter) {
      return `${bookName} ${start.chapter}:${start.verse}-${end.verse}`;
    }
    return `${bookName} ${start.chapter}:${start.verse} - ${end.chapter}:${end.verse}`;
  }
}
