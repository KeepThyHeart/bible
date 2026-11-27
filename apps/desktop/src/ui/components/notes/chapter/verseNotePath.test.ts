import { describe, it, expect } from 'vitest';
import { parseVerseNotePath } from './verseNotePath';

describe('parseVerseNotePath', () => {
  it('reads a relative path with either slash', () => {
    expect(parseVerseNotePath('Verse Notes/Romans/8/28.bn')).toEqual({ folderName: 'Romans', chapter: 8, verse: 28 });
    expect(parseVerseNotePath('Verse Notes\\1 John\\3\\2.bn')).toEqual({ folderName: '1 John', chapter: 3, verse: 2 });
  });
  it('reads absolute paths, with and without the notes dir', () => {
    expect(parseVerseNotePath('/home/u/Notes/Verse Notes/Psalms/23/1.bn', '/home/u/Notes')).toEqual({ folderName: 'Psalms', chapter: 23, verse: 1 });
    expect(parseVerseNotePath('C:\\Users\\u\\Notes\\Verse Notes\\Psalms\\23\\1.bn', 'c:\\users\\u\\notes\\')).toEqual({ folderName: 'Psalms', chapter: 23, verse: 1 });
    expect(parseVerseNotePath('C:\\Users\\u\\Notes\\Verse Notes\\Psalms\\23\\1.bn')).toEqual({ folderName: 'Psalms', chapter: 23, verse: 1 });
  });
  it('rejects anything else', () => {
    expect(parseVerseNotePath('Verse Notes/Romans/8/28 (unsaved changes).bn')).toBeNull();
    expect(parseVerseNotePath('Other/Romans/8/28.bn')).toBeNull();
    expect(parseVerseNotePath('Verse Notes/Romans/8.bn')).toBeNull();
  });
});
