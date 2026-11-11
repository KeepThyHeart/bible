import { describe, it, expect } from 'vitest';
import { tapWord, phraseOf, isWordPicked } from '../wordPick';
import { moveTarget, newestItem, isSwipeLeft, rangeOnWall, adoptShown, onScreenSummary } from '../planLogic';

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

describe('adoptShown', () => {
  const psalm = { kind: 'passage', module: 'KJV', book: 19, chapter: 23 } as any;
  const hymn = { kind: 'hymn', hymnId: 'h1' } as any;
  it('adds an item that is not the newest row', () => {
    expect(adoptShown(hymn, [])).toEqual({ action: 'add' });
    expect(adoptShown(hymn, [{ id: 'a', item: psalm }])).toEqual({ action: 'add' });
  });
  it('reuses the newest row when it holds the same item', () => {
    expect(adoptShown(psalm, [{ id: 'a', item: hymn }, { id: 'b', item: { ...psalm } }])).toEqual({ action: 'reuse', id: 'b' });
  });
});

describe('onScreenSummary', () => {
  const passage = { kind: 'passage', module: 'KJV', book: 19, chapter: 23 } as any;
  it('is empty with nothing live', () => {
    expect(onScreenSummary(null, false, null).mode).toBe('empty');
  });
  it('is hidden when blanked', () => {
    expect(onScreenSummary(passage, true, 'Psalm 23:1', 'x')).toEqual({ mode: 'hidden', title: 'Psalm 23:1', line: '' });
  });
  it('shows reference and verse text for a passage', () => {
    expect(onScreenSummary(passage, false, 'Psalm 23:1', 'The Lord is my shepherd')).toEqual({ mode: 'item', title: 'Psalm 23:1', line: 'The Lord is my shepherd' });
  });
  it('shows only the title for a hymn', () => {
    expect(onScreenSummary({ kind: 'hymn', hymnId: 'h1' } as any, false, 'Amazing Grace')).toEqual({ mode: 'item', title: 'Amazing Grace', line: '' });
  });
  it('truncates a long quote', () => {
    const r = onScreenSummary({ kind: 'quote', text: 'word '.repeat(60) } as any, false, 'q');
    expect(r.line.length).toBeLessThanOrEqual(120);
    expect(r.line.endsWith('…')).toBe(true);
  });
});
