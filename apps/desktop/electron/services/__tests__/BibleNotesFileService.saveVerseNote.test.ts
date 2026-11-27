/**
 * Task 0216 item 12: a verse note's file is created by its first save with
 * content (`saveVerseNote`), not by opening it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn((_key: string) => os.tmpdir()) },
  shell: { trashItem: vi.fn().mockResolvedValue(undefined), openPath: vi.fn().mockResolvedValue(''), showItemInFolder: vi.fn() },
}));
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { BibleNotesFileService, NoteConflictError, NoteMissingError } from '../BibleNotesFileService';

const JOHN_3_16 = 43003016;

describe('BibleNotesFileService.saveVerseNote', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-svn-'));
    svc = new BibleNotesFileService(tmpDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('writes nothing until it is called, then creates the file with verse_note envelope', () => {
    expect(svc.hasVerseNote('John', 3, 16)).toBe(false);
    expect(svc.readVerseNote('John', 3, 16)).toBeNull(); // reading never creates
    expect(svc.hasVerseNote('John', 3, 16)).toBe(false);

    const { note, relativePath } = svc.saveVerseNote('John', JOHN_3_16, '<p>For God so loved</p>');
    expect(relativePath.replace(/\\/g, '/')).toBe('Verse Notes/John/3/16.bn');
    expect(note.type).toBe('verse_note');
    expect(note.title).toBe('John 3:16');
    expect(note.passages).toEqual([{ start: JOHN_3_16, end: JOHN_3_16, association: 'primary' }]);
    const onDisk = svc.readVerseNote('John', 3, 16)!.note;
    expect(onDisk.content).toBe('<p>For God so loved</p>');
    expect(onDisk.updated).toBe(note.updated);
    expect(svc.listVerseNotesInChapter('John', 3).map(e => e.name)).toEqual(['16']);
  });

  it('updates the existing file afterwards, keeping its envelope', async () => {
    const first = svc.saveVerseNote('John', JOHN_3_16, '<p>one</p>');
    await new Promise(r => setTimeout(r, 5));
    const second = svc.saveVerseNote('John', JOHN_3_16, '<p>two</p>', first.note.updated);
    expect(second.note.created).toBe(first.note.created);
    expect(second.note.updated).not.toBe(first.note.updated);
    expect(svc.readVerseNote('John', 3, 16)!.note.content).toBe('<p>two</p>');
  });

  it('clearing an existing note saves it: the file stays, the marker goes', () => {
    const first = svc.saveVerseNote('John', JOHN_3_16, '<p>one</p>');
    svc.saveVerseNote('John', JOHN_3_16, '<p></p>', first.note.updated);
    expect(svc.hasVerseNote('John', 3, 16)).toBe(true);
    expect(svc.listVerseNotesInChapter('John', 3)).toEqual([]);
  });

  it('refuses a stale expectedUpdated with a conflict and leaves the file alone', () => {
    svc.saveVerseNote('John', JOHN_3_16, '<p>one</p>');
    expect(() => svc.saveVerseNote('John', JOHN_3_16, '<p>mine</p>', '2000-01-01T00:00:00.000Z')).toThrow(NoteConflictError);
    expect(svc.readVerseNote('John', 3, 16)!.note.content).toBe('<p>one</p>');
  });

  it('with a baseline but no file (deleted meanwhile) it does not re-create it', () => {
    expect(() => svc.saveVerseNote('John', JOHN_3_16, '<p>x</p>', '2026-01-01T00:00:00.000Z')).toThrow(NoteMissingError);
    expect(svc.hasVerseNote('John', 3, 16)).toBe(false);
  });

  it('draft save (no baseline) when the file appeared meanwhile -> conflict, disk unchanged', () => {
    svc.saveVerseNote('John', JOHN_3_16, '<p>other window</p>');
    const file = path.join(tmpDir, 'Verse Notes', 'John', '3', '16.bn');
    const before = fs.readFileSync(file, 'utf-8');
    expect(() => svc.saveVerseNote('John', JOHN_3_16, '<p>draft</p>')).toThrow(NoteConflictError);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });

  it('refuses to replace an existing file that cannot be parsed', () => {
    const dir = path.join(tmpDir, 'Verse Notes', 'John', '3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '16.bn'), '{ not json');
    expect(() => svc.saveVerseNote('John', JOHN_3_16, '<p>x</p>')).toThrow(NoteConflictError);
    expect(() => svc.saveVerseNote('John', JOHN_3_16, '<p>x</p>', 'whatever')).toThrow(NoteConflictError);
    expect(fs.readFileSync(path.join(dir, '16.bn'), 'utf-8')).toBe('{ not json');
  });
});
