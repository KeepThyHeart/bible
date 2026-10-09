/**
 * Read-only access to one Bible module file.
 *
 * A module is somebody else's data: it is opened read only and never written
 * to, and only `bible_verse` and `module_info` are touched. Modules routinely
 * carry apparatus the games have no use for — interlinear words, full-text
 * indexes, concordances — and ignoring all of it is what lets a module gain
 * new tables without breaking a game.
 *
 * Every value that reaches SQL travels as a bound parameter. Placeholders are
 * generated for list-shaped clauses, but a value is never spliced into SQL
 * text, not even an integer this file computed itself: the rule has no
 * exceptions to remember, and so it cannot be forgotten in the one place that
 * matters.
 */

import Database from 'better-sqlite3';
import type { Database as SqliteDatabase, Statement } from 'better-sqlite3';
import { SECTIONS, BOOK_COUNT, bookRange, chapterRange } from '../../../../src/modules/games/shared/verseId.js';
import type { SectionName, VerseId } from '../../../../src/modules/games/shared/verseId.js';

/** The `module_info` fields the games read. Everything else is ignored. */
export interface ModuleInfo {
  abbreviation: string;
  fullName: string;
  languageCode: string | null;
  copyright: string | null;
  licenseSpdx: string | null;
  licenseUrl: string | null;
  /** Expected `protestant-66`; a module may declare something else. */
  canon: string | null;
  /**
   * Which chapter-and-verse scheme the ids follow. A module declares its own,
   * which is why no mapping table is needed: one module is one scheme, and
   * content authored against it stays valid.
   */
  versification: string | null;
  moduleType: string | null;
}

export interface Verse {
  id: VerseId;
  text: string;
  /** Absent in modules that did not compute it. */
  wordCount: number | null;
}

/** Narrows a verse draw to part of the canon, and optionally to longer verses. */
export interface VerseFilter {
  books?: readonly number[];
  sections?: readonly SectionName[];
  /** Guards against drawing "Jesus wept." for a fill-in-the-blank round. */
  minWords?: number;
}

/**
 * What the games need from a translation. A module file (`BibleModule`) is one
 * implementation; the web app's `DatabaseManager` (`DatabaseManagerCatalog.ts`)
 * is the other. Games never learn which.
 */
export interface VerseSource {
  readonly info: ModuleInfo;
  verse(id: VerseId): Verse | null;
  verses(ids: readonly VerseId[]): Verse[];
  range(first: VerseId, last: VerseId): Verse[];
  chapter(book: number, chapter: number): Verse[];
  book(book: number): Verse[];
  verseCount(filter?: VerseFilter): number;
  randomVerse(filter?: VerseFilter, random?: () => number): Verse | null;
  randomVerses(count: number, filter?: VerseFilter, random?: () => number): Verse[];
}

/**
 * Thrown when a file opens as SQLite but is not a Bible module. The catalog
 * distinguishes this from a corrupt file so it can say which it skipped and
 * why.
 */
export class ModuleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleFormatError';
  }
}

interface VerseRow {
  verse_id: number;
  text: string;
  word_count: number | null;
}

interface CountRow {
  c: number;
}

/** Inclusive verse-id bounds. */
interface IdRange {
  first: VerseId;
  last: VerseId;
}

function toVerse(row: VerseRow): Verse {
  return { id: row.verse_id, text: row.text, wordCount: row.word_count };
}

