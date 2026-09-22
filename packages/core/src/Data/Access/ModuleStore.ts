/**
 * Store and connection abstractions for module files (task 0026, "Swappable
 * Data Access", revision 2, subtask M11 - "Store and factory").
 *
 * M11 is a *construction* refactor, not an interface merge: the per-type
 * repository interfaces (`IBibleRepository`, `IDictionaryRepository`, ...)
 * keep their exact shape - see `ModuleRepositoryFactory.ts` for why there is
 * deliberately no generic `IModuleRepository`. What changes here is how a
 * module's connection is *opened* and how a repository is *constructed* over
 * it: today every caller hard-codes "open this path with better-sqlite3 /
 * sql.js, then `new XRepository(db)`"; `IModuleStore` names the open step and
 * `IModuleRepositoryFactory` (in `./ModuleRepositoryFactory.ts`) names the
 * construction step, so a second storage scheme (a document store, a remote
 * read-only mirror, ...) is one new pair of classes, not a hunt through every
 * caller that currently assumes SQLite.
 *
 * Only one `IModuleStore` is implemented anywhere in this codebase today -
 * {@link SqliteModuleStore}, in `./SqliteModuleStore.ts` - because only one
 * storage scheme exists to implement. The seam is built so that stays true
 * without anyone having planned the second store yet.
 */

import type { ISql } from '../Core/ISql';

/**
 * Where a module's bytes live. A discriminated union rather than a bare
 * string/path, because "how do I address this module" is genuinely different
 * per storage scheme: a filesystem path today, an OPFS file name in a browser
 * tomorrow, a remote URL for a read-only mirror.
 */
export type ModuleLocator =
  | { kind: 'file'; path: string }
  | { kind: 'opfs'; name: string }
  | { kind: 'remote'; url: string };

/**
 * One open module connection. `sql` is present for SQL-backed stores only - a
 * document store (CSV, JSON, ...) leaves it `undefined` and hands its
 * repositories whatever it needs internally instead; nothing outside the
 * store that opened the connection is entitled to assume `sql` exists.
 */
export interface IModuleConnection {
  readonly locator: ModuleLocator;
  /** `!opts.readonly` from whatever `IModuleStore.open()` call produced this. */
  readonly writable: boolean;
  readonly sql?: ISql;
  close(): void;
}

/**
 * A storage scheme for module files: the "how do I open one of these" half of
 * the M11 seam. `extensions` is what module discovery (`moduleDetector.ts`)
 * asks every registered store for, instead of hard-coding `.db` - see that
 * file's doc comment.
 */
export interface IModuleStore {
  /** 'sqlite', 'csv-dictionary', 'json-bible', ... */
  readonly id: string;
  /** File extensions this store's `canOpen()` accepts, lower-case, each including its leading dot. */
  readonly extensions: string[];
  canOpen(loc: ModuleLocator): boolean;
  open(loc: ModuleLocator, opts: { readonly: boolean }): IModuleConnection;
}
