/**
 * `createUserSchema` / `migrateUserSchema` (task 0150): the one user schema both platforms create.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { loadSchemaSql } from '../../Data/Schema';
import {
  createUserSchema, migrateUserSchema, USER_SCHEMA_DDL, MEMORY_DDL, MEMORY_TABLES, MEMORY_IMPORT_TABLE,
} from '../../Data/UserSchema';
import {
  USER_TABLES, USER_SCHEMA_VERSION, EXCLUDED_TABLES, isClassified, readUserSchemaVersion,
} from '../../Backup/Registry';

let db: TestSqliteProvider;
beforeEach(() => { db = new TestSqliteProvider(':memory:'); });
afterEach(() => db.close());

const tablesOf = (d: TestSqliteProvider = db) =>
  d.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
const colsOf = (t: string, d: TestSqliteProvider = db) =>
  d.queryAll<{ name: string }>(`PRAGMA table_info("${t}")`).map((r) => r.name);
const pkOf = (t: string, d: TestSqliteProvider = db) =>
  d.queryAll<{ name: string; pk: number }>(`PRAGMA table_info("${t}")`).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
const schemaSnapshot = () =>
  db.queryAll<{ type: string; name: string; sql: string | null }>('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');

describe('createUserSchema on an empty database', () => {
  it('creates every registered table with required columns present and no unknown ones', () => {
    createUserSchema(db);
    for (const spec of USER_TABLES) {
      expect(tablesOf(), spec.name).toContain(spec.name);
      const cols = colsOf(spec.name);
      const required = spec.columns.filter((c) => !(spec.optionalColumns ?? []).includes(c));
      for (const c of required) expect(cols, `${spec.name}.${c}`).toContain(c);
      for (const c of cols) expect(spec.columns, `${spec.name}.${c} is not in the registry`).toContain(c);
      expect(pkOf(spec.name), spec.name).toEqual(spec.pk);
    }
  });

  it('creates the optional user_note.sort_order for fresh databases', () => {
    createUserSchema(db);
    expect(colsOf('user_note')).toContain('sort_order');
  });

  it('classifies every table it creates, and creates no sync bookkeeping or sync_metadata', () => {
    createUserSchema(db);
    expect(tablesOf().filter((t) => !isClassified(t))).toEqual([]);
    expect(tablesOf().filter((t) => t.startsWith('sync_'))).toEqual([]);
    expect(tablesOf()).not.toContain('sync_metadata');
  });

  it('creates the memory tables, including the excluded push-card and import tables', () => {
    createUserSchema(db);
    for (const t of [...MEMORY_TABLES, MEMORY_IMPORT_TABLE]) expect(tablesOf(), t).toContain(t);
    for (const t of ['memory_push_card', 'memory_import']) expect(EXCLUDED_TABLES).toContain(t);
  });

  it('stamps the current schema version', () => {
    expect(readUserSchemaVersion(db)).toBe(0);
    createUserSchema(db);
    expect(readUserSchemaVersion(db)).toBe(USER_SCHEMA_VERSION);
  });

  it('makes FTS5 note search work (porter stemming) for new notes', () => {
    createUserSchema(db);
    db.execute("INSERT INTO user_note (content, title, tags) VALUES ('The LORD is my shepherd', 'Psalm', '[\"trust\"]')");
    const hit = (q: string) => db.queryAll<{ note_id: number }>('SELECT note_id FROM user_note_fts WHERE user_note_fts MATCH ?', [q]);
    expect(hit('shepherd')).toHaveLength(1);
    expect(hit('shepherds')).toHaveLength(1); // porter stemming
  });

  it('keeps the desktop constraints and foreign-key actions', () => {
    createUserSchema(db);
    expect(() => db.execute("INSERT INTO user_note (content, note_type) VALUES ('x', 'nonsense')")).toThrow();
    db.execute("INSERT INTO user_note (content) VALUES ('n')");
    db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (1, 43003016, 43003016)');
    db.execute('DELETE FROM user_note');
    expect(db.queryAll('SELECT * FROM note_verse_link')).toHaveLength(0); // ON DELETE CASCADE
  });

  it('cascades the memory tables (card -> attempt -> recite detail)', () => {
    createUserSchema(db);
    db.execute("INSERT INTO memory_collection (name, created_at) VALUES ('Default', 1)");
    db.execute("INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 1)");
    db.execute("INSERT INTO memory_card (passage_id, rung, state) VALUES (1, 'r1', 'new')");
    db.execute('INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 1, 1.0, 1, 1)');
    db.execute('DELETE FROM memory_collection');
    expect(db.queryAll('SELECT * FROM memory_attempt')).toHaveLength(0);
  });
});

describe('idempotence', () => {
  it('a second createUserSchema changes nothing', () => {
    createUserSchema(db);
    const before = schemaSnapshot();
    createUserSchema(db);
    expect(schemaSnapshot()).toEqual(before);
  });

  it('keeps existing rows across repeated runs', () => {
    createUserSchema(db);
    db.execute("INSERT INTO collection (name) VALUES ('Favourites')");
    createUserSchema(db);
    expect(db.queryAll('SELECT name FROM collection')).toEqual([{ name: 'Favourites' }]);
  });

  it('the DDL list has no statement that is not IF NOT EXISTS', () => {
    for (const st of [...USER_SCHEMA_DDL, ...MEMORY_DDL]) {
      expect(st, st.slice(0, 60)).toMatch(/IF NOT EXISTS/);
    }
  });
});

describe('migrateUserSchema', () => {
  it('stamps an empty database stamped 0 and reports the move', () => {
    createUserSchema(db);
    db.execute('PRAGMA user_version = 0');
    expect(migrateUserSchema(db)).toEqual({ from: 0, to: USER_SCHEMA_VERSION });
    expect(readUserSchemaVersion(db)).toBe(USER_SCHEMA_VERSION);
  });

  it('is a no-op on a current database', () => {
    createUserSchema(db);
    const before = schemaSnapshot();
    expect(migrateUserSchema(db)).toEqual({ from: USER_SCHEMA_VERSION, to: USER_SCHEMA_VERSION });
    expect(schemaSnapshot()).toEqual(before);
  });

  it('never lowers a stamp a newer build wrote', () => {
    createUserSchema(db);
    db.execute('PRAGMA user_version = 9');
    expect(migrateUserSchema(db)).toEqual({ from: 9, to: 9 });
    createUserSchema(db);
    expect(readUserSchemaVersion(db)).toBe(9);
  });

  it('rolls back the stamp when a statement fails, so the next open retries', () => {
    // A table of the wrong shape under a registered name: CREATE TABLE IF NOT EXISTS skips it, then its
    // index statements fail. Everything created before that point must roll back with the stamp.
    db.exec('CREATE TABLE user_text_markup (x INTEGER)');
    db.execute('PRAGMA user_version = 1');
    expect(() => migrateUserSchema(db)).toThrow();
    expect(readUserSchemaVersion(db)).toBe(1);
    expect(tablesOf()).not.toContain('user_commentary');
  });
});

describe('UserDatabase.sql stays the reference for the same schema', () => {
  it('has the same tables, columns and primary keys as createUserSchema', () => {
    const ref = new TestSqliteProvider(':memory:');
    try {
      const schema = loadSchemaSql(path.resolve(__dirname, '../../../sql/schemas/initial/UserDatabase.sql'))
        .split('\n').map((l) => (/^\s*PRAGMA\s/i.test(l) ? `-- ${l}` : l)).join('\n');
      ref.exec(schema);
      createUserSchema(db);
      const bookkeeping = new Set(['schema_version', 'schema_migration']);
      const created = tablesOf().filter((t) => !t.startsWith('user_note_fts_'));
      const refTables = tablesOf(ref).filter((t) => !bookkeeping.has(t) && !t.startsWith('user_note_fts_'));
      expect(created).toEqual(refTables);
      for (const t of refTables) {
        if (t === 'user_note_fts') continue;
        // The reference file is the source of truth for the column set; the created shape may lack nothing it has.
        expect(colsOf(t), t).toEqual(colsOf(t, ref));
        expect(pkOf(t), t).toEqual(pkOf(t, ref));
      }
    } finally {
      ref.close();
    }
  });
});
