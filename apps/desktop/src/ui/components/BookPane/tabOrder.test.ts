import { describe, it, expect } from 'vitest';
import { mergeTabOrder, moveTab, sameTabOrder, indexWithinType, tabRefKey } from './tabOrder';
import type { PaneTabRef } from '../../stores/useBookStore';

const book = (abbreviation: string): PaneTabRef => ({ type: 'book', abbreviation });
const dict = (abbreviation: string): PaneTabRef => ({ type: 'dictionary', abbreviation });

/** Compact "book_a, dict:x" rendering, so a failure reads as an order not an object dump. */
const shape = (order: readonly PaneTabRef[]): string =>
  order.map(ref => (ref.type === 'book' ? ref.abbreviation : `dict:${ref.abbreviation}`)).join(', ');

describe('mergeTabOrder', () => {
  it('keeps books and dictionaries in the order they were opened', () => {
    // Book A, then Dictionary X, then Book B: each open records itself before
    // the next arrives, so the strip stays interleaved. Concatenating the two
    // stores instead produced "A, B, X".
    let order = mergeTabOrder([], ['A'], []);
    order = mergeTabOrder(order, ['A'], ['X']);
    order = mergeTabOrder(order, ['A', 'B'], ['X']);

    expect(shape(order)).toBe('A, dict:X, B');
  });

  it('appends a module opened by some other route to the end of the strip', () => {
    const order = mergeTabOrder([book('A'), dict('X')], ['A'], ['X', 'Strongs']);

    expect(shape(order)).toBe('A, dict:X, dict:Strongs');
  });

  it('drops closed tabs without disturbing the tabs on either side', () => {
    const order = mergeTabOrder([book('A'), dict('X'), book('B')], ['A', 'B'], []);

    expect(shape(order)).toBe('A, B');
  });

  it('survives closing the middle tab of an interleaved strip', () => {
    const start = [book('A'), dict('X'), book('B'), dict('Y')];

    const afterClose = mergeTabOrder(start, ['A', 'B'], ['Y']);

    expect(shape(afterClose)).toBe('A, B, dict:Y');
  });

  it('is idempotent, so rendering from its own output cannot loop', () => {
    const once = mergeTabOrder([], ['A', 'B'], ['X']);
    const twice = mergeTabOrder(once, ['A', 'B'], ['X']);

    expect(sameTabOrder(once, twice)).toBe(true);
  });

  it('never shows the same module twice, even from a corrupted stored order', () => {
    const order = mergeTabOrder([book('A'), book('A')], ['A'], []);

    expect(shape(order)).toBe('A');
  });

  it('tells a book and a dictionary of the same abbreviation apart', () => {
    const order = mergeTabOrder([dict('Shared'), book('Shared')], ['Shared'], ['Shared']);

    expect(shape(order)).toBe('dict:Shared, Shared');
    expect(tabRefKey(book('Shared'))).not.toBe(tabRefKey(dict('Shared')));
  });

  it('falls back to books-then-dictionaries with no stored order (a pre-strip session)', () => {
    const order = mergeTabOrder([], ['A', 'B'], ['X']);

    expect(shape(order)).toBe('A, B, dict:X');
  });
});

describe('moveTab', () => {
  const start = [book('A'), dict('X'), book('B')];

  it('moves a dictionary tab to the front', () => {
    expect(shape(moveTab(start, 1, 0))).toBe('dict:X, A, B');
  });

  it('moves a book tab past a dictionary tab', () => {
    expect(shape(moveTab(start, 2, 0))).toBe('B, A, dict:X');
  });

  it('leaves the order alone for an out-of-range or no-op move', () => {
    expect(shape(moveTab(start, 1, 1))).toBe(shape(start));
    expect(shape(moveTab(start, -1, 0))).toBe(shape(start));
    expect(shape(moveTab(start, 0, 9))).toBe(shape(start));
  });
});

describe('indexWithinType', () => {
  // A drag is expressed in strip positions; each content store only understands
  // positions within its own array.
  const order = [book('A'), dict('X'), book('B'), dict('Y')];

  it('reports a book position ignoring the dictionaries in between', () => {
    expect(indexWithinType(order, book('B'))).toBe(1);
  });

  it('reports a dictionary position ignoring the books in between', () => {
    expect(indexWithinType(order, dict('Y'))).toBe(1);
  });

  it('reports -1 for a module that is not in the strip', () => {
    expect(indexWithinType(order, book('Z'))).toBe(-1);
  });
});

describe('sameTabOrder', () => {
  it('distinguishes a reordered strip from an unchanged one', () => {
    expect(sameTabOrder([book('A'), dict('X')], [book('A'), dict('X')])).toBe(true);
    expect(sameTabOrder([book('A'), dict('X')], [dict('X'), book('A')])).toBe(false);
    expect(sameTabOrder([book('A')], [book('A'), dict('X')])).toBe(false);
  });
});
