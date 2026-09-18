/**
 * `ISql` over `bun:sqlite` — the CLI's only binding to `@bible/core`'s data
 * layer (DesignSpec §2.2).
 *
 * Both sides are synchronous, so this is a direct mapping rather than an
 * adapter with buffering or promise plumbing. What it is *not* is a thin
 * pass-through: `bun:sqlite` and `better-sqlite3` — which every core
 * repository was written against — disagree in four ways that would otherwise
 * surface as silently wrong results. Each is handled below and labelled.
 */
import { Database, constants } from 'bun:sqlite';
import type { Statement } from 'bun:sqlite';

import type { ISql, SqlParameter, SqlResult, SqlRow } from '@bible/core';

type Params = SqlParameter[] | { [key: string]: SqlParameter };

export interface BunSqlOptions {
  /** Open read-only. Every module database is opened this way. */
  readonly?: boolean;
  /** Create the file if it is missing. Only `state.db` should set this. */
  create?: boolean;
  /**
   * Open with SQLite's `immutable=1`, which tells it the file cannot change
   * and to ignore any `-wal` / `-shm` sidecar beside it.
   *
   * This is the fix for DesignSpec §3.4: shipped modules are written in WAL
   * mode (verified — `PRAGMA journal_mode` on `bible_kjv.db` returns `wal`),
   * and a plain read-only open of a WAL database wants to touch the sidecar.
   *
   * Only ever set this for a tree nobody is writing. `immutable` makes SQLite
   * skip locking entirely, so if another process *is* mid-write — the desktop
   * app building a `book_search_index`, say — the read can see stale or torn
   * data. That is exactly why DesignSpec §3.2 restricts it to the bundled
   * tree and uses a plain read-only open for the user tree.
   */
  immutable?: boolean;
}

/** Cap on cached prepared statements. Bounded so a long session cannot grow without limit. */
const STATEMENT_CACHE_LIMIT = 256;

/** Detects `:name` / `@name` placeholders, which this class deliberately does not support. */
const UNSUPPORTED_NAMED_PARAM = /(?<![:\w]):[A-Za-z_]\w*|(?<!\w)@[A-Za-z_]\w*/;

export class BunSql implements ISql {
  private readonly db: Database;
  private readonly dbPath: string;
  private readonly statements = new Map<string, Statement>();
  private open = true;

  constructor(databasePath: string, options: BunSqlOptions = {}) {
    this.dbPath = databasePath;

    // Opened with numeric flags rather than the options object, because URI
    // filenames — and therefore `immutable=1` — are only parsed when
    // SQLITE_OPEN_URI is set, and the options object has no way to ask for it.
    // Verified: `new Database('file:...?immutable=1', { readonly: true })`
    // fails with "unable to open database file".
    let flags = options.readonly
      ? constants.SQLITE_OPEN_READONLY
      : constants.SQLITE_OPEN_READWRITE;
    if (options.create && !options.readonly) flags |= constants.SQLITE_OPEN_CREATE;
    flags |= constants.SQLITE_OPEN_URI;

    const filename = options.immutable
      ? `file:${toUriPath(databasePath)}?immutable=1`
      : databasePath;

    this.db = new Database(filename, flags);

    try {
      this.applyPragmas(options.readonly === true);
    } catch (error) {
      // `new Database` succeeds on a file that is not a database — the failure
      // surfaces at the first statement, which is here. Without this the handle
      // leaks: the constructor throws, no caller has a reference to close, and
      // on Windows the open handle keeps the bad file locked so it cannot even
      // be renamed out of the way. That is exactly what corruption recovery
      // needs to do.
      this.db.close();
      throw wrapSqlError(error, 'PRAGMA (opening database)');
    }
  }

  /**
   * Mirrors `SqliteProvider` in the desktop package. `journal_mode` and
   * `synchronous` write to the database header, so they fail on a read-only
   * connection and are skipped there — a reader gains nothing from WAL anyway.
   */
  private applyPragmas(readonly: boolean): void {
    this.db.run('PRAGMA foreign_keys = ON');
    if (!readonly) {
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = NORMAL');
    }
    this.db.run('PRAGMA temp_store = MEMORY');
    this.db.run('PRAGMA cache_size = -64000');
    this.db.run('PRAGMA busy_timeout = 5000');
  }

  private prepare(sql: string): Statement {
    const cached = this.statements.get(sql);
    if (cached) return cached;

    const stmt = this.db.prepare(sql);

    if (this.statements.size >= STATEMENT_CACHE_LIMIT) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldest = this.statements.keys().next();
      if (!oldest.done) {
        this.statements.get(oldest.value)?.finalize();
        this.statements.delete(oldest.value);
      }
    }

