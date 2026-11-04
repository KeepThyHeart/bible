// @vitest-environment node
/**
 * Start-up registry repair. Driven through `node:sqlite` rather than
 * `SqliteProvider`: the desktop's native driver is usually built for
 * Electron's ABI, which would skip these tests under plain Node, and the
 * repair only needs the `ISql` surface.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import type { ISql } from '@bible/core';

/**
 * The slice of `node:sqlite` used here. Loaded through `createRequire` and
 * typed locally because the workspace's `@types/node` predates the module.
 */
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  close(): void;
  readonly isOpen: boolean;
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};
import {
  findDuplicateRegistrations,
  normalizeRegistryPath,
  repairModuleRegistry,
} from '../moduleRegistryIntegrity';

function sqlOver(db: DatabaseSync): ISql {
  return {
    queryOne: (sql: string, params: unknown[] = []) => db.prepare(sql).get(...(params as never[])) as never,
    queryAll: (sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as never,
    execute: (sql: string, params: unknown[] = []) => {
      const r = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) } as never;
    },
    transaction: <T>(fn: () => T): T => {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
    isOpen: () => db.isOpen,
  } as unknown as ISql;
}

function createMainDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE module_metadata (
      module_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_uuid TEXT,
      module_type TEXT NOT NULL,
      module_name TEXT NOT NULL,
      abbreviation TEXT,
      database_path TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_module_uuid ON module_metadata(module_uuid);
    CREATE TABLE module_update (
      update_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL REFERENCES module_metadata(module_id) ON DELETE CASCADE
    );
  `);
  return db;
}

function createUserDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE user_text_markup (markup_id INTEGER PRIMARY KEY, module_id INTEGER NOT NULL);
    CREATE TABLE pinned_item (pin_id INTEGER PRIMARY KEY, module_id INTEGER);
    CREATE TABLE module_display_option (
      option_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL,
      option_key TEXT NOT NULL,
      option_value TEXT,
      UNIQUE(module_id, option_key)
    );
  `);
  return db;
}

function register(db: DatabaseSync, type: string, abbr: string, uuid: string, path: string): number {
  const r = db
    .prepare('INSERT INTO module_metadata (module_uuid, module_type, module_name, abbreviation, database_path) VALUES (?, ?, ?, ?, ?)')
    .run(uuid, type, abbr, abbr, path);
  return Number(r.lastInsertRowid);
}

const ids = (db: DatabaseSync): number[] =>
  (db.prepare('SELECT module_id FROM module_metadata ORDER BY module_id').all() as { module_id: number }[]).map((r) => r.module_id);

describe('normalizeRegistryPath', () => {
  it('uses forward slashes and drops a leading ./', () => {
    expect(normalizeRegistryPath('modules\\bible_kjv.db')).toBe('modules/bible_kjv.db');
    expect(normalizeRegistryPath('./modules/x.db')).toBe('modules/x.db');
  });
});

describe('findDuplicateRegistrations', () => {
  it('keeps the row whose uuid matches the file, wherever it sits', () => {
    const db = createMainDb();
    const current = register(db, 'commentary', 'Barnes', 'uuid-current', 'modules/commentary_barnes.db');
    const stale = register(db, 'commentary', 'Barnes', 'uuid-stale', 'modules/commentary_barnes.db');

    const [dup] = findDuplicateRegistrations(sqlOver(db), () => 'uuid-current', false);
    expect(dup).toMatchObject({ keep: current, remove: [stale] });
  });

  it('keeps the newest row when the file cannot be read', () => {
    const db = createMainDb();
    const older = register(db, 'bible', 'KJV', 'a', 'modules/bible_kjv.db');
    const newer = register(db, 'bible', 'KJV', 'b', 'modules/bible_kjv.db');

    const [dup] = findDuplicateRegistrations(sqlOver(db), () => undefined, false);
    expect(dup).toMatchObject({ keep: newer, remove: [older] });
  });

  it('treats back-slashed and differently-cased paths as the same file when asked to', () => {
    const db = createMainDb();
    register(db, 'bible', 'WEBBE', 'a', 'modules\\bible_webbe.db');
    register(db, 'bible', 'WEBBE', 'b', 'Modules/bible_webbe.db');

    expect(findDuplicateRegistrations(sqlOver(db), () => undefined, true)).toHaveLength(1);
    // Case-sensitive: only the separators differ from the stored form, the case does not match.
    expect(findDuplicateRegistrations(sqlOver(db), () => undefined, false)).toEqual([]);
  });

  it('does not treat a shared abbreviation on different files as a duplicate', () => {
    const db = createMainDb();
    register(db, 'bible', 'KJV', 'a', 'modules/bible_kjv.db');
    register(db, 'bible', 'KJV', 'b', 'modules/bible_kjv_other.db');

    expect(findDuplicateRegistrations(sqlOver(db), () => undefined, false)).toEqual([]);
  });
});

