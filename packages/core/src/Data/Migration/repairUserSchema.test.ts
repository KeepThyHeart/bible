/**
 * The test the existing suite could not have: a user database created by an
 * OLDER build.
 *
 * Highlighting and underlining were dead for a long time and every test passed,
 * because every test - unit and e2e alike - starts from a *fresh* database.
 * The desktop e2e fixture deletes the whole userData directory per worker, and
 * the renderer tests mock the repository, so nothing in the suite ever opened a
 * table created by a previous release. The bug lived entirely in that gap.
 *
 * So these tests build the pre-upgrade table by hand and assert the app can
 * write to it afterwards.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import type { ISql, SqlParameter, SqlResult } from '../Core/ISql';
import { repairUserSchema } from './repairUserSchema';

/** The `user_text_markup` shape shipped before the hex-colour change. */
const LEGACY_MARKUP_DDL = `
  CREATE TABLE user_text_markup (
    markup_id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    verse_id_start INTEGER NOT NULL,
    verse_id_end INTEGER,
    text_start INTEGER,
    text_end INTEGER,
    color TEXT NOT NULL,
    note_id INTEGER,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE SET NULL,
    CHECK (color IN ('yellow', 'green', 'blue', 'red', 'purple', 'orange'))
  )
`;

/** The shape a fresh install creates today. */
const CURRENT_MARKUP_DDL = `
  CREATE TABLE user_text_markup (
    markup_id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    verse_id_start INTEGER NOT NULL,
    verse_id_end INTEGER NOT NULL,
    text_start INTEGER,
    text_end INTEGER,
    color TEXT NOT NULL,
    note_id INTEGER,
    created_date TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT,
    FOREIGN KEY (note_id) REFERENCES user_note(note_id) ON DELETE SET NULL
  )
`;

const USER_NOTE_DDL = `
  CREATE TABLE user_note (
    note_id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL
  )
`;

class MemoryDb implements ISql {
  readonly db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
  }

  queryOne<T>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T | undefined {
    return this.db.prepare(sql).get(...toArgs(params)) as T | undefined;
  }

  queryAll<T>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T[] {
    return this.db.prepare(sql).all(...toArgs(params)) as T[];
  }

  execute(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): SqlResult {
    // `PRAGMA` and DDL are not preparable as statements returning info in every
    // case, so route anything without parameters through exec-like handling.
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...toArgs(params));
    return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
  }

  transaction<T>(callback: () => T): T {
    return this.db.transaction(callback)();
  }

  close(): void {
    this.db.close();
  }

  isOpen(): boolean {
    return this.db.open;
  }

  getDatabasePath(): string {
    return ':memory:';
  }
}

function toArgs(params?: SqlParameter[] | Record<string, SqlParameter>): SqlParameter[] {
  if (!params) return [];
  return Array.isArray(params) ? params : [params as unknown as SqlParameter];
}

function storedDdl(db: MemoryDb): string {
  const row = db.queryOne<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_text_markup'"
  );
  return row?.sql ?? '';
}

