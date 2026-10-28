import * as fs from 'fs';
import type { ISql, SqlParameter, SqlResult, SqlRow } from '@bible/core';
import { validateModuleFile, hasSqliteHeader, nodeCodecRegistry } from '@bible/core';

/**
 * The structural + canon conformance gate for an untrusted module file, as a
 * plain function of the file path and the canonical chapter map. It touches no
 * app state, so it runs equally on the main thread (`InstallationService`'s
 * fallback and its unit tests) and in the install worker thread
 * (`moduleInstallWorker.ts`), where its synchronous SQLite scans cannot freeze
 * the window.
 */

export const REQUIRED_CANON = 'protestant-66';
export const REQUIRED_VERSIFICATION = 'kjv-english';
export const MAX_BOOK_NUMBER = 66;

/**
 * First 16 bytes of `path`, or `null` if fewer than 16 could be read at all
 * (missing, empty, permission error, or a file shorter than a SQLite header
 * could ever be). Never throws - `hasSqliteHeader()` is the byte comparison;
 * this is only the driver-agnostic read of the bytes it compares, mirrored in
 * `moduleDetector.ts` (which cannot share this exact function - Electron main
 * and this file are not otherwise coupled - but shares the comparison itself
 * via `hasSqliteHeader()`).
 */
export function readHeaderBytes(path: string): Uint8Array | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    return bytesRead < 16 ? null : buffer;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/**
 * Minimal read-only `ISql` view over an already-open `better-sqlite3`-style
 * handle, so `validateModuleFile()` - written against `ISql`, not a specific
 * driver - can run against the SAME connection `validateModuleForInstall`
 * already opened, instead of opening the file a second time. Only the two
 * read methods it actually calls (`queryOne`, `queryAll`) are meaningfully
 * implemented; this adapter is never handed to anything that would write.
 */
export class ReadOnlyRawDbSql implements ISql {
  constructor(private readonly db: any, private readonly dbPath: string) {}

  queryOne<T = SqlRow>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T | undefined {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.get(params) : stmt.get()) as T | undefined;
  }

  queryAll<T = SqlRow>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T[] {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.all(params) : stmt.all()) as T[];
  }

  execute(): SqlResult {
    throw new Error('ReadOnlyRawDbSql is read-only: validateModuleFile() never writes.');
  }

  transaction<T>(callback: () => T): T {
    return callback();
  }

  close(): void {
    // Owned and closed by validateModuleForInstall's own `finally`, not here.
  }

  isOpen(): boolean {
    return true;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }
}

export function validateModuleFileForInstall(
  dbPath: string,
  canon: Map<number, number[]>
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Real byte check, not "did opening throw" - refuses a truncated download
  // or a non-SQLite file before any SQLite driver ever touches it. Runs
  // again here even though `installModule` already ran `verifyModule`
  // first, because this method is public and callable on its own (tests,
  // and any future call site) and must stand on its own.
  const header = readHeaderBytes(dbPath);
  if (!header || !hasSqliteHeader(header)) {
    return { ok: false, errors: [`Not a SQLite database (missing or corrupt file header): ${dbPath}`], warnings: [] };
  }

  const Database = require('better-sqlite3-multiple-ciphers');
  let db: any;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (e) {
    return { ok: false, errors: [`Cannot open database: ${(e as Error).message}`], warnings: [] };
  }

  try {
    const tables = new Set<string>(
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
        .all()
        .map((r: { name: string }) => r.name)
    );

    // module_info: present, single row at info_id = 1, valid identity block.
    if (!tables.has('module_info')) {
      errors.push('`module_info` table is missing.');
    } else {
      const info = db.prepare('SELECT * FROM module_info WHERE info_id = 1').get();
      if (!info) {
        errors.push('`module_info` has no row with info_id = 1.');
      } else {
        // module_uuid / format_version / compression: the F5 rule table,
        // via the one shared implementation - see validateModuleFile's doc
        // comment for the allow-list philosophy and why the codec check is
        // a warning rather than an error.
        const validation = validateModuleFile(new ReadOnlyRawDbSql(db, dbPath), nodeCodecRegistry());
        for (const issue of validation.issues) {
          (issue.severity === 'error' ? errors : warnings).push(issue.message);
        }

        if (info.canon !== undefined && info.canon !== REQUIRED_CANON) {
          errors.push(`\`canon\` = ${JSON.stringify(info.canon)}; only '${REQUIRED_CANON}' is accepted.`);
        }
        if (info.versification !== undefined && info.versification !== REQUIRED_VERSIFICATION) {
          errors.push(`\`versification\` = ${JSON.stringify(info.versification)}; only '${REQUIRED_VERSIFICATION}' is accepted.`);
        }
      }
    }

    // Required uniform tables (section 8).
    for (const t of ['verse_link', 'schema_version']) {
      if (!tables.has(t)) errors.push(`Required table \`${t}\` is missing.`);
    }

    // Shifted-canon rejection for Bible modules.
    if (tables.has('bible_verse')) {
      errors.push(...checkBibleCanonForInstall(db, canon));
    }
  } catch (e) {
    errors.push(`Validation error: ${(e as Error).message}`);
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Reject shifted / out-of-canon numbering. A canonical *subset* passes; only a
 * book outside 1-66 or a chapter/verse that exceeds the canonical count fails.
 */
export function checkBibleCanonForInstall(db: any, canon: Map<number, number[]>): string[] {
  const errors: string[] = [];
  if (canon.size === 0) return errors; // no reference space to check against

  const rows: { book_number: number; chapter: number; max_verse: number }[] = db.prepare(`
    SELECT verse_id / 1000000            AS book_number,
           (verse_id % 1000000) / 1000   AS chapter,
           MAX(verse_id % 1000)          AS max_verse
    FROM bible_verse
    GROUP BY book_number, chapter
  `).all();

  const maxChapterSeen = new Map<number, number>();
  for (const row of rows) {
    maxChapterSeen.set(row.book_number, Math.max(maxChapterSeen.get(row.book_number) ?? 0, row.chapter));
  }

  for (const row of rows) {
    const canonChapters = canon.get(row.book_number);
    if (row.book_number < 1 || row.book_number > MAX_BOOK_NUMBER || !canonChapters) {
      errors.push(`Book ${row.book_number} is outside the 66-book Protestant canon.`);
      continue;
    }
    if ((maxChapterSeen.get(row.book_number) ?? 0) > canonChapters.length) {
      errors.push(`Book ${row.book_number} has chapters beyond its canonical count (${canonChapters.length}).`);
    }
    const expectedVerses = canonChapters[row.chapter - 1];
    if (row.chapter >= 1 && row.chapter <= canonChapters.length && row.max_verse > expectedVerses) {
      errors.push(`Book ${row.book_number} chapter ${row.chapter}: verse ${row.max_verse} exceeds canonical count ${expectedVerses}.`);
    }
  }

  // De-duplicate (book-level messages can repeat across chapters).
  return [...new Set(errors)];
}