describe('repairModuleRegistry', () => {
  let main: DatabaseSync;
  let user: DatabaseSync;

  beforeEach(() => {
    main = createMainDb();
    user = createUserDb();
  });

  it('merges duplicate rows and moves the user references to the survivor', async () => {
    const stale = register(main, 'commentary', 'Barnes', 'uuid-stale', 'modules/commentary_barnes.db');
    const current = register(main, 'commentary', 'Barnes', 'uuid-current', 'modules/commentary_barnes.db');
    const other = register(main, 'bible', 'KJV', 'uuid-kjv', 'modules/bible_kjv.db');
    main.prepare('INSERT INTO module_update (module_id) VALUES (?)').run(stale);

    user.prepare('INSERT INTO user_text_markup (module_id) VALUES (?), (?), (?)').run(stale, stale, other);
    user.prepare('INSERT INTO pinned_item (module_id) VALUES (?)').run(stale);
    // Same option on both rows: the survivor's value wins; a distinct option moves.
    user.prepare("INSERT INTO module_display_option (module_id, option_key, option_value) VALUES (?, 'font', 'stale')").run(stale);
    user.prepare("INSERT INTO module_display_option (module_id, option_key, option_value) VALUES (?, 'font', 'kept')").run(current);
    user.prepare("INSERT INTO module_display_option (module_id, option_key, option_value) VALUES (?, 'size', '14')").run(stale);

    const result = await repairModuleRegistry(sqlOver(main), {
      readFileUuid: () => 'uuid-current',
      getUserDb: async () => sqlOver(user),
      caseInsensitivePaths: false,
    });

    expect(result).toMatchObject({ duplicateFiles: 1, rowsRemoved: 1 });
    expect(ids(main)).toEqual([current, other]);
    expect(main.prepare('SELECT COUNT(*) c FROM module_update').get()).toEqual({ c: 0 });

    const markup = user.prepare('SELECT module_id FROM user_text_markup ORDER BY markup_id').all() as { module_id: number }[];
    expect(markup.map((r) => r.module_id)).toEqual([current, current, other]);
    expect(user.prepare('SELECT module_id FROM pinned_item').get()).toEqual({ module_id: current });
    expect(
      user.prepare('SELECT module_id, option_key, option_value FROM module_display_option ORDER BY option_key').all()
    ).toEqual([
      { module_id: current, option_key: 'font', option_value: 'kept' },
      { module_id: current, option_key: 'size', option_value: '14' },
    ]);

    const stable = main.prepare('SELECT module_key, module_id FROM module_link_stability').all();
    expect(stable).toEqual([{ module_key: 'commentary:barnes', module_id: current }]);
  });

  it('gives the survivor the file uuid when it carries a stale one', async () => {
    register(main, 'bible', 'KJV', 'old-1', 'modules/bible_kjv.db');
    const newest = register(main, 'bible', 'KJV', 'old-2', 'modules/bible_kjv.db');

    await repairModuleRegistry(sqlOver(main), {
      readFileUuid: () => 'from-file',
      getUserDb: async () => sqlOver(user),
      caseInsensitivePaths: false,
    });

    expect(main.prepare('SELECT module_id, module_uuid FROM module_metadata').all()).toEqual([
      { module_id: newest, module_uuid: 'from-file' },
    ]);
  });

  it('leaves duplicates in place when the user database cannot be opened', async () => {
    register(main, 'bible', 'KJV', 'a', 'modules/bible_kjv.db');
    register(main, 'bible', 'KJV', 'b', 'modules/bible_kjv.db');

    const result = await repairModuleRegistry(sqlOver(main), {
      readFileUuid: () => undefined,
      getUserDb: async () => {
        throw new Error('locked');
      },
      caseInsensitivePaths: false,
    });

    expect(result.rowsRemoved).toBe(0);
    expect(ids(main)).toHaveLength(2);
  });

  it('does not open the user database when there is nothing to merge', async () => {
    register(main, 'bible', 'KJV', 'a', 'modules/bible_kjv.db');
    const getUserDb = vi.fn(async () => sqlOver(user));

    await repairModuleRegistry(sqlOver(main), { readFileUuid: () => undefined, getUserDb, caseInsensitivePaths: false });

    expect(getUserDb).not.toHaveBeenCalled();
  });

  it('normalizes back-slashed paths and keeps rows whose file is missing', async () => {
    register(main, 'bible', 'WEBBE', 'a', 'modules\\bible_webbe.db');
    register(main, 'dictionary', 'Gone', 'b', 'modules/dictionary_gone.db');

    const result = await repairModuleRegistry(sqlOver(main), {
      readFileUuid: () => undefined,
      getUserDb: async () => sqlOver(user),
      caseInsensitivePaths: false,
    });

    expect(result.pathsNormalized).toBe(1);
    expect(main.prepare('SELECT database_path FROM module_metadata ORDER BY module_id').all()).toEqual([
      { database_path: 'modules/bible_webbe.db' },
      { database_path: 'modules/dictionary_gone.db' },
    ]);
  });

  it('reports, but keeps, one abbreviation registered for two different files', async () => {
    register(main, 'bible', 'KJV', 'a', 'modules/bible_kjv.db');
    register(main, 'bible', 'KJV', 'b', 'modules/bible_kjv_other.db');

    const result = await repairModuleRegistry(sqlOver(main), {
      readFileUuid: () => undefined,
      getUserDb: async () => sqlOver(user),
      caseInsensitivePaths: false,
    });

    expect(result.sharedAbbreviations).toEqual(['bible:KJV']);
    expect(ids(main)).toHaveLength(2);
  });
});