/** What the app writes today: canonical hex, never a palette name. */
function insertHexHighlight(db: MemoryDb, color = '#FFF3A3'): void {
  db.execute(
    `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, text_start, text_end, color)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [1, 43003016, 43003016, 0, 3, color]
  );
}

describe('repairUserSchema - upgraded user databases', () => {
  let db: MemoryDb;

  beforeEach(() => {
    db = new MemoryDb();
    db.db.exec(USER_NOTE_DDL);
  });

  afterEach(() => {
    db.close();
  });

  describe('a database created by an older build', () => {
    beforeEach(() => {
      db.db.exec(LEGACY_MARKUP_DDL);
    });

    it('rejects the hex colour the app writes, before repair', () => {
      // This is the bug, reproduced: every highlight and underline the user
      // applied failed here, and the failure was swallowed on the way back.
      expect(() => insertHexHighlight(db)).toThrow(/CHECK constraint failed/i);
    });

    it('accepts it after repair', () => {
      repairUserSchema(db);
      expect(() => insertHexHighlight(db)).not.toThrow();
      const row = db.queryOne<{ color: string }>('SELECT color FROM user_text_markup');
      expect(row?.color).toBe('#FFF3A3');
    });

    it('reports what it found', () => {
      const report = repairUserSchema(db);
      expect(report.hadLegacyColorCheck).toBe(true);
      expect(report.hadNullableVerseEnd).toBe(true);
      expect(report.rebuilt).toBe(true);
    });

    it('converts existing named colours to hex and keeps the name recoverable', () => {
      db.execute(
        `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color, metadata)
         VALUES (?, ?, ?, ?, ?)`,
        [1, 43003016, 43003016, 'yellow', '{"markupType":"highlight"}']
      );

      const report = repairUserSchema(db);
      expect(report.colorsConverted).toBe(1);

      const row = db.queryOne<{ color: string; metadata: string }>(
        'SELECT color, metadata FROM user_text_markup'
      );
      expect(row?.color).toBe('#FFF3A3');
      // Reversible: the original name survives, so the mapping can be undone
      // without guessing.
      expect(JSON.parse(row!.metadata)).toMatchObject({
        markupType: 'highlight',
        colorName: 'yellow',
      });
    });

    it('leaves colours it does not recognise exactly as they were', () => {
      // A CHECK-violating value cannot exist in the legacy table, so seed a
      // recognised one alongside and assert only the known name moves.
      db.execute(
        `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color)
         VALUES (?, ?, ?, ?)`,
        [1, 43003016, 43003016, 'purple']
      );
      repairUserSchema(db);
      db.execute(
        `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color)
         VALUES (?, ?, ?, ?)`,
        [1, 43003017, 43003017, '#123456']
      );

      const report = repairUserSchema(db);
      // Second pass has nothing left to convert.
      expect(report.rebuilt).toBe(false);
      const colors = db
        .queryAll<{ color: string }>('SELECT color FROM user_text_markup ORDER BY markup_id')
        .map(r => r.color);
      expect(colors).toEqual(['#D9C2F0', '#123456']);
    });

    it('backfills a NULL verse_id_end from verse_id_start', () => {
      // A NULL end made a single-verse markup match every range query starting
      // after it - mis-selecting on read and over-deleting on write.
      db.execute(
        `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color)
         VALUES (?, ?, NULL, ?)`,
        [1, 43003016, 'blue']
      );

      const report = repairUserSchema(db);
      expect(report.verseEndsBackfilled).toBe(1);

      const row = db.queryOne<{ verse_id_end: number }>(
        'SELECT verse_id_end FROM user_text_markup'
      );
      expect(row?.verse_id_end).toBe(43003016);
      expect(storedDdl(db)).toMatch(/verse_id_end\s+INTEGER\s+NOT\s+NULL/i);
    });

    it('preserves every row and its ids through the rebuild', () => {
      for (const [start, color] of [[43003016, 'yellow'], [43003017, 'green'], [43003018, 'red']] as const) {
        db.execute(
          `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, text_start, text_end, color)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [7, start, start, 1, 2, color]
        );
      }
      const before = db.queryAll<{ markup_id: number; verse_id_start: number }>(
        'SELECT markup_id, verse_id_start FROM user_text_markup ORDER BY markup_id'
      );

      repairUserSchema(db);

      const after = db.queryAll<{ markup_id: number; verse_id_start: number }>(
        'SELECT markup_id, verse_id_start FROM user_text_markup ORDER BY markup_id'
      );
      expect(after).toEqual(before);
    });

    it('is idempotent - a second run changes nothing', () => {
      repairUserSchema(db);
      const ddlAfterFirst = storedDdl(db);

      const second = repairUserSchema(db);
      expect(second.rebuilt).toBe(false);
      expect(storedDdl(db)).toBe(ddlAfterFirst);
    });

    it('restores the indexes the rebuild drops', () => {
      repairUserSchema(db);
      const indexes = db
        .queryAll<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_text_markup'"
        )
        .map(r => r.name);
      expect(indexes).toEqual(
        expect.arrayContaining([
          'idx_markup_verse_start',
          'idx_markup_verse_end',
          'idx_markup_module',
          'idx_markup_color',
        ])
      );
    });

    it('leaves foreign keys enabled afterwards', () => {
      repairUserSchema(db);
      const row = db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys');
      expect(row?.foreign_keys).toBe(1);
    });
  });

  describe('a database created by the current build', () => {
    it('is left completely alone', () => {
      db.db.exec(CURRENT_MARKUP_DDL);
      const before = storedDdl(db);

      const report = repairUserSchema(db);

      expect(report.rebuilt).toBe(false);
      expect(report.hadLegacyColorCheck).toBe(false);
      expect(storedDdl(db)).toBe(before);
    });
  });

  describe('a database with no markup table at all', () => {
    it('does nothing rather than throwing', () => {
      expect(() => repairUserSchema(db)).not.toThrow();
      expect(repairUserSchema(db).rebuilt).toBe(false);
    });
  });
});
