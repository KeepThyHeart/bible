/**
 * `searchVersesWithHighlighting` against FTS tables of differing shape.
 *
 * `bible_verse_fts` is declared `(verse_id UNINDEXED, text)`, so `text` is
 * column 1. A malformed module can still disagree with that, and `highlight()`
 * does not raise on a column that is not there - it returns an empty string.
 *
 * That made for a silent, total failure: `verse_id` still resolved, so a search
 * result rendered its reference and no verse text at all. It only ever showed
 * up in non-KJV translations, because KJV's two schemas happen to agree.
 *
 * Built in-memory; no shipped module is opened.
 */

import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';

import { ISql, SqlParameter, SqlResult } from '../Data/Core/ISql';
import { BibleRepository } from '../Data/Repositories/BibleRepository';

class MemoryDb implements ISql {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  queryOne<T>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T | undefined {
    return this.db.prepare(sql).get(...toArgs(params)) as T | undefined;
  }

  queryAll<T>(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): T[] {
    return this.db.prepare(sql).all(...toArgs(params)) as T[];
  }

  execute(sql: string, params?: SqlParameter[] | Record<string, SqlParameter>): SqlResult {
    const info = this.db.prepare(sql).run(...toArgs(params));
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
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [];
}

const JOHN_3_16 = 43003016;
const TEXT = 'For God so loved the world';

const MODULE_INFO = `
  CREATE TABLE module_info (
    info_id INTEGER PRIMARY KEY,
    abbreviation TEXT,
    full_name TEXT,
    language_code TEXT,
    copyright TEXT,
    version TEXT
  );
`;

/** Everything except the FTS declaration, which is what each case varies. */
function buildModule(contentColumns: string, ftsColumns: string, insert: (db: MemoryDb) => void): MemoryDb {
  const db = new MemoryDb();
  db.exec(`
    ${MODULE_INFO}
    CREATE TABLE bible_verse (${contentColumns});
    CREATE VIRTUAL TABLE bible_verse_fts USING fts5(
      ${ftsColumns},
      content='bible_verse', content_rowid='verse_id', tokenize='porter unicode61'
    );
  `);
  db.execute(
    `INSERT INTO module_info (info_id, abbreviation, full_name, language_code, copyright, version)
     VALUES (1, 'TEST', 'Test Translation', 'en', '', '1.0')`,
  );
  insert(db);
  db.execute(`INSERT INTO bible_verse_fts(bible_verse_fts) VALUES('rebuild')`);
  return db;
}

describe('searchVersesWithHighlighting across FTS shapes', () => {
  const open: MemoryDb[] = [];
  const make = (db: MemoryDb): BibleRepository => {
    open.push(db);
    return new BibleRepository(db);
  };

  afterAll(() => open.forEach(db => db.close()));

  it('highlights the match in the canonical shape', () => {
    const repo = make(
      buildModule(
        'verse_id INTEGER PRIMARY KEY, text TEXT NOT NULL, word_count INTEGER, metadata TEXT',
        'verse_id UNINDEXED, text',
        db => db.execute('INSERT INTO bible_verse (verse_id, text, word_count) VALUES (?, ?, ?)', [JOHN_3_16, TEXT, 6]),
      ),
    );

    const [row] = repo.searchVersesWithHighlighting('loved');

    expect(row).toBeDefined();
    expect(row!.highlightedText).toContain('<strong><u>loved</u></strong>');
    expect(row!.highlightedPlainText).toContain('<strong><u>loved</u></strong>');
  });

  it('does not return blank text when the content and FTS schemas disagree', () => {
    const repo = make(
      buildModule(
        'verse_id INTEGER PRIMARY KEY, text TEXT NOT NULL, text_plain TEXT, word_count INTEGER, metadata TEXT',
        'verse_id UNINDEXED, text',
        db =>
          db.execute(
            'INSERT INTO bible_verse (verse_id, text, text_plain, word_count) VALUES (?, ?, ?, ?)',
            [JOHN_3_16, TEXT, TEXT, 6],
          ),
      ),
    );

    const [row] = repo.searchVersesWithHighlighting('loved');

    expect(row).toBeDefined();
    expect(row!.highlightedPlainText).not.toBe('');
    expect(row!.highlightedPlainText).toContain('loved');
    expect(row!.highlightedText).toContain('loved');
  });

  /**
   * A module built without the leading `verse_id UNINDEXED` column puts `text`
   * at index 0, so even column 1 - the value every shipped module uses - is
   * wrong. There is nothing to highlight against, but the verse's own text is
   * in the same row and is served instead of nothing.
   */
  it('falls back to the verse text when no column can be highlighted', () => {
    const repo = make(
      buildModule(
        'verse_id INTEGER PRIMARY KEY, text TEXT NOT NULL, word_count INTEGER, metadata TEXT',
        'text',
        db => db.execute('INSERT INTO bible_verse (verse_id, text, word_count) VALUES (?, ?, ?)', [JOHN_3_16, TEXT, 6]),
      ),
    );

    const [row] = repo.searchVersesWithHighlighting('loved');

    expect(row).toBeDefined();
    expect(row!.highlightedText).toContain('loved');
    expect(row!.highlightedPlainText).toContain('loved');
  });
});
