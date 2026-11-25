/**
 * Task 0216 items 9 and 11: a verse note cleared to empty keeps its file but no
 * longer counts for the Bible pane's marker, and Verse Notes book / chapter
 * folders holding no note with content are hidden from the folder browser.
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

import { BibleNotesFileService, BnFile } from '../BibleNotesFileService';

describe('BibleNotesFileService - verse notes with content only', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-vn-'));
    svc = new BibleNotesFileService(tmpDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const write = (book: string, ch: number, v: number, content: unknown) => {
    const { note, relativePath } = svc.createVerseNote(book, ch, v, 1);
    note.content = content;
    svc.saveNote(relativePath, note as BnFile);
  };

  it('lists a verse note in the chapter only once it has content; clearing removes it, file kept', () => {
    svc.createVerseNote('John', 3, 16, 43003016); // fresh, empty JSON doc
    expect(svc.listVerseNotesInChapter('John', 3)).toEqual([]);

    write('John', 3, 16, '<p>For God so loved</p>');
    expect(svc.listVerseNotesInChapter('John', 3).map(e => e.name)).toEqual(['16']);

    write('John', 3, 16, '<p></p><p><br></p>');
    expect(svc.listVerseNotesInChapter('John', 3)).toEqual([]);
    expect(svc.hasVerseNote('John', 3, 16)).toBe(true); // the file is kept
  });

  it('hides book and chapter folders under Verse Notes that hold no note with content', () => {
    write('John', 3, 16, '<p>kept</p>');
    write('John', 4, 1, '<p></p>');           // empty chapter
    write('Mark', 1, 1, '<p>&nbsp;</p>');     // book with only empty notes
    write('Luke', 2, 1, '<p><img src="a.png"></p>'); // image counts

    const books = svc.listDirectory('Verse Notes').map(e => e.name);
    expect(books).toEqual(['John', 'Luke']);
    expect(svc.listDirectory(path.join('Verse Notes', 'John')).map(e => e.name)).toEqual(['3']);
    expect(svc.listVerseNoteBooks().map(e => e.name)).toEqual(['John', 'Luke']);
  });

  it('does not hide empty folders outside Verse Notes', () => {
    fs.mkdirSync(path.join(tmpDir, 'Sermons'));
    expect(svc.listDirectory('').map(e => e.name)).toContain('Sermons');
  });

  it('shows a folder again when a note in it gets content', () => {
    write('Mark', 1, 1, '<p></p>');
    expect(svc.listDirectory('Verse Notes')).toEqual([]);
    write('Mark', 1, 1, '<p>now written</p>');
    expect(svc.listDirectory('Verse Notes').map(e => e.name)).toEqual(['Mark']);
  });
});
