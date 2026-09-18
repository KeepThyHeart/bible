/**
 * The open modules.
 *
 * `data/modules.ts` finds module files; this opens the ones a screen actually
 * asks for and holds the repositories on top of them. Three things it is
 * careful about:
 *
 * - **Open lazily, close everything.** A user with a large library can have
 *   fifty modules on disk; a session touches two or three. Opening on first use
 *   keeps startup independent of library size.
 * - **`main.db` is optional.** The desktop app always has one. Somebody who
 *   unpacked a single binary has module files and nothing else, so the book
 *   table has a fallback that reads the canon out of the module itself.
 */
import {
  BibleBook,
  BibleBookRepository,
  BibleRepository,
  BookRepository,
  ChapterInfo,
  CommentaryRepository,
  CrossReferenceRepository,
  DictionaryRepository,
  TopicalIndexRepository,
  VerseIdHelper,
  type BibleVerse,
  type IBibleBookRepository,
  type Testament,
} from '@bible/core';
// Not re-exported by core's root barrel, and DesignSpec §2.4 forbids changing
// core for the CLI's convenience. The `./*` entry in core's `exports` map is the
// documented way in, and is what `apps/desktop` uses for the same reason.
import { VerseNavigationService } from '@bible/core/Services/VerseNavigationService';

import { BunSql } from '../data/BunSql';
import { discoverModules, openModule, type DiscoveredModule } from '../data/modules';

export interface OpenBible {
  readonly module: DiscoveredModule;
  readonly sql: BunSql;
  readonly repo: BibleRepository;
  /** Uppercase, e.g. `KJV`. */
  readonly abbreviation: string;
  readonly fullName: string;
}

/**
 * The module types the study screen offers (DesignSpec §4.4).
 *
 * `bible` is absent on purpose — a translation is opened by {@link Library.bible}
 * with its own formatting-version resolution, and a parallel column is a Bible
 * rather than a study resource.
 */
export type StudyModuleType =
  | 'commentary'
  | 'cross_reference'
  | 'dictionary'
  | 'topical_index'
  | 'book';

/** The repository core provides for each. */
export interface StudyRepositories {
  readonly commentary: CommentaryRepository;
  readonly cross_reference: CrossReferenceRepository;
  readonly dictionary: DictionaryRepository;
  readonly topical_index: TopicalIndexRepository;
  readonly book: BookRepository;
}

export type StudyRepository<K extends StudyModuleType> = StudyRepositories[K];

/**
 * An open study module.
 *
 * Structurally a core `AggregationModule<TRepo>` — `abbreviation`, `moduleName`
 * and `repository` are its three fields, named as it names them — so a list of
 * these can be passed to `StudyOverview/*` without mapping.
 */
export interface StudyModule<K extends StudyModuleType> {
  readonly module: DiscoveredModule;
  readonly sql: BunSql;
  readonly abbreviation: string;
  readonly moduleName: string;
  readonly repository: StudyRepository<K>;
}

const STUDY_REPOSITORIES: {
  readonly [K in StudyModuleType]: (sql: BunSql) => StudyRepository<K>;
} = {
  commentary: (sql) => new CommentaryRepository(sql),
  cross_reference: (sql) => new CrossReferenceRepository(sql),
  dictionary: (sql) => new DictionaryRepository(sql),
  topical_index: (sql) => new TopicalIndexRepository(sql),
  book: (sql) => new BookRepository(sql),
};

/**
 * Why `devotional` is not on that list.
 *
 * It was, mapped to `BookRepository` on the assumption that a devotional is a
 * book with dated sections. It is not: a devotional module stores
 * `devotional_entry`, not `book_section`, so every call threw `no such table`.
 * Core has no `DevotionalRepository` — see `docs/Design/DataModel/Devotional.md`
 * for the schema that one would read. Until it does, the study screen reports
 * devotionals as present-but-unopenable rather than opening one and failing, and
 * {@link Library.devotionalModules} is how it counts them.
 */

export interface LibraryOptions {
  /** Where `main.db` lives, if it exists. Book names come from it when it does. */
  readonly mainDbPath?: string | undefined;
  /** Injected in tests. Defaults to a real discovery run. */
  readonly modules?: readonly DiscoveredModule[];
}

