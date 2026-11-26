import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ listVerseNoteChapters: vi.fn(), readVerseNotes: vi.fn() }));
vi.mock('../../../services/fileNotesAPI', () => api);

import { chapterFromPath, compileRequestForFolder, isCompilableVerseFolder } from './chapterPaneHelpers';
import { parsePassageList } from '../../../services/compile/parsePassageList';

const dir = (name: string) => ({ name, path: `Verse Notes/Psalms/${name}`, isDirectory: true, modified: '' });

describe('chapterPaneHelpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the chapter from verse-note and folder paths', () => {
    expect(chapterFromPath('Verse Notes/John/3/16.bn')).toEqual({ book: 43, chapter: 3, verse: 16 });
    expect(chapterFromPath('Verse Notes\\John\\3')).toEqual({ book: 43, chapter: 3 });
    expect(chapterFromPath('Verse Notes/John')).toEqual({ book: 43, chapter: 1 });
    expect(chapterFromPath('Verse Notes')).toBeNull();
    expect(chapterFromPath('Documents/Romans 8')).toBeNull();
  });

  it('is compilable only on a book or chapter folder under Verse Notes', () => {
    expect(isCompilableVerseFolder('Verse Notes/Psalms')).toBe(true);
    expect(isCompilableVerseFolder('Verse Notes/Psalms/119')).toBe(true);
    expect(isCompilableVerseFolder('Verse Notes')).toBe(false);
    expect(isCompilableVerseFolder('Verse Notes/Psalms/119/1.bn')).toBe(false);
    expect(isCompilableVerseFolder('Documents/Psalms')).toBe(false);
  });

  it('a chapter folder is "<Book> <ch>" and the compile parser accepts module-DB book names', async () => {
    const req = await compileRequestForFolder('Verse Notes/Psalms/119');
    expect(req).toEqual({ reference: 'Psalms 119' });
    const { passages, unrecognized } = parsePassageList('Psalms 119; 1 Corinthians 15; Song of Solomon 2');
    expect(unrecognized).toEqual([]);
    expect(passages.map(p => p.book)).toEqual([19, 46, 22]);
  });

  it('a book folder lists its chapters that have notes, numerically, with blanks skipped', async () => {
    api.listVerseNoteChapters.mockResolvedValue([dir('10'), dir('2'), dir('5'), dir('1'), { ...dir('x.bn'), isDirectory: false }]);
    api.readVerseNotes.mockResolvedValue([
      { bookName: 'Psalms', chapter: 5 }, { bookName: 'Psalms', chapter: 5 }, { bookName: 'Psalms', chapter: 1 }, { bookName: 'Psalms', chapter: 10 },
    ]);
    const req = await compileRequestForFolder('Verse Notes/Psalms');
    expect(req).toEqual({ reference: 'Psalms 1; Psalms 5; Psalms 10', initialOptions: { versesWithoutNotes: 'skip' } });
    expect(api.readVerseNotes).toHaveBeenCalledWith([1, 2, 5, 10].map(chapter => ({ bookName: 'Psalms', chapter })));
    expect(parsePassageList(req!.reference).passages).toHaveLength(3);
  });

  it('refuses paths outside Verse Notes book/chapter folders', async () => {
    expect(await compileRequestForFolder('Verse Notes')).toBeNull();
    expect(await compileRequestForFolder('Documents/X')).toBeNull();
  });
});