    this.statements.set(sql, stmt);
    return stmt;
  }

  queryOne<T = SqlRow>(sql: string, params?: Params): T | undefined {
    return this.run(sql, params, (stmt, bound) => {
      const row = bound === undefined ? stmt.get() : stmt.get(...bound);
      // `bun:sqlite` returns `null` for no row; `ISql` promises `undefined`,
      // and `better-sqlite3` delivers it. Code written against core's contract
      // may test `=== undefined`, so normalise rather than leak the difference.
      return (row ?? undefined) as T | undefined;
    });
  }

  queryAll<T = SqlRow>(sql: string, params?: Params): T[] {
    return this.run(sql, params, (stmt, bound) => {
      const rows = bound === undefined ? stmt.all() : stmt.all(...bound);
      return (rows ?? []) as T[];
    });
  }

  execute(sql: string, params?: Params): SqlResult {
    return this.run(sql, params, (stmt, bound) => {
      const info = bound === undefined ? stmt.run() : stmt.run(...bound);
      return {
        changes: info.changes,
        lastInsertRowId: Number(info.lastInsertRowid),
      };
    });
  }

  /**
   * Shared prepare / bind / execute path.
   *
   * The error wrapper keeps the driver's original message and `code` on the
   * thrown error. That is load-bearing, not tidiness:
   * `BibleRepository.buildBookIndex()` writes an index into the module
   * file and relies on core's `isReadOnlyDatabaseError()` to recognise the
   * refusal and degrade instead of failing the user's query. That helper
   * matches on `code` *or* on the message text, so both must survive.
   */
  private run<T>(
    sql: string,
    params: Params | undefined,
    body: (stmt: Statement, bound: SqlParameter[] | undefined) => T,
  ): T {
    try {
      return body(this.prepare(sql), bindArgs(sql, params));
    } catch (error) {
      throw wrapSqlError(error, sql);
    }
  }

  transaction<T>(callback: () => T): T {
    return this.db.transaction(callback)();
  }

  close(): void {
    if (!this.open) return;
    for (const stmt of this.statements.values()) stmt.finalize();
    this.statements.clear();
    this.db.close();
    this.open = false;
  }

  isOpen(): boolean {
    return this.open;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }
}

/**
 * Normalise `ISql`'s two parameter shapes into the positional list
 * `bun:sqlite` binds.
 *
 * Core itself only ever passes positional `?` parameters — verified across
 * `packages/core/src` — but `ISql` permits an object, and this is where the
 * two drivers diverge most dangerously. `better-sqlite3` accepts a bare-keyed
 * object for `:name`, `@name` and `$name` alike. `bun:sqlite` (outside its
 * `strict` mode, which is unavailable when opening with numeric flags) accepts
 * only `$name` with a `$`-prefixed key, and for the other two sigils it does
 * not throw — it binds nothing and the query silently returns no rows.
 *
 * So: `$name` is supported with either key spelling, and `:name` / `@name` are
 * rejected loudly rather than allowed to fail quietly.
 */
function bindArgs(sql: string, params: Params | undefined): SqlParameter[] | undefined {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) return params;

  if (UNSUPPORTED_NAMED_PARAM.test(stripStringLiterals(sql))) {
    throw new Error(
      'BunSql supports only the `$name` placeholder sigil with object parameters. ' +
        'This statement uses `:name` or `@name`, which bun:sqlite binds silently as ' +
        'nothing, yielding an empty result rather than an error. Rewrite the ' +
        `placeholders as $name.\nSQL: ${sql}`,
    );
  }

  const bound: Record<string, SqlParameter> = {};
  for (const [key, value] of Object.entries(params)) {
    bound[key.startsWith('$') ? key : `$${key}`] = value;
  }
  return [bound as unknown as SqlParameter];
}

/** Avoid mistaking a colon inside a string literal for a named placeholder. */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Windows paths need forward slashes and a leading `/` before a drive letter
 * to be a valid SQLite URI: `C:\x\y.db` → `/C:/x/y.db`.
 */
function toUriPath(path: string): string {
  const forward = path.replace(/\\/g, '/');
  return /^[A-Za-z]:/.test(forward) ? `/${forward}` : forward;
}

function wrapSqlError(error: unknown, sql: string): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const wrapped = new Error(`${original.message}\nSQL: ${sql}`, { cause: original });
  const code = (original as { code?: unknown }).code;
  if (code !== undefined) (wrapped as { code?: unknown }).code = code;
  return wrapped;
}