/**
 * A chapter, with the context a screen needs to draw a header without asking
 * three more questions.
 */
export interface Chapter {
  readonly bookNumber: number;
  readonly bookName: string;
  readonly chapter: number;
  readonly verses: readonly BibleVerse[];
  /** Chapters in this book, for `<` / `>` and the header. */
  readonly chapterCount: number;
  /** Highest verse number in this chapter. */
  readonly verseCount: number;
}

export class Library {
  private readonly bibles = new Map<string, OpenBible>();
  private readonly connections: BunSql[] = [];
  private readonly modules: readonly DiscoveredModule[];
  private readonly studyByType = new Map<StudyModuleType, StudyModule<StudyModuleType>[]>();
  private booksByNumber = new Map<number, BibleBook>();
  private booksLoaded = false;
  private readonly mainDbPath: string | undefined;
  private nav: VerseNavigationService | undefined;

  private constructor(modules: readonly DiscoveredModule[], mainDbPath: string | undefined) {
    this.modules = modules;
    this.mainDbPath = mainDbPath;
  }

  static open(options: LibraryOptions = {}): Library {
    return new Library(options.modules ?? discoverModules(), options.mainDbPath);
  }

  /**
   * Every usable Bible module found, one per abbreviation, best first (§3.2).
   *
   * "Best" is not merely "earliest root", and finding that out was a real bug.
   * §3.2's dedupe collapses *the same* module found twice — `abbreviation` plus
   * `content_sha256`. Two **different** modules claiming one abbreviation is a
   * case it does not cover, and it happens as soon as somebody has the desktop
   * app installed: its shipped `bible_kjv.db` declares `schema_version 1.0.0`
   * and carries no paragraph, heading or span data at all, while the same
   * translation in a v2 module declares `2.0.0` and carries all three. Root
   * order alone hands the reader the poorer one and says nothing — every
   * paragraph break in the chapter silently disappears.
   *
   * So a higher declared schema version wins, and root order breaks the tie. A
   * v2 module of a translation is a superset of the v1 one; there is no reading
   * for which the older is the better answer.
   */
  bibleModules(): DiscoveredModule[] {
    const usable = this.modules.filter((m) => m.type === 'bible' && m.unsupported === undefined);
    return preferOnePerAbbreviation(usable);
  }

  /** Every Bible found, including the ones shadowed above. The modules screen lists them all. */
  allBibleModules(): DiscoveredModule[] {
    return this.modules.filter((m) => m.type === 'bible' && m.unsupported === undefined);
  }

  /**
   * Open a Bible by abbreviation, or the first available one.
   *
   * Returns `undefined` rather than throwing when there is nothing to open: a
   * fresh install with no bundled module is a state the reader has to draw, not
   * a crash. Falls back to the first module when the named one is missing, which
   * is what a tab restored from a library that has since changed needs.
   */
  bible(abbreviation?: string): OpenBible | undefined {
    const wanted = abbreviation?.toLowerCase();
    const candidates = this.bibleModules();
    const module =
      wanted === undefined
        ? candidates[0]
        : (candidates.find((m) => m.abbreviation.toLowerCase() === wanted) ?? candidates[0]);
    if (module === undefined) return undefined;

    const existing = this.bibles.get(module.path);
    if (existing !== undefined) return existing;

    const sql = openModule(module);
    this.connections.push(sql);

    const opened: OpenBible = {
      module,
      sql,
      repo: new BibleRepository(sql),
      abbreviation: module.abbreviation.toUpperCase(),
      fullName: module.fullName,
    };
    this.bibles.set(module.path, opened);
    return opened;
  }

  /** The books of the canon, in order. Empty only when no module could be opened. */
  allBooks(): BibleBook[] {
    this.ensureBooks();
    return [...this.booksByNumber.values()].sort((a, b) => a.bookNumber - b.bookNumber);
  }

  book(bookNumber: number): BibleBook | undefined {
    this.ensureBooks();
    return this.booksByNumber.get(bookNumber);
  }

