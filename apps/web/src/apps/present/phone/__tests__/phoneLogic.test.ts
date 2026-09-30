import { describe, it, expect } from 'vitest';
import { tapWord, phraseOf, isWordPicked } from '../wordPick';
import { moveTarget, newestItem, isSwipeLeft, rangeOnWall } from '../planLogic';

describe('tapWord', () => {
  it('first tap starts, second completes in order', () => {
    const a = tapWord(null, 16, 4);
    expect(a).toEqual({ kind: 'start', pick: { verseId: 16, index: 4 } });
    expect(tapWord((a as any).pick, 16, 7)).toEqual({ kind: 'range', verseId: 16, start: 4, end: 7 });
  });
  it('accepts the last word first', () => {
    expect(tapWord({ verseId: 16, index: 7 }, 16, 4)).toEqual({ kind: 'range', verseId: 16, start: 4, end: 7 });
  });
  it('same word twice is a one-word phrase', () => {
    expect(tapWord({ verseId: 1, index: 3 }, 1, 3)).toEqual({ kind: 'range', verseId: 1, start: 3, end: 3 });
  });
  it('a tap in another verse restarts', () => {
    expect(tapWord({ verseId: 1, index: 3 }, 2, 0)).toEqual({ kind: 'start', pick: { verseId: 2, index: 0 } });
  });
  it('isWordPicked', () => {
    expect(isWordPicked({ verseId: 1, index: 3 }, 1, 3)).toBe(true);
    expect(isWordPicked(null, 1, 3)).toBe(false);
  });
});

describe('phraseOf', () => {
  it('joins words and trims end punctuation', () => {
    expect(phraseOf(['For', 'God,', 'so', 'loved,', 'the'], 1, 3)).toBe('God, so loved');
    expect(phraseOf(['“Go”', 'now.'], 0, 1)).toBe('Go” now');
  });
});

describe('planLogic', () => {
  it('moveTarget', () => {
    expect(moveTarget(0, 'up', 3)).toBeNull();
    expect(moveTarget(2, 'down', 3)).toBeNull();
    expect(moveTarget(1, 'up', 3)).toBe(0);
    expect(moveTarget(1, 'down', 3)).toBe(2);
  });
  it('newestItem', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(newestItem(new Set(['a', 'b']), items)?.id).toBe('c');
    expect(newestItem(new Set(['a', 'b', 'c']), items)).toBeUndefined();
  });
  it('isSwipeLeft', () => {
    expect(isSwipeLeft(-100, 10)).toBe(true);
    expect(isSwipeLeft(-50, 0)).toBe(false);
    expect(isSwipeLeft(-100, 90)).toBe(false);
    expect(isSwipeLeft(100, 0)).toBe(false);
  });
  it('rangeOnWall', () => {
    const r = { verseIdStart: 5, textStart: 1, textEnd: 3 };
    expect(rangeOnWall(r, [{ verseIdStart: 5, textStart: 1, verseIdEnd: 5, textEnd: 3 }])).toBe(true);
    expect(rangeOnWall(r, [{ verseIdStart: 5, textStart: 1, textEnd: 4 }])).toBe(false);
    expect(rangeOnWall(null, [])).toBe(false);
  });
});
