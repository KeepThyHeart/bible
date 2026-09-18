/**
 * Proximity-search index management.
 *
 * This exists because the obvious call is a trap.
 *
 * `BibleRepository.searchProximityInBook()` does **not** build its own index.
 * It maps word positions back to verses through the `verse_positions` table,
 * and if that table has no rows for the book it returns an empty array — with
 * no error and no indication that anything is missing. A `NEAR` search on a
 * module whose index has never been built therefore looks exactly like a search
 * with no matches.
 *
 * Nor does core's `ensureSearchTablesExist()` help here. It returns `true` as
 * soon as `book_search_metadata` *exists*, and the trimmed KJV ships that table
 * (empty) on purpose — so it returns `true` even for a read-only module, and
 * its read-only branch never runs for the modules this app opens. On such a
 * module `buildBookIndex()` then fails deeper down with a bare
 * "attempt to write a readonly database".
 *
 * So: check, build when it is possible, and report honestly when it is not.
 * Verified behaviour:
 *
 * | Module | `searchProximityInBook` alone | after `buildBookIndex` |
 * |---|---|---|
 * | writable | 0 results | 8 results |
 * | read-only | 0 results | throws SQLITE_READONLY |
 */
import type { BibleRepository } from '@bible/core';

import type { BunSql } from './BunSql';

export type BookIndexState =
  /** Already built for this book; proximity search will work. */
  | 'ready'
  /** Built just now. */
  | 'built'
  /** Cannot be built — the module is read-only. Proximity search will find nothing. */
  | 'unavailable';

export interface BookIndexResult {
  readonly state: BookIndexState;
  /** Shown in the UI when the state is `unavailable`. */
  readonly detail: string | undefined;
}

/** Whether this book's proximity index has already been built. */
export function isBookIndexed(sql: BunSql, bookNumber: number): boolean {
  const row = sql.queryOne<{ n: number }>(
    'SELECT count(*) AS n FROM book_search_metadata WHERE book_number = ? AND is_indexed = 1',
    [bookNumber],
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Make proximity search work for a book, if it can.
 *
 * Call this before `searchProximityInBook`. Building is a one-off cost per book
 * per module and is skipped once done.
 */
export function ensureBookIndex(
  sql: BunSql,
  repo: BibleRepository,
  bookNumber: number,
): BookIndexResult {
  try {
    if (isBookIndexed(sql, bookNumber)) {
      return { state: 'ready', detail: undefined };
    }
  } catch {
    // The table is missing entirely — an older or hand-made module.
    return {
      state: 'unavailable',
      detail: 'this module has no proximity-search tables',
    };
  }

  try {
    repo.buildBookIndex(bookNumber);
    return { state: 'built', detail: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/readonly|read-only/i.test(message)) {
      return {
        state: 'unavailable',
        detail:
          'proximity search needs to build an index inside the module file, ' +
          'and this module is read-only',
      };
    }
    throw error;
  }
}