  bookName(bookNumber: number): string {
    return this.book(bookNumber)?.bookName ?? `Book ${bookNumber}`;
  }

  /**
   * Load a chapter, clamping the request into the canon.
   *
   * Clamping rather than failing is deliberate: `>` at the end of Revelation,
   * and a tab restored against a translation that does not have that chapter,
   * both land here, and neither is worth an error screen.
   */
  chapter(bible: OpenBible, bookNumber: number, chapter: number): Chapter | undefined {
    const book = this.book(bookNumber);
    const chapterCount = book?.chapterCount ?? 1;
    const clamped = Math.min(Math.max(1, chapter), Math.max(1, chapterCount));
    const verses = bible.repo.getChapter(bookNumber, clamped);
    if (verses.length === 0) return undefined;

    const last = verses[verses.length - 1]!;
    return {
      bookNumber,
      bookName: book?.bookName ?? `Book ${bookNumber}`,
      chapter: clamped,
      verses,
      chapterCount: Math.max(1, chapterCount),
      verseCount: VerseIdHelper.parse(last.verseId).verse,
    };
  }

  /**
   * The study modules of one type, opened, in discovery order.
   *
   * One generic accessor rather than five hand-written ones, because every
   * caller wants the same three things — the repository, the abbreviation to
   * show, and the name to show — and that is exactly core's
   * {@link AggregationModule}. Returning core's own shape means the study screen
   * can hand the result straight to `StudyOverview/*` for its counts, which is
   * what the study screen needs, instead of querying repositories itself.
   *
   * Unusable modules are filtered out here, once, so no screen has to remember
   * to check `unsupported`. The modules screen wants them and reads
   * `allModules()` instead.
   */
  study<K extends StudyModuleType>(type: K): StudyModule<K>[] {
    const cached = this.studyByType.get(type) as StudyModule<K>[] | undefined;
    if (cached !== undefined) return cached;

    const candidates = preferOnePerAbbreviation(
      this.modules.filter((m) => m.type === type && m.unsupported === undefined),
    );

    const opened: StudyModule<K>[] = [];
    for (const module of candidates) {
      const sql = openModule(module);
      this.connections.push(sql);
      opened.push({
        module,
        sql,
        abbreviation: module.abbreviation,
        moduleName: module.fullName,
        repository: STUDY_REPOSITORIES[type](sql) as StudyRepository<K>,
      });
    }

    this.studyByType.set(type, opened as StudyModule<StudyModuleType>[]);
    return opened;
  }

  /**
   * One study module by abbreviation, or the first of its type.
   *
   * Same fallback as {@link bible}, for the same reason: a tab restored against
   * a library that has since changed names a module that may be gone, and the
   * useful answer is the nearest thing rather than an error.
   */
  studyModule<K extends StudyModuleType>(
    type: K,
    abbreviation?: string,
  ): StudyModule<K> | undefined {
    const all = this.study(type);
    if (abbreviation === undefined) return all[0];
    const wanted = abbreviation.toLowerCase();
    return all.find((m) => m.abbreviation.toLowerCase() === wanted) ?? all[0];
  }

  /**
   * Devotional modules found, unopened.
   *
   * Listed rather than opened: there is no repository in core that can read one
   * (see the note above `STUDY_REPOSITORIES`). The study menu needs the count so
   * it can say "3 installed, not yet readable", which is a truer answer than
   * either "none" or a row that throws when chosen.
   */
  devotionalModules(): DiscoveredModule[] {
    return this.modules.filter((m) => m.type === 'devotional' && m.unsupported === undefined);
  }

  /** Everything discovery found, usable or not. The modules screen dims the rest. */
  allModules(): readonly DiscoveredModule[] {
    return this.modules;
  }

  /**
   * The book table as an `IBibleBookRepository`, so core's services can be used
   * unchanged (DesignSpec §2.3) whether or not `main.db` exists.
   */
  bookRepository(): IBibleBookRepository {
    this.ensureBooks();
    return new CanonBookRepository(this.booksByNumber);
  }

