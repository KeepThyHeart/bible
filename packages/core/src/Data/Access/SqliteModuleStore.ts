/**
 * The one `IModuleStore` implemented anywhere in this codebase today: every
 * shipped module is a `.db` SQLite file (task 0026, revision 2, subtask M11).
 *
 * The SQLite driver itself is injected, not imported - the same posture
 * `Services/ModuleLoader.ts`'s pre-M11 `SqlProviderFactory` already took, and
 * the same "inject the driver, keep the logic in core" split
 * `Data/Access/Fts5/SidecarFts5Provider.ts` uses for its own SQLite access:
 * `@bible/core` has no SQLite dependency of its own, so each platform
 * (`@bible/desktop`: better-sqlite3; `@bible/web`: better-sqlite3 under a
 * different alias; a future browser build: sql.js) hands this class a tiny
 * {@link SqlDriverFactory} rather than this class picking a driver itself.
 */

import type { ISql } from '../Core/ISql';
import type { IModuleConnection, IModuleStore, ModuleLocator } from './ModuleStore';

/** Creates `ISql` instances for an already-resolved absolute path, honoring `readonly`. */
export interface SqlDriverFactory {
  create(absolutePath: string, opts: { readonly: boolean }): ISql;
}

/**
 * File extensions {@link SqliteModuleStore} accepts - the one place `.db`
 * names the SQLite module scheme, so discovery (`moduleDetector.ts` in
 * `@bible/desktop`) can read it off a registered store's `extensions`
 * property instead of hard-coding the literal itself. Exported separately
 * from the class so a caller that only needs the extension list (discovery
 * never opens a connection) is not required to construct a store instance
 * with a driver purely to read a constant off it.
 */
export const SQLITE_MODULE_EXTENSIONS = ['.db'] as const;

class SqliteModuleConnection implements IModuleConnection {
  readonly sql: ISql;
  readonly writable: boolean;

  constructor(readonly locator: ModuleLocator, sql: ISql, writable: boolean) {
    this.sql = sql;
    this.writable = writable;
  }

  close(): void {
    this.sql.close();
  }
}

export class SqliteModuleStore implements IModuleStore {
  readonly id = 'sqlite';
  readonly extensions: string[] = [...SQLITE_MODULE_EXTENSIONS];

  constructor(private readonly driver: SqlDriverFactory) {}

  canOpen(loc: ModuleLocator): boolean {
    if (loc.kind !== 'file') return false;
    const lower = loc.path.toLowerCase();
    return this.extensions.some(ext => lower.endsWith(ext));
  }

  open(loc: ModuleLocator, opts: { readonly: boolean }): IModuleConnection {
    if (loc.kind !== 'file') {
      throw new Error(`SqliteModuleStore only opens 'file' locators, got '${loc.kind}'`);
    }
    const sql = this.driver.create(loc.path, opts);
    return new SqliteModuleConnection(loc, sql, !opts.readonly);
  }
}
