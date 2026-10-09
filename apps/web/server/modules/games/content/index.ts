/**
 * Everything a game module is allowed to know about content.
 *
 * A game asks for verses and questions; it must never learn that one of those
 * lives in a third-party file opened read only and the other in a database the
 * server writes. Keeping both behind one object is what lets a module be
 * swapped, a question set be re-imported, or the whole layer be pointed at a
 * temp directory in a test, without a single game changing.
 *
 * Two ways in, on purpose:
 *
 * - `ContentLibrary.open({ ... })` builds an isolated library. Tests and
 *   tooling use this; nothing is shared and the caller closes it.
 * - the bare functions below use one process-wide library built from
 *   `config`, opened on first use. The server has exactly one modules
 *   directory and one content database, and threading that through every
 *   round-building call would be ceremony with no reader.
 *
 * Every draw takes the caller's `random`. A room seeds its own generator, so a
 * room replayed from its intent log draws the same verses and the same
 * questions in the same order — which is the difference between a timing bug
 * that reproduces in a unit test and one that does not.
 */

import { join } from 'node:path';
import { config } from '../config.js';
import { ModuleCatalog } from './ModuleCatalog.js';
import { ContentDatabase } from './ContentDatabase.js';
import type { Verse, VerseFilter, VerseSource } from './BibleModule.js';
import type { TranslationCatalog, TranslationSummary } from './ModuleCatalog.js';
import type {
  Audience,
  ContentFilter,
  OrderedListRecord,
  PromptCardRecord,
  QuestionFilter,
  QuestionRecord,
  QuestionSetRecord,
} from './ContentDatabase.js';
import type { SectionName, VerseId } from '../../../../src/modules/games/shared/verseId.js';
import type { Familiarity } from '../../../../src/modules/games/shared/protocol.js';

export interface ContentOptions {
  /** Directory of Bible modules. Defaults to the configured one. */
  moduleDir?: string;
  /** The authored-content database file. `:memory:` is honoured. */
  contentPath?: string;
  /** Which translation the verse helpers use when the caller names none. */
  defaultTranslation?: string;
}

/** A prompt card filtered by the category a host picked, e.g. `parable`. */
export type PromptCardFilter = ContentFilter & { category?: string };

/**
 * What each familiarity means in pool tiers.
 *
 * A room draws from every tier *up to* its ceiling rather than from the ceiling
 * alone. A mixed quiz is a better quiz, and a group that asked to go deep still
 * enjoys John 3:16 turning up; a ceiling that excluded the easy tiers would
 * make every round feel like an exam.
 *
 * `any` is null rather than 5 because it means something different in kind: not
 * the deepest curated tier but no pool at all, the whole canon drawn uniformly.
 */
export const FAMILIARITY_CEILING: Readonly<Record<Familiarity, number | null>> = {
  core: 1,
  familiar: 2,
  broad: 3,
  deep: 5,
  any: null,
};

/**
 * How many curated candidates to shuffle up before giving up on the pool. Well
 * past the number of rounds any game runs, so a draw only reaches the end of
 * this list when nearly every candidate is unusable.
 */
const POOL_SCAN = 64;

/** Re-draws allowed when a uniform canon draw keeps landing on a used verse. */
const CANON_ATTEMPTS = 8;

const EMPTY_EXCLUSION: ReadonlySet<VerseId> = new Set();