  /** Core's chapter movement, book rollover and reference formatting (NAV-2). */
  navigation(): VerseNavigationService {
    if (this.nav === undefined) this.nav = new VerseNavigationService(this.bookRepository());
    return this.nav;
  }

  close(): void {
    for (const sql of this.connections) sql.close();
    this.connections.length = 0;
    this.bibles.clear();
    this.studyByType.clear();
  }

  /**
   * The canon, from `main.db` when it exists and from the fixed table otherwise.
   *
   * `main.db` is preferred only because it carries the desktop's own book names,
   * and a user running both should see the same names in each. The numbers are
   * the same either way — the app is fixed to one versification scheme — so a
   * missing `main.db` costs nothing.
   */
  private ensureBooks(): void {
    if (this.booksLoaded) return;
    this.booksLoaded = true;

    const books = this.booksFromMainDb();
    const resolved = books.length === 66 ? books : canonicalBooks();
    this.booksByNumber = new Map(resolved.map((b) => [b.bookNumber, b]));
  }

  private booksFromMainDb(): BibleBook[] {
    if (this.mainDbPath === undefined) return [];
    try {
      const sql = new BunSql(this.mainDbPath, { readonly: true });
      this.connections.push(sql);
      return new BibleBookRepository(sql).getAll();
    } catch {
      // Missing, unreadable, or not a database. The fixed canon is exact on its
      // own, so there is nothing here worth reporting to the user.
      return [];
    }
  }
}

/** The 66 books in canonical order. */
const CANONICAL_BOOK_NAMES: readonly string[] = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude',
  'Revelation',
];

/**
 * The canon: 66 books, standard English (KJV) versification.
 *
 * **Not derived from the open module, which is what it used to do and was
 * wrong.** Deriving meant taking whichever Bible discovery happened to list
 * first — with 53 modules in a developer checkout, that is `bible_abp.db`, not
 * the KJV — and reading its book and chapter counts as the canon. A module that
 * covers only part of the Bible then produced a canon missing books, and
 * `Library.chapter()` clamped every request into it: asking for John 3 in the
 * KJV silently returned John 1, because the *other* module said John had one
 * chapter.
 *
 * A fixed table is also simply correct. DesignSpec's key constraints fix the app
 * to one versification scheme, so these numbers cannot vary by module. They are
 * transcribed from the shipped KJV: 66 books, 1,189 chapters, 31,102 verses.
 */
const CHAPTER_COUNTS: readonly number[] = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31,
  12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28,
  16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5,
  3, 5, 1, 1, 1, 22,
];

/** Verses per book, same source. Used only for `getTotalVerseCount()`. */
const VERSE_COUNTS: readonly number[] = [
  1533, 1213, 859, 1288, 959, 658, 618, 85, 810, 695, 816, 719, 942, 822, 280,
  406, 167, 1070, 2461, 915, 222, 117, 1292, 1364, 154, 1273, 357, 197, 73, 146,
  21, 48, 105, 47, 56, 53, 38, 211, 55, 1071, 678, 1151, 879, 1007, 433, 437,
  257, 149, 155, 104, 95, 89, 47, 113, 83, 46, 25, 303, 108, 105, 61, 105, 13,
  14, 25, 404,
];

/** The canon as `BibleBook` entities, in order. */
export function canonicalBooks(): BibleBook[] {
  return CANONICAL_BOOK_NAMES.map(
    (bookName, index) =>
      new BibleBook({
        bookNumber: index + 1,
        bookName,
        bookAbbreviation: bookName.replace(/\s+/g, '').slice(0, 3),
        testament: index < 39 ? 'OT' : 'NT',
        chapterCount: CHAPTER_COUNTS[index]!,
        verseCount: VERSE_COUNTS[index]!,
      }),
  );
}

/**
 * The book table as core sees it.
 *
 * Read-only by construction, not by convention: the CLI never writes to a
 * module or to `main.db`, so the four mutating methods of the interface throw
 * rather than quietly doing nothing. A silent no-op here would surface much
 * later as data that failed to save.
 */
class CanonBookRepository implements IBibleBookRepository {
  constructor(private readonly books: ReadonlyMap<number, BibleBook>) {}

