/**
 * Upgrading databases that older builds created (user_version 0, 1, 2) to the current schema.
 * The fixtures are built from the old desktop DDL written out inline, not from core's current DDL,
 * so they stay what an old profile really looked like.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { createUserSchema, migrateUserSchema } from '../../Data/UserSchema';
import { USER_TABLES, USER_SCHEMA_VERSION, readUserSchemaVersion, isClassified } from '../../Backup/Registry';

let db: TestSqliteProvider;
beforeEach(() => { db = new TestSqliteProvider(':memory:'); });
afterEach(() => db.close());

/** The desktop user schema as the v1 build (before the memory tables) created it. */
const V1_DESKTOP_DDL = `
CREATE TABLE user_commentary (
  user_commentary_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
  created_date TEXT DEFAULT CURRENT_TIMESTAMP, modified_date TEXT DEFAULT CURRENT_TIMESTAMP,
  is_default INTEGER DEFAULT 0, color TEXT, metadata TEXT, CHECK (is_default IN (0, 1))
);
CREATE TABLE user_note (
  note_id INTEGER PRIMARY KEY AUTOINCREMENT, user_commentary_id INTEGER, parent_note_id INTEGER,
  verse_id_start INTEGER, verse_id_end INTEGER, title TEXT, content TEXT NOT NULL,
  content_format TEXT DEFAULT 'html', note_type TEXT DEFAULT 'verse_note', document_type TEXT,
  visibility TEXT DEFAULT 'private', created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP, tags TEXT, series_name TEXT, entry_date TEXT, metadata TEXT,
  CHECK (content_format IN ('html', 'markdown', 'plain')),
  CHECK (note_type IN ('verse_note', 'document', 'sermon', 'study', 'journal', 'prayer')),
  CHECK (visibility IN ('private', 'public'))
);
CREATE TABLE note_verse_link (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, verse_id_start INTEGER NOT NULL,
  verse_id_end INTEGER NOT NULL, link_type TEXT DEFAULT 'reference', word_start INTEGER, word_end INTEGER,
  metadata TEXT, FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE CASCADE,
  CHECK (link_type IN ('reference', 'annotation', 'primary_passage'))
);
CREATE VIRTUAL TABLE user_note_fts USING fts5(
  note_id UNINDEXED, title, content, tags, content='user_note', content_rowid='note_id', tokenize='porter unicode61'
);
CREATE TRIGGER user_note_fts_insert AFTER INSERT ON user_note BEGIN
  INSERT INTO user_note_fts(rowid, note_id, title, content, tags) VALUES (new.note_id, new.note_id, new.title, new.content, new.tags);
END;
CREATE TRIGGER user_note_fts_update AFTER UPDATE ON user_note BEGIN
  UPDATE user_note_fts SET title = new.title, content = new.content, tags = new.tags WHERE rowid = new.note_id;
END;
CREATE TRIGGER user_note_fts_delete AFTER DELETE ON user_note BEGIN
  DELETE FROM user_note_fts WHERE rowid = old.note_id;
END;
CREATE TABLE collection (
  collection_id INTEGER PRIMARY KEY AUTOINCREMENT, parent_collection_id INTEGER, name TEXT NOT NULL,
  description TEXT, color TEXT, icon TEXT, created_date TEXT DEFAULT CURRENT_TIMESTAMP,
  modified_date TEXT DEFAULT CURRENT_TIMESTAMP, sort_order INTEGER DEFAULT 0, metadata TEXT,
  FOREIGN KEY (parent_collection_id) REFERENCES collection(collection_id) ON DELETE CASCADE
);
CREATE TABLE extension_storage (
  extension_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (extension_id, key)
);
`;

/** What the v2 build added: the memory tables (a subset is enough to prove they survive). */
const V2_MEMORY_DDL = `
CREATE TABLE memory_collection (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE memory_passage (
  id INTEGER PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES memory_collection(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL, start_verse_id INTEGER NOT NULL, end_verse_id INTEGER NOT NULL, reference TEXT NOT NULL,
  verse_count INTEGER NOT NULL, added_at INTEGER NOT NULL, answer_mode TEXT, deleted_at INTEGER,
  recite_on INTEGER NOT NULL DEFAULT 0
);
`;

