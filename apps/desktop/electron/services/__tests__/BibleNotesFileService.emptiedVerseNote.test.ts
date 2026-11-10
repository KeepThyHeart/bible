/**
 * A verse note whose text is cleared is removed instead of saved empty, so the
 * verse loses its note marker; typing again re-creates it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn((_key: string) => os.tmpdir()) },
  shell: {
    // Stands in for the OS trash: the file leaves the notes folder.
    trashItem: vi.fn(async (p: string) => { fs.rmSync(p, { force: true }); }),
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { BibleNotesFileService, NoteConflictError } from '../BibleNotesFileService';
import { isEmptyNoteContent } from '../noteContent';

describe('isEmptyNoteContent', () => {
  it('treats the empty editor document and blank paragraphs as empty', () => {
    expect(isEmptyNoteContent({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isEmptyNoteContent({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '  ' }, { type: 'hardBreak' }] },
      { type: 'heading', attrs: { level: 2 } },
    ] })).toBe(true);
    expect(isEmptyNoteContent('<p></p><p>&nbsp;<br></p>')).toBe(true);
    expect(isEmptyNoteContent(null)).toBe(true);
  });

  it('treats any text or non-text node as content', () => {
    expect(isEmptyNoteContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] })).toBe(false);
    expect(isEmptyNoteContent({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe(false);
    expect(isEmptyNoteContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] })).toBe(false);
    expect(isEmptyNoteContent({ type: 'doc', content: [{ type: 'bulletList', content: [] }] })).toBe(false);
    expect(isEmptyNoteContent('<p>x</p>')).toBe(false);
  });
});

describe('BibleNotesFileService - emptied verse notes', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;
  const rel = path.join('Verse Notes', 'John', '3', '16.bn');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-emptied-'));
    svc = new BibleNotesFileService(tmpDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('recognises verse note paths only', () => {
    expect(svc.isVerseNotePath('Verse Notes/John/3/16.bn')).toBe(true);
    expect(svc.isVerseNotePath('Verse Notes\\John\\3\\16.bn')).toBe(true);
    expect(svc.isVerseNotePath('Verse Notes/John/3')).toBe(false);
    expect(svc.isVerseNotePath('Sermons/John/3/16.bn')).toBe(false);
    expect(svc.isVerseNotePath('Verse Notes/John/3/draft.bn')).toBe(false);
  });

  it('removes the note and its now-empty chapter and book folders, keeping the Verse Notes folder', async () => {
    const { note } = svc.createVerseNote('John', 3, 16, 43003016);
    await svc.removeEmptiedVerseNote(rel, note.updated);
    expect(fs.existsSync(path.join(tmpDir, rel))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'Verse Notes', 'John'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'Verse Notes'))).toBe(true);
    expect(svc.hasVerseNote('John', 3, 16)).toBe(false);
  });

  it('keeps folders that still hold other verse notes', async () => {
    const { note } = svc.createVerseNote('John', 3, 16, 43003016);
    svc.createVerseNote('John', 3, 17, 43003017);
    await svc.removeEmptiedVerseNote(rel, note.updated);
    expect(svc.hasVerseNote('John', 3, 17)).toBe(true);
  });

  it('does not remove a note another window saved since', async () => {
    const { note } = svc.createVerseNote('John', 3, 16, 43003016);
    const stale = note.updated;
    await new Promise(r => setTimeout(r, 5));
    svc.saveNote(rel, { ...note, content: 'other window' }, stale);
    await expect(svc.removeEmptiedVerseNote(rel, stale)).rejects.toBeInstanceOf(NoteConflictError);
    expect(fs.existsSync(path.join(tmpDir, rel))).toBe(true);
  });

  it('re-creates the note when content is saved again with the empty baseline', async () => {
    const { note } = svc.createVerseNote('John', 3, 16, 43003016);
    await svc.removeEmptiedVerseNote(rel, note.updated);
    svc.saveNote(rel, { ...note, content: '<p>again</p>' }, '');
    expect(svc.hasVerseNote('John', 3, 16)).toBe(true);
  });

  it('refuses the empty baseline when another window created the note meanwhile', async () => {
    const { note } = svc.createVerseNote('John', 3, 16, 43003016);
    await svc.removeEmptiedVerseNote(rel, note.updated);
    svc.createVerseNote('John', 3, 16, 43003016);
    expect(() => svc.saveNote(rel, { ...note, content: '<p>mine</p>' }, '')).toThrow(NoteConflictError);
  });
});
