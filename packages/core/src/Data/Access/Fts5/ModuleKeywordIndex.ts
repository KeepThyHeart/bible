/**
 * Where content repositories find a module's keyword index.
 *
 * Through module schema v0.1 every module shipped its own FTS5 table
 * (`bible_verse_fts`, `commentary_entry_fts`, ...), and every repository's
 * search method queried it directly. v0.2 removed those tables (see
 * `docs/features/module-format.md`): the index is now an app-side sidecar, one
 * `.kwi` per module revision, built and owned by {@link SidecarFts5Provider}.
 *
 * The repositories are constructed in dozens of places - both apps' module
 * loaders, `SqliteModuleRepositoryFactory`, every test that opens a real
 * module - and none of them has a reason to know where an index directory
 * is. So the composition root that DOES know (the web server's
 * `DatabaseManager`, the desktop's `KeywordIndexService`, the core test setup)
 * configures one provider here, once, and every repository and
 * `BibleSearchService` reads it. A v0.1 module that still carries its own
 * table keeps using that table; nothing here changes how one is searched.
 */

import { ISql } from '../../Core/ISql';
import type { SidecarFts5Provider } from './SidecarFts5Provider';

let configuredProvider: SidecarFts5Provider | null = null;

/**
 * Make `provider` the sidecar every content repository and
 * `BibleSearchService` searches through. `null` turns sidecar search off again
 * (tests use this to restore isolation).
 *
 * Takes effect for searches made after the call, including on repositories
 * that already exist: a repository asks on every search, not at construction.
 */
export function configureModuleKeywordIndex(provider: SidecarFts5Provider | null): void {
  configuredProvider = provider;
}

/** The provider configured by {@link configureModuleKeywordIndex}, or `null`. */
export function moduleKeywordIndex(): SidecarFts5Provider | null {
  return configuredProvider;
}

/**
 * Whether `table` exists in this connection's main schema - the test for "is
 * this a v0.1 module that ships its own FTS5 index". Only `main` is looked at,
 * so a sidecar attached under another schema name never counts.
 *
 * `table` is a fixed identifier from the calling repository, never user input,
 * and is bound as a parameter regardless.
 */
export function hasModuleTable(sql: ISql, table: string): boolean {
  const row = sql.queryOne<{ found: number }>(
    `SELECT 1 AS found FROM main.sqlite_master WHERE type = 'table' AND name = ?`,
    [table]
  );
  return row !== undefined;
}
