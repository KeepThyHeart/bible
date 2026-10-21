/**
 * Soak regressions (task 0161): a save must never re-create a note that was
 * renamed, moved or trashed since it was opened, and renaming a note file must
 * keep its stored title in step.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn((_key: string) => os.tmpdir()) },
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(''),
    showItemInFolder: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { BibleNotesFileService, NoteMissingError, BnFile } from '../BibleNotesFileService';

function makeNote(title: string): BnFile {
  const now = new Date().toISOString();
  return { bn: 1, type: 'document', title, tags: [], passages: [], created: now, updated: now, content: '<p>x</p>', metadata: {} };
}

describe('BibleNotesFileService - stale saves and rename', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-stale-'));
    svc = new BibleNotesFileService(tmpDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(tmpDir, rel), 'utf-8')) as BnFile;

  it('does not re-create a renamed note when a save still names the old path with a baseline', () => {
    const updated = svc.saveNote('Old', makeNote('Old'));
    svc.rename('Old.bn', 'New.bn');
    expect(() => svc.saveNote('Old', makeNote('Old'), updated)).toThrow(NoteMissingError);
    expect(fs.existsSync(path.join(tmpDir, 'Old.bn'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'New.bn'))).toBe(true);
  });

  it('does not re-create a trashed note, in the absolute-path variant either', () => {
    const updated = svc.saveNote('Gone', makeNote('Gone'));
    fs.unlinkSync(path.join(tmpDir, 'Gone.bn'));
    expect(() => svc.saveNoteAbsolute(path.join(tmpDir, 'Gone.bn'), makeNote('Gone'), updated)).toThrow(NoteMissingError);
    expect(fs.existsSync(path.join(tmpDir, 'Gone.bn'))).toBe(false);
  });

  it('still creates a file on a first save without a baseline (new note / Save As)', () => {
    svc.saveNote('Fresh', makeNote('Fresh'));
    expect(fs.existsSync(path.join(tmpDir, 'Fresh.bn'))).toBe(true);
  });

  it('renaming a note file updates its stored title and keeps `updated`', () => {
    const updated = svc.saveNote('A', makeNote('A'));
    svc.rename('A.bn', 'B.bn');
    const note = read('B.bn');
    expect(note.title).toBe('B');
    expect(note.updated).toBe(updated);
  });

  it('moving a note to another folder (same file name) keeps its title', () => {
    svc.saveNote('John 3-16', makeNote('John 3:16'));
    svc.rename('John 3-16.bn', 'Sub/John 3-16.bn');
    expect(read('Sub/John 3-16.bn').title).toBe('John 3:16');
  });

  it('renaming a folder leaves the titles of the notes inside alone', () => {
    svc.saveNote('F/n', makeNote('Title'));
    svc.rename('F', 'G');
    expect(read('G/n.bn').title).toBe('Title');
  });

  it('lists notes and folders in natural order (soak DS-05)', () => {
    for (const n of ['6-19', '6-9', '6-34']) svc.saveNote(`Matthew/${n}`, makeNote(n));
    for (const f of ['13', '6', '1', '24']) svc.createFolder(`Chapters/${f}`);
    expect(svc.listDirectory('Matthew').map(e => e.name)).toEqual(['6-9', '6-19', '6-34']);
    expect(svc.listDirectory('Chapters').map(e => e.name)).toEqual(['1', '6', '13', '24']);
  });
});
