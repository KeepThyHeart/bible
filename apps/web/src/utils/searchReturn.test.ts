import { describe, it, expect } from 'vitest';
import { createSearchReturn } from './searchReturn';

describe('searchReturn (B-182)', () => {
  const place = { book: 19, chapter: 23 };
  it('returns to the results on the first Back from the chapter the result opened', () => {
    const r = createSearchReturn();
    r.mark(place);
    expect(r.take(place, true)).toBe(true);
    expect(r.take(place, true)).toBe(false);
  });
  it('does not once the reader has moved to another chapter', () => {
    const r = createSearchReturn();
    r.mark(place);
    expect(r.take({ book: 19, chapter: 24 }, true)).toBe(false);
  });
  it('does not when the search was closed, or nothing was marked', () => {
    const r = createSearchReturn();
    r.mark(place);
    expect(r.take(place, false)).toBe(false);
    expect(createSearchReturn().take(place, true)).toBe(false);
  });
});
