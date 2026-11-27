import { describe, it, expect } from 'vitest';
import { sanitizeChapterModeNavState, DEFAULT_CHAPTER_STATE } from '../notesChapterNavState';

describe('sanitizeChapterModeNavState', () => {
  it('round-trips a full valid state through JSON', () => {
    const state = { book: 45, chapter: 8, translation: 'KJV', follow: false, onlyWithNotes: true, activeVerse: 3, anchorVerse: 1 };
    expect(sanitizeChapterModeNavState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('fills defaults for missing flags', () => {
    expect(sanitizeChapterModeNavState({ book: 1, chapter: 1 })).toEqual(DEFAULT_CHAPTER_STATE(1, 1));
  });

  it('rejects non-objects and out-of-range positions', () => {
    expect(sanitizeChapterModeNavState(null)).toBeUndefined();
    expect(sanitizeChapterModeNavState('x')).toBeUndefined();
    expect(sanitizeChapterModeNavState({ book: 67, chapter: 1 })).toBeUndefined();
    expect(sanitizeChapterModeNavState({ book: 0, chapter: 1 })).toBeUndefined();
    expect(sanitizeChapterModeNavState({ book: 65, chapter: 200 })).toBeUndefined(); // Jude has 1 chapter
    expect(sanitizeChapterModeNavState({ book: 65, chapter: 2 })).toBeUndefined();
    expect(sanitizeChapterModeNavState({ book: 1.5, chapter: 1 })).toBeUndefined();
  });

  it('drops bad optional fields but keeps the position', () => {
    expect(sanitizeChapterModeNavState({
      book: 1, chapter: 2, translation: 5, follow: 'yes', activeVerse: 0, anchorVerse: 1000,
    })).toEqual({ book: 1, chapter: 2, follow: true, onlyWithNotes: false });
  });
});
