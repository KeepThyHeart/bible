/**
 * The Back button's visit stack.
 *
 * These cases are written against the three properties that make it *not* the
 * navigation history: repeats are kept (order is temporal, not a set), paging
 * leaves a breadcrumb per chapter, and the cap drops the oldest end.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_VISIT_STACK_SIZE,
  canGoBackVisit,
  currentVisit,
  normalizeVisitStack,
  popVisit,
  pushVisit,
  saveVisitScrollTop,
  type ChapterVisit,
} from './visitStack';

function visit(bookNumber: number, chapter: number, verse = 1): ChapterVisit {
  return {
    bookNumber,
    chapter,
    bookName: `Book${bookNumber}`,
    verseId: bookNumber * 1000000 + chapter * 1000 + verse,
    abbreviation: 'KJV',
  };
}

describe('visitStack - pushVisit', () => {
  it('appends a chapter that differs from the top', () => {
    const stack = pushVisit(pushVisit([], visit(43, 3)), visit(43, 4));
    expect(stack.map(v => v.chapter)).toEqual([3, 4]);
  });

  it('does not stack a consecutive duplicate', () => {
    const stack = pushVisit(pushVisit([], visit(43, 3)), visit(43, 3));
    expect(stack).toHaveLength(1);
  });

  it('refreshes the top when the chapter repeats, so Back returns to the right verse', () => {
    const stack = pushVisit(pushVisit([], visit(43, 3, 1)), visit(43, 3, 16));
    expect(stack).toHaveLength(1);
    expect(currentVisit(stack)?.verseId).toBe(visit(43, 3, 16).verseId);
  });

  it('keeps non-adjacent repeats — leaving and returning is two visits', () => {
    let stack: ChapterVisit[] = [];
    stack = pushVisit(stack, visit(43, 3));
    stack = pushVisit(stack, visit(45, 8));
    stack = pushVisit(stack, visit(43, 3));

    expect(stack.map(v => `${v.bookNumber}:${v.chapter}`))
      .toEqual(['43:3', '45:8', '43:3']);
  });

  it('caps the stack from the oldest end', () => {
    let stack: ChapterVisit[] = [];
    for (let chapter = 1; chapter <= 6; chapter++) {
      stack = pushVisit(stack, visit(43, chapter), 4);
    }

    expect(stack.map(v => v.chapter)).toEqual([3, 4, 5, 6]);
  });

  it('defaults to a cap far deeper than the history dropdown', () => {
    expect(DEFAULT_MAX_VISIT_STACK_SIZE).toBeGreaterThan(10);
  });
});

describe('visitStack - popVisit / canGoBackVisit', () => {
  it('reports nothing to go back to for an empty or single-entry stack', () => {
    expect(canGoBackVisit([])).toBe(false);
    expect(canGoBackVisit([visit(43, 3)])).toBe(false);
    expect(popVisit([visit(43, 3)])).toBeNull();
  });

  it('drops the current view and targets the one underneath', () => {
    const stack = [visit(43, 3), visit(43, 4), visit(43, 5)];
    const popped = popVisit(stack);

    expect(popped?.target.chapter).toBe(4);
    expect(popped?.stack.map(v => v.chapter)).toEqual([3, 4]);
  });

  it('walks back one chapter at a time through a paged run', () => {
    let stack = [1, 2, 3, 4].reduce<ChapterVisit[]>((s, c) => pushVisit(s, visit(43, c)), []);
    const landed: number[] = [];

    for (let i = 0; i < 3; i++) {
      const popped = popVisit(stack);
      if (!popped) break;
      stack = popped.stack;
      landed.push(popped.target.chapter);
    }

    expect(landed).toEqual([3, 2, 1]);
    expect(canGoBackVisit(stack)).toBe(false);
  });

  it('leaves the input stack untouched', () => {
    const stack = [visit(43, 3), visit(43, 4)];
    popVisit(stack);
    expect(stack).toHaveLength(2);
  });
});

describe('visitStack - saveVisitScrollTop', () => {
  it('records the offset on the current visit only', () => {
    const stack = saveVisitScrollTop([visit(43, 3), visit(43, 4)], 420);

    expect(stack[1]?.scrollTop).toBe(420);
    expect(stack[0]?.scrollTop).toBeUndefined();
  });

  it('is a no-op on an empty stack', () => {
    expect(saveVisitScrollTop([], 420)).toEqual([]);
  });
});

describe('visitStack - normalizeVisitStack', () => {
  it('returns an empty stack for anything that is not an array', () => {
    expect(normalizeVisitStack(undefined)).toEqual([]);
    expect(normalizeVisitStack(null)).toEqual([]);
    expect(normalizeVisitStack('nope')).toEqual([]);
  });

  it('drops malformed entries rather than failing the whole restore', () => {
    const restored = normalizeVisitStack([
      visit(43, 3),
      { bookNumber: 43 },
      null,
      { bookNumber: 45, chapter: 8, verseId: 45008001 },
    ]);

    expect(restored.map(v => v.chapter)).toEqual([3, 8]);
    expect(restored[1]?.bookName).toBe('');
  });

  it('caps a persisted stack that is longer than the limit', () => {
    const raw = Array.from({ length: 8 }, (_, i) => visit(43, i + 1));
    expect(normalizeVisitStack(raw, 3).map(v => v.chapter)).toEqual([6, 7, 8]);
  });
});