/** Modules that did not precompute a word count still have to be filtered. */
function wordsIn(verse: Verse): number {
  return verse.wordCount ?? verse.text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/**
 * What a game asks for when it wants a verse to build a round from.
 *
 * `familiarity` comes from the room, the rest from the game: a game that only
 * makes sense in the gospels says so, and one that needs a verse long enough to
 * hide a word in says that.
 */
export interface VerseDraw {
  familiarity: Familiarity;
  books?: readonly number[];
  sections?: readonly SectionName[];
  audience?: Audience;
  tag?: string;
  /** Verses this game has already asked about, so a round does not repeat one. */
  exclude?: readonly VerseId[];
  minWords?: number;
}

export class ContentLibrary {
  readonly catalog: TranslationCatalog;
  readonly db: ContentDatabase;
  /** The abbreviation asked for, which is not necessarily one that is installed. */
  readonly defaultTranslation: string;

  /**
   * Resolving the default costs a catalog scan, so it is done once and kept.
   * `undefined` means not yet resolved; `null` means resolved to nothing,
   * which is what a server with no modules installed looks like.
   */
  private resolvedDefault: VerseSource | null | undefined;

  private constructor(catalog: TranslationCatalog, db: ContentDatabase, defaultTranslation: string) {
    this.catalog = catalog;
    this.db = db;
    this.defaultTranslation = defaultTranslation;
  }

  static open(options: ContentOptions = {}): ContentLibrary {
    return new ContentLibrary(
      ModuleCatalog.discover(options.moduleDir ?? config.moduleDir),
      ContentDatabase.open(options.contentPath ?? join(config.dataDir, 'content.db')),
      options.defaultTranslation ?? config.defaultTranslation
    );
  }

  /** Builds a library over parts the caller already owns. */
  static of(catalog: TranslationCatalog, db: ContentDatabase, defaultTranslation: string): ContentLibrary {
    return new ContentLibrary(catalog, db, defaultTranslation);
  }

  // -------------------------------------------------------------------------
  // Translations
  // -------------------------------------------------------------------------

  /** What a host picks from, sorted by abbreviation. */
  translations(): TranslationSummary[] {
    return this.catalog.list();
  }

  /**
   * One translation, or the default when none is named. A server carrying only
   * one module answers to the default even if that module is not the one the
   * configuration asked for: refusing to serve verses because the environment
   * names a translation nobody installed helps nobody.
   */
  translation(abbreviation?: string): VerseSource | null {
    if (abbreviation !== undefined) return this.catalog.get(abbreviation);
    if (this.resolvedDefault === undefined) {
      const named = this.catalog.get(this.defaultTranslation);
      const first = this.catalog.list()[0];
      this.resolvedDefault = named ?? (first ? this.catalog.get(first.abbreviation) : null);
    }
    return this.resolvedDefault;
  }

  hasTranslation(abbreviation: string): boolean {
    return this.catalog.has(abbreviation);
  }

  // -------------------------------------------------------------------------
  // Verses
  // -------------------------------------------------------------------------

  verse(id: VerseId, abbreviation?: string): Verse | null {
    return this.translation(abbreviation)?.verse(id) ?? null;
  }

  /** The reveal screen wants the words and nothing else. */
  verseText(id: VerseId, abbreviation?: string): string | null {
    return this.verse(id, abbreviation)?.text ?? null;
  }

  verses(ids: readonly VerseId[], abbreviation?: string): Verse[] {
    return this.translation(abbreviation)?.verses(ids) ?? [];
  }

  /** Every verse between two ids, inclusive, in canonical order. */
  range(first: VerseId, last: VerseId, abbreviation?: string): Verse[] {
    return this.translation(abbreviation)?.range(first, last) ?? [];
  }

  chapter(book: number, chapter: number, abbreviation?: string): Verse[] {
    return this.translation(abbreviation)?.chapter(book, chapter) ?? [];
  }

  randomVerse(
    filter: VerseFilter = {},
    random: () => number = Math.random,
    abbreviation?: string
  ): Verse | null {
    return this.translation(abbreviation)?.randomVerse(filter, random) ?? null;
  }

  /** Distinct verses; fewer than asked for only when the filter holds fewer. */
  randomVerses(
    count: number,
    filter: VerseFilter = {},
    random: () => number = Math.random,
    abbreviation?: string
  ): Verse[] {
    return this.translation(abbreviation)?.randomVerses(count, filter, random) ?? [];
  }

  /**
   * The draw a game should use: a verse from the curated pool at the room's
   * familiarity, with the whole canon as the fallback rather than the norm.
   *
   * Three fallbacks, in this order, each one deliberate:
   *
   * - **the pool, minus what this game has already asked.** The usual path.
   * - **the pool, repeats allowed.** A pool smaller than the round count is a
   *   real configuration — sixty core verses, a twenty-round game — and asking
   *   a verse twice is better than an empty screen.
   * - **the whole canon.** Only when the scope holds no curated verses at all:
   *   a server whose content has not been imported yet still plays, and a host
   *   who chose `any` asked for exactly this.
   */
  drawVerse(draw: VerseDraw, random: () => number = Math.random, abbreviation?: string): Verse | null {
    const module = this.translation(abbreviation) ?? this.translation();
    if (module === null) return null;

    const ceiling = FAMILIARITY_CEILING[draw.familiarity];
    if (ceiling !== null) {
      // Built up rather than spread: an explicitly undefined key is not the
      // same as an absent one under this compiler's optional-property rules.
      const filter: ContentFilter = { maxDifficulty: ceiling };
      if (draw.books !== undefined) filter.books = draw.books;
      if (draw.sections !== undefined) filter.sections = draw.sections;
      if (draw.audience !== undefined) filter.audience = draw.audience;
      if (draw.tag !== undefined) filter.tag = draw.tag;
      if (this.db.curatedVerseCount(filter) > 0) {
        const excluded = new Set(draw.exclude ?? []);
        const found =
          this.fromPool(module, filter, excluded, draw.minWords ?? 0, random) ??
          this.fromPool(module, filter, EMPTY_EXCLUSION, draw.minWords ?? 0, random);
        if (found !== null) return found;
      }
    }

    const filter: VerseFilter = {};
    if (draw.books !== undefined) filter.books = draw.books;
    if (draw.sections !== undefined) filter.sections = draw.sections;
    if (draw.minWords !== undefined) filter.minWords = draw.minWords;
    const excluded = new Set(draw.exclude ?? []);
    for (let attempt = 0; attempt < CANON_ATTEMPTS; attempt += 1) {
      const verse = module.randomVerse(filter, random);
      if (verse === null) return null;
      if (!excluded.has(verse.id)) return verse;
    }
    return module.randomVerse(filter, random);
  }

  /**
   * The first curated verse the module can actually serve. A pool entry the
   * module does not carry, or one too short for the game asking, is skipped
   * rather than returned broken — modules differ, and the pool outlives them.
   */
  private fromPool(
    module: VerseSource,
    filter: ContentFilter,
    excluded: ReadonlySet<VerseId>,
    minWords: number,
    random: () => number
  ): Verse | null {
    for (const record of this.db.drawCuratedVerses(POOL_SCAN, filter, random)) {
      if (excluded.has(record.verseId)) continue;
      const verse = module.verse(record.verseId);
      if (verse === null) continue;
      if (wordsIn(verse) < minWords) continue;
      return verse;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Authored content
  // -------------------------------------------------------------------------

  question(id: string): QuestionRecord | null {
    return this.db.getQuestion(id);
  }

  questions(filter: QuestionFilter = {}): QuestionRecord[] {
    return this.db.findQuestions(filter);
  }

  /** A round's worth, already shuffled by the caller's generator. */
  drawQuestions(
    count: number,
    filter: QuestionFilter = {},
    random: () => number = Math.random
  ): QuestionRecord[] {
    return this.db.drawQuestions(count, filter, random);
  }

  questionSets(filter: ContentFilter = {}): QuestionSetRecord[] {
    return this.db.listQuestionSets(filter);
  }

  questionSet(id: string): QuestionSetRecord | null {
    return this.db.getQuestionSet(id);
  }

  orderedLists(filter: ContentFilter = {}): OrderedListRecord[] {
    return this.db.listOrderedLists(filter);
  }

  orderedList(id: string): OrderedListRecord | null {
    return this.db.getOrderedList(id);
  }

  promptCards(filter: PromptCardFilter = {}): PromptCardRecord[] {
    return this.db.findPromptCards(filter);
  }

  drawPromptCards(
    count: number,
    filter: PromptCardFilter = {},
    random: () => number = Math.random
  ): PromptCardRecord[] {
    return this.db.drawPromptCards(count, filter, random);
  }

  close(): void {
    this.catalog.closeAll();
    this.db.close();
    this.resolvedDefault = undefined;
  }
}

// ---------------------------------------------------------------------------
// The process-wide library
// ---------------------------------------------------------------------------

let shared: ContentLibrary | null = null;

/**
 * The library the server runs on, opened on first use rather than at import:
 * a test that never touches content should not have a modules directory
 * scanned or a database file created on its behalf.
 */
export function content(): ContentLibrary {
  shared ??= ContentLibrary.open();
  return shared;
}

/**
 * Replaces the process-wide library, returning the one that was there. The
 * caller owns both — nothing is closed here, because a test that swaps a
 * library in and out usually wants to keep reading from it afterwards.
 */
export function useContent(library: ContentLibrary | null): ContentLibrary | null {
  const previous = shared;
  shared = library;
  return previous;
}

/** Closes the process-wide library, if one was ever opened. */
export function closeContent(): void {
  shared?.close();
  shared = null;
}

export function translations(): TranslationSummary[] {
  return content().translations();
}

export function translation(abbreviation?: string): VerseSource | null {
  return content().translation(abbreviation);
}

export function verse(id: VerseId, abbreviation?: string): Verse | null {
  return content().verse(id, abbreviation);
}

export function verseText(id: VerseId, abbreviation?: string): string | null {
  return content().verseText(id, abbreviation);
}

export function chapter(book: number, chapterNumber: number, abbreviation?: string): Verse[] {
  return content().chapter(book, chapterNumber, abbreviation);
}

export function randomVerse(
  filter: VerseFilter = {},
  random: () => number = Math.random,
  abbreviation?: string
): Verse | null {
  return content().randomVerse(filter, random, abbreviation);
}

export function questions(filter: QuestionFilter = {}): QuestionRecord[] {
  return content().questions(filter);
}

export function drawQuestions(
  count: number,
  filter: QuestionFilter = {},
  random: () => number = Math.random
): QuestionRecord[] {
  return content().drawQuestions(count, filter, random);
}

export function questionSets(filter: ContentFilter = {}): QuestionSetRecord[] {
  return content().questionSets(filter);
}

export function questionSet(id: string): QuestionSetRecord | null {
  return content().questionSet(id);
}

export function orderedLists(filter: ContentFilter = {}): OrderedListRecord[] {
  return content().orderedLists(filter);
}

export function orderedList(id: string): OrderedListRecord | null {
  return content().orderedList(id);
}

export function promptCards(filter: PromptCardFilter = {}): PromptCardRecord[] {
  return content().promptCards(filter);
}

export function drawPromptCards(
  count: number,
  filter: PromptCardFilter = {},
  random: () => number = Math.random
): PromptCardRecord[] {
  return content().drawPromptCards(count, filter, random);
}

export function drawVerse(
  draw: VerseDraw,
  random: () => number = Math.random,
  abbreviation?: string
): Verse | null {
  return content().drawVerse(draw, random, abbreviation);
}

// ---------------------------------------------------------------------------
// The layer's own surface, re-exported so a game imports from one place
// ---------------------------------------------------------------------------

export { BibleModule, ModuleFormatError } from './BibleModule.js';
export type { ModuleInfo, Verse, VerseFilter, VerseSource } from './BibleModule.js';

export { ModuleCatalog } from './ModuleCatalog.js';
export type { TranslationCatalog, TranslationSummary, SkippedModule } from './ModuleCatalog.js';

export {
  ContentDatabase,
  contentKey,
  AUDIENCES,
  QUESTION_TYPES,
  SCHEMA_VERSION,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  STANDARD_DISTRACTOR_COUNT,
  PREFERRED_DISTRACTOR_COUNT,
} from './ContentDatabase.js';
export type {
  Audience,
  ClueRecord,
  ContentFilter,
  ContentTags,
  CuratedVerseRecord,
  OrderedItemRecord,
  OrderedListRecord,
  PromptCardRecord,
  QuestionFilter,
  QuestionRecord,
  QuestionSetRecord,
  QuestionType,
} from './ContentDatabase.js';

export {
  MIN_ORDERED_ITEMS,
  formatImportReport,
  importContent,
  importCsv,
  importCsvFile,
  importJson,
  importJsonFile,
} from './importer.js';
export type {
  ContentKind,
  ContentPayload,
  ImportCounts,
  ImportOptions,
  ImportReport,
  ImportRejection,
  ImportWarning,
  RejectionReason,
} from './importer.js';
