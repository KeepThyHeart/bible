import { describe, it, expect, vi } from 'vitest';

vi.mock('../constants', () => ({ MAX_CHAPTERS: [0, 50, 40, 27, 36, 34, 24, 21, 4, 31, ...Array(57).fill(10)] }));
import { stepCommentaryVerse } from './commentaryVerseNav';

const john3 = Array.from({ length: 36 }, (_, i) => i + 1);

describe('stepCommentaryVerse', () => {
  it('steps within a chapter', () => {
    expect(stepCommentaryVerse(43, 3, 16, 1, john3)).toMatchObject({ chapter: 3, verse: 17, crossesChapter: false });
    expect(stepCommentaryVerse(43, 3, 16, -1, john3)).toMatchObject({ chapter: 3, verse: 15, crossesChapter: false });
  });
  it('skips verses a translation omits', () => {
    expect(stepCommentaryVerse(44, 8, 36, 1, [35, 36, 38])).toMatchObject({ verse: 38 });
  });
  it('Next from the last verse goes to verse 1 of the next chapter', () => {
    expect(stepCommentaryVerse(43, 3, 36, 1, john3)).toEqual({ book: 43, chapter: 4, verse: 1, crossesChapter: true });
  });
  it('Next from the last chapter goes to the next book', () => {
    expect(stepCommentaryVerse(1, 50, 26, 1, [24, 25, 26])).toEqual({ book: 2, chapter: 1, verse: 1, crossesChapter: true });
  });
  it('Previous from verse 1 goes to the previous chapter (last verse resolved later)', () => {
    expect(stepCommentaryVerse(43, 3, 1, -1, john3)).toEqual({ book: 43, chapter: 2, verse: null, crossesChapter: true });
    expect(stepCommentaryVerse(2, 1, 1, -1)).toEqual({ book: 1, chapter: 50, verse: null, crossesChapter: true });
  });
  it('stops at both ends of the Bible', () => {
    expect(stepCommentaryVerse(1, 1, 1, -1)).toBeNull();
    expect(stepCommentaryVerse(66, 10, 5, 1, [1, 2, 3, 4, 5])).toBeNull();
  });
  it('without the chapter verses falls back to +/-1', () => {
    expect(stepCommentaryVerse(43, 3, 36, 1)).toMatchObject({ chapter: 3, verse: 37 });
  });
});
