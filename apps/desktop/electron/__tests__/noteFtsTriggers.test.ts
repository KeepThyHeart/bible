// @vitest-environment node
/**
 * user_note_fts is an external-content FTS5 table. Editing or deleting a note
 * must remove its OLD terms from the index; the original triggers did not, so
 * search matched words that were edited out and notes that were deleted.
 */
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { ISql } from '@bible/core';
import { makeSql } from '../services/__tests__/helpers/testSql';
import { loadBeta1UserDb } from '../services/__tests__/helpers/beta1Fixture';
import { initializeUserSchema } from '../schema/userSchema';
import { SqliteProvider } from '../providers/SqliteProvider';

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const nativeSqliteAvailable = ((): boolean => {
  try {
    new SqliteProvider(':memory:', { readonly: false }).close();
    return true;
  } catch {
    return false;
  }
})();

const hits = (sql: ISql, term: string): number[] =>
  sql
    .queryAll<{ rowid: number }>('SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH ?', [term])
    .map(r => r.rowid)
    .sort();

const addNote = (sql: ISql, content: string): number =>
  sql.execute(`INSERT INTO user_note (title, content, tags) VALUES ('t', ?, '[]')`, [content]).lastInsertRowId as number;

describe.skipIf(!nativeSqliteAvailable)('user_note_fts stays in step with user_note', () => {
  it('forgets words that were edited out and notes that were deleted', () => {
    const sql = makeSql(new Database(':memory:'));
    initializeUserSchema(sql);
    const a = addNote(sql, 'the zebra crossed');
    const b = addNote(sql, 'a walrus swam');
    expect(hits(sql, 'zebra')).toEqual([a]);

    sql.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['the giraffe crossed', a]);
    expect(hits(sql, 'zebra')).toEqual([]);
    expect(hits(sql, 'giraffe')).toEqual([a]);

    sql.execute('DELETE FROM user_note WHERE note_id = ?', [b]);
    expect(hits(sql, 'walrus')).toEqual([]);
    expect(hits(sql, 'giraffe')).toEqual([a]);
  });

  it('repairs an existing database that has the old triggers and a stale index, once', () => {
    const sql = makeSql(new Database(':memory:'));
    loadBeta1UserDb(sql);
    const a = addNote(sql, 'the zebra crossed');
    const b = addNote(sql, 'a walrus swam');
    // With the old triggers these leave the old terms in the index.
    sql.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['the giraffe crossed', a]);
    sql.execute('DELETE FROM user_note WHERE note_id = ?', [b]);

    initializeUserSchema(sql);
    expect(hits(sql, 'zebra')).toEqual([]);
    expect(hits(sql, 'walrus')).toEqual([]);
    expect(hits(sql, 'giraffe')).toEqual([a]);

    // Second launch: triggers already new, nothing to repair, still correct.
    initializeUserSchema(sql);
    expect(hits(sql, 'giraffe')).toEqual([a]);
    sql.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['the okapi crossed', a]);
    expect(hits(sql, 'giraffe')).toEqual([]);
    expect(hits(sql, 'okapi')).toEqual([a]);
  });
});
