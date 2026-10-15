// @vitest-environment node
/**
 * Database-backed notes (prayers, journal entries) on the desktop's own user schema. That schema has no
 * `verse_link` (core-only in the backup registry), and core's UserNoteRepository used to read and write
 * it unconditionally, so creating a prayer on the desktop failed with "no such table: verse_link".
 */
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { NotesController, UserNoteRepository } from '@bible/core';
import { makeSql } from '../services/__tests__/helpers/testSql';
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

describe.skipIf(!nativeSqliteAvailable)('notes on the desktop user schema (no verse_link)', () => {
  it('creates, reads back, updates and deletes a prayer', () => {
    const sql = makeSql(new Database(':memory:'));
    initializeUserSchema(sql);
    expect(sql.queryOne("SELECT 1 FROM sqlite_master WHERE name = 'verse_link'")).toBeFalsy();

    const controller = new NotesController(new UserNoteRepository(sql));
    const created = controller.createNote({ title: 'For the church', content: '', noteType: 'prayer' });
    expect(created.noteId).toBeGreaterThan(0);

    const read = controller.getNoteById(created.noteId!);
    expect(read?.title).toBe('For the church');

    read!.title = 'For the whole church';
    expect(controller.updateNote(read!).title).toBe('For the whole church');

    expect(controller.deleteNote(created.noteId!)).toBe(true);
  });
});