function seed(version: 0 | 1 | 2): void {
  db.exec(V1_DESKTOP_DDL);
  db.execute("INSERT INTO user_note (title, content, tags) VALUES ('Shepherd', 'The LORD is my shepherd', '[\"trust\"]')");
  db.execute("INSERT INTO user_note (title, content) VALUES ('Light', 'Thy word is a lamp')");
  db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (1, 19023001, 19023001)');
  db.execute("INSERT INTO collection (name) VALUES ('Favourites')");
  db.execute("INSERT INTO extension_storage VALUES ('ext.a', 'k', 'v', 1)");
  if (version === 2) {
    db.exec(V2_MEMORY_DDL);
    db.execute("INSERT INTO memory_collection (name, created_at) VALUES ('Default', 1)");
    db.execute("INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 1)");
  }
  db.execute(`PRAGMA user_version = ${version}`);
}

describe.each([0, 1, 2] as const)('a v%i desktop database', (version) => {
  beforeEach(() => seed(version));

  it('migrates to the current version and gains every registered table', () => {
    createUserSchema(db);
    expect(readUserSchemaVersion(db)).toBe(USER_SCHEMA_VERSION);
    const tables = db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    for (const spec of USER_TABLES) expect(tables, spec.name).toContain(spec.name);
    expect(tables.filter((t) => !isClassified(t))).toEqual([]);
  });

  it('keeps its rows', () => {
    createUserSchema(db);
    expect(db.queryAll('SELECT title FROM user_note ORDER BY note_id')).toEqual([{ title: 'Shepherd' }, { title: 'Light' }]);
    expect(db.queryAll('SELECT note_id FROM note_verse_link')).toEqual([{ note_id: 1 }]);
    expect(db.queryAll('SELECT name FROM collection')).toEqual([{ name: 'Favourites' }]);
    expect(db.queryAll('SELECT key FROM extension_storage')).toEqual([{ key: 'k' }]);
    if (version === 2) {
      expect(db.queryAll('SELECT reference FROM memory_passage')).toEqual([{ reference: 'John 3:16' }]);
    }
  });

  it('keeps full-text search intact, and its triggers working for new notes', () => {
    createUserSchema(db);
    const hit = (q: string) => db.queryAll<{ note_id: number }>('SELECT note_id FROM user_note_fts WHERE user_note_fts MATCH ?', [q]);
    expect(hit('shepherd')).toEqual([{ note_id: 1 }]);
    db.execute("INSERT INTO user_note (content) VALUES ('Another shepherd verse')");
    expect(hit('shepherd')).toHaveLength(2);
  });

  it('does not alter existing tables (an old user_note has no sort_order, which is optional)', () => {
    createUserSchema(db);
    const spec = USER_TABLES.find((t) => t.name === 'user_note')!;
    const cols = db.queryAll<{ name: string }>('PRAGMA table_info(user_note)').map((c) => c.name);
    expect(cols).not.toContain('sort_order');
    expect(cols).toEqual(spec.columns.filter((c) => c !== 'sort_order'));
  });

  it('a second run is a no-op', () => {
    createUserSchema(db);
    const snap = () => db.queryAll('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    const before = snap();
    createUserSchema(db);
    expect(snap()).toEqual(before);
  });

  it('migrateUserSchema alone reports from/to', () => {
    expect(migrateUserSchema(db)).toEqual({ from: version, to: USER_SCHEMA_VERSION });
  });
});

describe('a database stamped by a newer build', () => {
  it('stays at its version (here 9) and still gets any missing table', () => {
    seed(1);
    db.execute('PRAGMA user_version = 9');
    createUserSchema(db);
    expect(readUserSchemaVersion(db)).toBe(9);
  });
});
