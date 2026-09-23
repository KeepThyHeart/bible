import Database from 'better-sqlite3';
import { SqlParameter, SqlResult } from '../../Data/Core/ISql';
import { SidecarDatabaseOpener, SidecarOpenOptions, SidecarSql } from '../../Data/Access/Fts5/SidecarFts5Provider';

/**
 * The {@link SidecarDatabaseOpener} the `SidecarFts5Provider` suites run
 * against - a real `better-sqlite3` connection, not a mock. `packages/core`
 * has no runtime SQLite dependency of its own (see `ISql.ts`), so the provider
 * takes its opener as configuration; this is the test-side supplier of one,
 * standing in for the composition root that supplies the app's.
 *
 * ## Why this is not `TestSqliteProvider`
 *
 * `TestSqliteProvider` is the right helper for repositories and it is
 * deliberately not reused here, for one concrete reason: it turns on
 * `journal_mode = WAL` for every writable connection. A `.kwi.part` must leave
 * NOTHING beside it, because the build finishes with a single
 * `fs.renameSync(part, final)` and a rename moves one file - a `-wal` or
 * `-shm` companion would be orphaned in the index directory, where the
 * provider's own directory scan (`pruneExcept`) would find a file it has no
 * rule for. The provider sets `journal_mode = OFF` itself, so a WAL header
 * written at open would be immediately undone, but the honest thing in a suite
 * whose whole subject is on-disk state is to not write it in the first place.
 *
 * `foreign_keys = ON`, the other pragma `TestSqliteProvider` sets, is
 * meaningless here: the `.kwi` schema declares no foreign keys.
 */
export const openTestSidecarDatabase: SidecarDatabaseOpener = (filePath, options) =>
  new TestSidecarDatabase(filePath, options);

class TestSidecarDatabase implements SidecarSql {
  private readonly db: Database.Database;

  constructor(private readonly filePath: string, options: SidecarOpenOptions) {
    // `fileMustExist` is the half that matters for the provider's state
    // machine: opening a missing `.kwi` read-only has to FAIL, not silently
    // produce an empty database that would then look like a corrupt index.
    this.db = new Database(filePath, {
      readonly: options.readonly,
      fileMustExist: !options.create,
    });
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  queryOne<T = unknown>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T | undefined {
    return this.db.prepare(sql).get(...bind(params)) as T | undefined;
  }

  queryAll<T = unknown>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T[] {
    return this.db.prepare(sql).all(...bind(params)) as T[];
  }

  execute(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): SqlResult {
    const result = this.db.prepare(sql).run(...bind(params));
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }

  isOpen(): boolean {
    return this.db.open;
  }

  getDatabasePath(): string {
    return this.filePath;
  }
}

/** Positional binds spread; a named-bind object is passed whole. Mirrors `TestSqliteProvider`. */
function bind(params?: SqlParameter[] | { [key: string]: SqlParameter }): unknown[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}
