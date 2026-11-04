import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { adjacentChapter } from './adjacentChapter';
import { useBibleNavigation } from './hooks/useBibleNavigation';

describe('adjacentChapter', () => {
  it('moves within a book', () => {
    expect(adjacentChapter(1, 2, 'prev')).toEqual({ book: 1, chapter: 1 });
    expect(adjacentChapter(1, 2, 'next')).toEqual({ book: 1, chapter: 3 });
  });
  it('crosses book boundaries, landing on the last chapter going back', () => {
    expect(adjacentChapter(1, 50, 'next')).toEqual({ book: 2, chapter: 1 });
    expect(adjacentChapter(2, 1, 'prev')).toEqual({ book: 1, chapter: 50 });
    expect(adjacentChapter(40, 1, 'prev')).toEqual({ book: 39, chapter: 4 });
    expect(adjacentChapter(39, 4, 'next')).toEqual({ book: 40, chapter: 1 });
  });
  it('has no neighbour before Genesis 1 or after Revelation 22', () => {
    expect(adjacentChapter(1, 1, 'prev')).toBeNull();
    expect(adjacentChapter(66, 22, 'next')).toBeNull();
    expect(adjacentChapter(66, 22, 'prev')).toEqual({ book: 66, chapter: 21 });
    expect(adjacentChapter(1, 1, 'next')).toEqual({ book: 1, chapter: 2 });
  });
  it('single-chapter books (Obadiah) hop straight to the neighbour book', () => {
    expect(adjacentChapter(31, 1, 'next')).toEqual({ book: 32, chapter: 1 });
    expect(adjacentChapter(31, 1, 'prev')).toEqual({ book: 30, chapter: 9 });
  });
});

describe('useBibleNavigation', () => {
  it('pages with the same boundary rules and never overshoots Revelation 22', () => {
    const calls: Array<[number, number]> = [];
    const load = (b: number, c: number) => { calls.push([b, c]); };
    const rev = renderHook(() => useBibleNavigation({ currentBook: 66, currentChapter: 22, loadChapter: load })).result.current;
    rev.handleNextChapter();
    expect(calls).toEqual([]);
    const ex = renderHook(() => useBibleNavigation({ currentBook: 2, currentChapter: 1, loadChapter: load })).result.current;
    ex.handlePreviousChapter();
    expect(calls).toEqual([[1, 50]]);
  });
});
