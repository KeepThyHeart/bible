/** Task 0216 B0: bulk `readVerseNotes` on a temp notes dir. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn((_key: string) => os.tmpdir()) },
  shell: { trashItem: vi.fn().mockResolvedValue(undefined), openPath: vi.fn().mockResolvedValue(''), showItemInFolder: vi.fn() },
}));
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { BibleNotesFileService } from '../BibleNotesFileService';
import { MAX_VERSE_NOTE_QUERIES } from '../../ipc/verseNoteBulk';

describe('BibleNotesFileService.readVerseNotes', () => {
  let tmpDir: string;
  let svc: BibleNotesFileService;
  const put = (book: string, ch: number, verse: number, html: string) =>
    svc.saveVerseNote(book, 1000000 * 40 + ch * 1000 + verse, html);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-rvn-'));
    svc = new BibleNotesFileService(tmpDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('returns only notes with content, ordered by verse', () => {
    put('Romans', 8, 10, '<p>ten</p>');
    put('Romans', 8, 2, '<p>two</p>');
    put('Romans', 8, 5, '<p></p>'); // empty: file exists, no content
    const res = svc.readVerseNotes([{ bookName: 'Romans', chapter: 8 }]);
    expect(res.map((r) => r.verse)).toEqual([2, 10]);
    expect(res[0]).toMatchObject({ bookName: 'Romans', chapter: 8, relativePath: 'Verse Notes/Romans/8/2.bn' });
    expect(res[0].note.content).toContain('two');
  });

  it('filters by the verse range, inclusive', () => {
    for (const v of [1, 3, 5, 7]) put('Romans', 8, v, `<p>v${v}</p>`);
    const res = svc.readVerseNotes([{ bookName: 'Romans', chapter: 8, fromVerse: 3, toVerse: 5 }]);
    expect(res.map((r) => r.verse)).toEqual([3, 5]);
    expect(svc.readVerseNotes([{ bookName: 'Romans', chapter: 8, fromVerse: 5 }]).map((r) => r.verse)).toEqual([5, 7]);
  });

  it('ignores "3 (unsaved changes).bn" and other non-numeric names', () => {
    put('Romans', 8, 3, '<p>real</p>');
    const dir = path.join(tmpDir, 'Verse Notes', 'Romans', '8');
    fs.copyFileSync(path.join(dir, '3.bn'), path.join(dir, '3 (unsaved changes).bn'));
    fs.copyFileSync(path.join(dir, '3.bn'), path.join(dir, 'x.bn'));
    expect(svc.readVerseNotes([{ bookName: 'Romans', chapter: 8 }]).map((r) => r.verse)).toEqual([3]);
  });

  it('a missing chapter folder yields nothing', () => {
    expect(svc.readVerseNotes([{ bookName: 'Jude', chapter: 1 }])).toEqual([]);
  });

  it('keeps query order across queries', () => {
    put('Romans', 8, 1, '<p>r</p>');
    put('Acts', 2, 4, '<p>a</p>');
    const res = svc.readVerseNotes([{ bookName: 'Romans', chapter: 8 }, { bookName: 'Acts', chapter: 2 }]);
    expect(res.map((r) => `${r.bookName} ${r.chapter}:${r.verse}`)).toEqual(['Romans 8:1', 'Acts 2:4']);
  });

  it('rejects bad queries with invalid_input', () => {
    const bad = [
      [{ bookName: '../x', chapter: 1 }],
      [{ bookName: 'a/b', chapter: 1 }],
      [{ bookName: 'a\\b', chapter: 1 }],
      [{ bookName: '', chapter: 1 }],
      [{ bookName: 'Romans', chapter: 0 }],
      [{ bookName: 'Romans', chapter: 201 }],
      [{ bookName: 'Romans', chapter: 1.5 }],
      [{ bookName: 'Romans', chapter: 1, fromVerse: 0 }],
      [{ bookName: 'Romans', chapter: 1, toVerse: 1000 }],
      Array.from({ length: MAX_VERSE_NOTE_QUERIES + 1 }, () => ({ bookName: 'Romans', chapter: 1 })),
    ];
    for (const q of bad) {
      expect(() => svc.readVerseNotes(q as never)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    }
    expect(() => svc.readVerseNotes(Array.from({ length: MAX_VERSE_NOTE_QUERIES }, () => ({ bookName: 'Romans', chapter: 1 })))).not.toThrow();
  });
});