  getById(id: number): BibleBook | undefined {
    return this.getByBookNumber(id);
  }

  getByBookNumber(bookNumber: number): BibleBook | undefined {
    return this.books.get(bookNumber);
  }

  getByName(name: string): BibleBook | undefined {
    const wanted = name.trim().toLowerCase();
    return this.all().find(
      (b) => b.bookName.toLowerCase() === wanted || b.bookAbbreviation?.toLowerCase() === wanted,
    );
  }

  getAll(): BibleBook[] {
    return this.all();
  }

  getByTestament(testament: Testament): BibleBook[] {
    return this.all().filter((b) => b.testament === testament);
  }

  getByBookGroup(bookGroup: string): BibleBook[] {
    return this.all().filter((b) => b.bookGroup === bookGroup);
  }

  getTotalVerseCount(): number {
    return this.all().reduce((total, book) => total + book.verseCount, 0);
  }

  search(query: string): BibleBook[] {
    const needle = query.trim().toLowerCase();
    return this.all().filter((b) => b.bookName.toLowerCase().includes(needle));
  }

  getChapterInfo(bookId: number, chapter: number): ChapterInfo | undefined {
    const book = this.getByBookNumber(bookId);
    if (book === undefined || chapter < 1 || chapter > book.chapterCount) return undefined;
    const range = VerseIdHelper.getChapterRange(bookId, chapter);
    return new ChapterInfo({
      bookId,
      chapter,
      // Zero rather than a guess: the verse count of a chapter lives in the
      // Bible module, not in the book table, and `main.db` is the only place
      // that has ever carried it. Core's own `getChapterInfo` reports it the
      // same way, for the same reason.
      verseCount: 0,
      firstAbsoluteId: range.startVerseId,
      lastAbsoluteId: range.endVerseId ?? range.startVerseId,
    });
  }

  getBookChapterInfo(bookId: number): ChapterInfo[] {
    return this.getChapterInfoByBookNumber(bookId);
  }

  getChapterInfoByBookNumber(bookNumber: number): ChapterInfo[] {
    const book = this.getByBookNumber(bookNumber);
    if (book === undefined) return [];
    const out: ChapterInfo[] = [];
    for (let chapter = 1; chapter <= book.chapterCount; chapter += 1) {
      const info = this.getChapterInfo(bookNumber, chapter);
      if (info !== undefined) out.push(info);
    }
    return out;
  }

  create(): BibleBook {
    throw new Error('The CLI is read-only: the book table cannot be written.');
  }

  update(): BibleBook {
    throw new Error('The CLI is read-only: the book table cannot be written.');
  }

  delete(): boolean {
    throw new Error('The CLI is read-only: the book table cannot be written.');
  }

  private all(): BibleBook[] {
    return [...this.books.values()].sort((a, b) => a.bookNumber - b.bookNumber);
  }
}

/**
 * One module per abbreviation, preferring the newer module format.
 *
 * Order within the result is the original discovery order, so §3.2's root
 * precedence still decides *where* a translation comes from — this only decides
 * *which* of two files claiming the same name is opened, and only when they
 * declare different schema versions.
 */
function preferOnePerAbbreviation(modules: readonly DiscoveredModule[]): DiscoveredModule[] {
  const best = new Map<string, DiscoveredModule>();

  for (const module of modules) {
    const key = module.abbreviation.toLowerCase();
    const held = best.get(key);
    // First one wins on a tie, which preserves root order.
    if (held === undefined || schemaMajor(module) > schemaMajor(held)) best.set(key, module);
  }

  return modules.filter((module) => best.get(module.abbreviation.toLowerCase()) === module);
}

/**
 * The major part of a module's declared `schema_version`.
 *
 * Absent means an early module, which is the oldest thing there is — `0`, so
 * anything declaring a version beats it. Unparseable is treated the same way
 * rather than thrown on: a module with a malformed version is still readable,
 * and refusing to rank it would make it win by accident.
 */
function schemaMajor(module: DiscoveredModule): number {
  const major = Number.parseInt(module.schemaVersion?.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? 0 : major;
}
