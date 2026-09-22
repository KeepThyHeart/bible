/**
 * Regression test for a bug caught by independent verification of M11 (task
 * 0026 revision 2) after it was committed, fixed the same day: the core
 * `ModuleLoader`'s new `readonly: true` default (M11) flowed, via
 * `createRegistrySqlFactory`, into `ModuleDatabaseRegistry.openByPath` - but
 * `bibleHandlers.ts`'s desktop `ModuleLoader` did not override it, even
 * though `BibleRepository.buildBookIndex()` (the book-level proximity search
 * index) still writes into a Bible module's own file lazily on first use
 * (M3/M5 deliberately left this one write path unmigrated). The write then
 * threw `attempt to write a readonly database`, caught and silently
 * swallowed by `BibleSearchService`'s `isReadOnlyDatabaseError` handling -
 * so proximity search across every Bible module on desktop silently stopped
 * working, with no crash and (before this test) nothing to catch it.
 *
 * This test exercises the exact mechanism the bug and its fix live in -
 * `createRegistrySqlFactory`'s `readonly` threading through to a real
 * `better-sqlite3` connection's actual write permission - without needing to
 * wire up the full Electron `sharedMainDb`/IPC singleton chain
 * `bibleHandlers.ts` itself depends on, which is orthogonal to what broke.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createRegistrySqlFactory,
  __resetModuleDatabaseRegistryForTests,
} from './ModuleDatabaseRegistry';

const nativeSqliteAvailable = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!nativeSqliteAvailable)('createRegistrySqlFactory - readonly threading (M11 fix-up)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    __resetModuleDatabaseRegistryForTests();
    tmpDir = mkdtempSync(join(tmpdir(), 'module-db-registry-readonly-'));
    dbPath = join(tmpDir, 'test-module.db');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    const seed = new Database(dbPath);
    seed.exec('CREATE TABLE book_search_index (book_number INTEGER PRIMARY KEY, text TEXT)');
    seed.close();
  });

  afterEach(() => {
    __resetModuleDatabaseRegistryForTests();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readonly: true produces a connection that refuses a real write - the exact failure mode the regression hit', () => {
    const factory = createRegistrySqlFactory('bible');
    const sql = factory.create(dbPath, { readonly: true });

    expect(() => sql.execute('INSERT INTO book_search_index (book_number, text) VALUES (1, ?)', ['Genesis'])).toThrow(
      /readonly/i
    );
  });

  it('readonly: false produces a genuinely writable connection - what bibleHandlers.ts now passes explicitly', () => {
    const factory = createRegistrySqlFactory('bible');
    const sql = factory.create(dbPath, { readonly: false });

    expect(() =>
      sql.execute('INSERT INTO book_search_index (book_number, text) VALUES (1, ?)', ['Genesis'])
    ).not.toThrow();

    const row = sql.queryOne<{ text: string }>('SELECT text FROM book_search_index WHERE book_number = 1');
    expect(row?.text).toBe('Genesis');
  });

  it('two different callers asking for the same path share one cached connection (first opener wins) - unchanged by this fix', () => {
    const factory = createRegistrySqlFactory('bible');
    const first = factory.create(dbPath, { readonly: false });
    const second = factory.create(dbPath, { readonly: true });

    // Same underlying provider (registry caches by path) - the second
    // request's readonly:true does NOT retroactively make it read-only,
    // exactly as ModuleDatabaseRegistry's own doc comment already states.
    // Not new behavior introduced by this fix; recorded here so a future
    // reader of the two tests above does not conclude every readonly:true
    // request is safe from a writable module elsewhere in the same run.
    expect(() =>
      second.execute('INSERT INTO book_search_index (book_number, text) VALUES (2, ?)', ['Exodus'])
    ).not.toThrow();
    expect(first).toBe(second);
  });
});