function readString(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads a module's own account of itself, and refuses anything that is not a
 * Bible. Closing the handle is the caller's job — this is only ever reached
 * with a database the caller opened.
 */
function readInfo(db: SqliteDatabase, path: string): ModuleInfo {
  const hasTable = db.prepare<[string], CountRow>(
    "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?"
  );
  for (const table of ['bible_verse', 'module_info']) {
    if ((hasTable.get(table)?.c ?? 0) === 0) {
      throw new ModuleFormatError(`${path}: no ${table} table`);
    }
  }

  const row = db.prepare('SELECT * FROM module_info LIMIT 1').get() as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new ModuleFormatError(`${path}: module_info is empty`);

  // A dictionary or commentary module shares the envelope but has no verses to
  // play with.
  const moduleType = readString(row, 'module_type');
  if (moduleType !== null && moduleType !== 'bible') {
    throw new ModuleFormatError(`${path}: module_type is ${moduleType}, not bible`);
  }

  const abbreviation = readString(row, 'abbreviation');
  if (abbreviation === null) {
    throw new ModuleFormatError(`${path}: module_info has no abbreviation`);
  }

  return {
    abbreviation,
    fullName: readString(row, 'full_name') ?? abbreviation,
    languageCode: readString(row, 'language_code'),
    copyright: readString(row, 'copyright'),
    licenseSpdx: readString(row, 'license_spdx'),
    licenseUrl: readString(row, 'license_url'),
    canon: readString(row, 'canon'),
    versification: readString(row, 'versification'),
    moduleType,
  };
}

export class BibleModule implements VerseSource {
  private readonly db: SqliteDatabase;
  private readonly verseStatement: Statement;
  private readonly rangeStatement: Statement;
  /**
   * Range-shaped queries differ only in how many `BETWEEN` clauses they carry,
   * so one prepared statement per shape covers every filter. A random verse is
   * drawn once a round, and re-preparing on each draw would be the one
   * avoidable cost in that path.
   */
  private readonly shapedStatements = new Map<string, Statement>();

  readonly path: string;
  readonly info: ModuleInfo;

  private constructor(db: SqliteDatabase, path: string, info: ModuleInfo) {
    this.db = db;
    this.path = path;
    this.info = info;
    this.verseStatement = db.prepare(
      'SELECT verse_id, text, word_count FROM bible_verse WHERE verse_id = ?'
    );
    this.rangeStatement = db.prepare(
      'SELECT verse_id, text, word_count FROM bible_verse WHERE verse_id BETWEEN ? AND ? ORDER BY verse_id'
    );
  }

  /**
   * Opens a module. Throws `ModuleFormatError` when the file is SQLite but
   * carries no Bible text, and whatever SQLite throws when the file is not a
   * database at all — the catalog is the only caller that wants to survive
   * either.
   */
  static open(path: string): BibleModule {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    // Belt and braces on top of `readonly`: a module is somebody else's file.
    db.pragma('query_only = ON');

    /*
     * The one thing that must happen on every failing path, and the reason
     * this catch exists: hand the file handle back. The catalog probes every
     * file in a directory, most rejections arrive as an exception from SQLite
     * rather than as a return value, and a handle leaked per stray README is
     * one the process never gets back — on Windows it also locks the file
     * against anyone else. The error itself is not the concern here, so it
     * travels on untouched.
     */
    try {
      return new BibleModule(db, path, readInfo(db, path));
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** One verse, or null when the module does not carry it. */
  verse(id: VerseId): Verse | null {
    const row = this.verseStatement.get(id) as VerseRow | undefined;
    return row ? toVerse(row) : null;
  }

  /** Verses in the given order, skipping ids the module does not carry. */
  verses(ids: readonly VerseId[]): Verse[] {
    const found: Verse[] = [];
    for (const id of ids) {
      const verse = this.verse(id);
      if (verse) found.push(verse);
    }
    return found;
  }

  /** Every verse between two ids, inclusive, in canonical order. */
  range(first: VerseId, last: VerseId): Verse[] {
    const rows = this.rangeStatement.all(first, last) as VerseRow[];
    return rows.map(toVerse);
  }

  chapter(book: number, chapter: number): Verse[] {
    const { first, last } = chapterRange(book, chapter);
    return this.range(first, last);
  }

  book(book: number): Verse[] {
    const { first, last } = bookRange(book);
    return this.range(first, last);
  }

  /** How many verses the module carries within a filter. */
  verseCount(filter: VerseFilter = {}): number {
    const ranges = rangesFor(filter);
    const statement = this.shaped(
      `SELECT COUNT(*) AS c FROM bible_verse WHERE ${whereClause(ranges.length)}`
    );
    const row = statement.get(...bindings(filter, ranges)) as CountRow | undefined;
    return row?.c ?? 0;
  }

  /**
   * One verse drawn uniformly from a filter, or null when the filter matches
   * nothing. `random` is injected so a room's deterministic generator can drive
   * it and a replayed room draws the same verses.
   */
  randomVerse(filter: VerseFilter = {}, random: () => number = Math.random): Verse | null {
    const total = this.verseCount(filter);
    if (total === 0) return null;
    return this.verseAtOffset(filter, offsetWithin(total, random));
  }

  /**
   * Distinct verses from a filter. Returns fewer than asked for only when the
   * filter itself holds fewer.
   */
  randomVerses(count: number, filter: VerseFilter = {}, random: () => number = Math.random): Verse[] {
    const total = this.verseCount(filter);
    const wanted = Math.min(count, total);
    const offsets = new Set<number>();
    // Rejection sampling converges quickly while `wanted` is a small fraction
    // of `total`; the attempt cap keeps the tail bounded, and the sequential
    // sweep afterwards finishes the job when the filter is nearly exhausted.
    const attemptCap = wanted * 20;
    for (let attempt = 0; offsets.size < wanted && attempt < attemptCap; attempt += 1) {
      offsets.add(offsetWithin(total, random));
    }
    for (let offset = 0; offsets.size < wanted; offset += 1) {
      offsets.add(offset);
    }

    const verses: Verse[] = [];
    for (const offset of offsets) {
      const verse = this.verseAtOffset(filter, offset);
      if (verse) verses.push(verse);
    }
    return verses;
  }

  close(): void {
    this.db.close();
  }

  private verseAtOffset(filter: VerseFilter, offset: number): Verse | null {
    const ranges = rangesFor(filter);
    const statement = this.shaped(
      `SELECT verse_id, text, word_count FROM bible_verse WHERE ${whereClause(ranges.length)}` +
        ' ORDER BY verse_id LIMIT 1 OFFSET ?'
    );
    const row = statement.get(...bindings(filter, ranges), offset) as VerseRow | undefined;
    return row ? toVerse(row) : null;
  }

  private shaped(sql: string): Statement {
    const existing = this.shapedStatements.get(sql);
    if (existing) return existing;
    const statement = this.db.prepare(sql);
    this.shapedStatements.set(sql, statement);
    return statement;
  }
}

function offsetWithin(total: number, random: () => number): number {
  const offset = Math.floor(random() * total);
  // A generator that returns exactly 1 would otherwise index off the end.
  return offset < 0 ? 0 : Math.min(offset, total - 1);
}

/**
 * The books a filter covers, collapsed into as few contiguous verse-id ranges
 * as possible. Collapsing matters twice over: fewer `BETWEEN` clauses to bind,
 * and a stable statement shape — the whole canon is always one range, a section
 * always one, so the prepared-statement cache stays tiny.
 */
function rangesFor(filter: VerseFilter): IdRange[] {
  const books = new Set<number>();
  for (const book of filter.books ?? []) {
    if (book >= 1 && book <= BOOK_COUNT) books.add(book);
  }
  for (const section of filter.sections ?? []) {
    const bounds = SECTIONS[section];
    for (let book = bounds[0]; book <= bounds[1]; book += 1) books.add(book);
  }
  if (books.size === 0) {
    for (let book = 1; book <= BOOK_COUNT; book += 1) books.add(book);
  }

  const sorted = [...books].sort((a, b) => a - b);
  const ranges: IdRange[] = [];
  let runStart = sorted[0] as number;
  let runEnd = runStart;
  for (const book of sorted.slice(1)) {
    if (book === runEnd + 1) {
      runEnd = book;
      continue;
    }
    ranges.push(spanOfBooks(runStart, runEnd));
    runStart = book;
    runEnd = book;
  }
  ranges.push(spanOfBooks(runStart, runEnd));
  return ranges;
}

function spanOfBooks(firstBook: number, lastBook: number): IdRange {
  return { first: bookRange(firstBook).first, last: bookRange(lastBook).last };
}

function whereClause(rangeCount: number): string {
  // `word_count` is nullable, and a module that never computed it should still
  // answer an unfiltered draw.
  const spans = Array.from({ length: rangeCount }, () => 'verse_id BETWEEN ? AND ?').join(' OR ');
  return `COALESCE(word_count, 0) >= ? AND (${spans})`;
}

function bindings(filter: VerseFilter, ranges: readonly IdRange[]): number[] {
  const values: number[] = [filter.minWords ?? 0];
  for (const range of ranges) {
    values.push(range.first, range.last);
  }
  return values;
}
