import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getRows = vi.fn();
vi.mock('../../../services/electronAPI', () => ({ bibleAPI: { getInterlinearWordsForChapter: (...a: unknown[]) => getRows(...a) } }));

import { strongsAt, useWordStrongs, resetWordStrongsCache } from './useWordStrongs';

const V = 43003016;

describe('strongsAt', () => {
  it('finds the span covering the word index', () => {
    const spans = [{ verseId: V, start: 2, end: 3, strongs: 'G4102' }, { verseId: V, start: 5, end: 5 }];
    expect(strongsAt(spans, V, 3)).toBe('G4102');
    expect(strongsAt(spans, V, 4)).toBeUndefined();
    expect(strongsAt(spans, V, 5)).toBeUndefined(); // span without Strong's
    expect(strongsAt(spans, V + 1, 2)).toBeUndefined();
  });
});

describe('useWordStrongs', () => {
  beforeEach(() => { resetWordStrongsCache(); getRows.mockReset(); });

  it('resolves the Strong\'s number from the chapter rows, fetching the chapter once', async () => {
    getRows.mockResolvedValue({ [String(V)]: [{ wordPositionStart: 1, wordPositionEnd: 1, strongsNumber: 'G25' }] });
    const { result, rerender } = renderHook(({ w }) => useWordStrongs('KJV', V, w), { initialProps: { w: 1 } });
    await waitFor(() => expect(result.current).toBe('G25'));
    expect(getRows).toHaveBeenCalledWith('KJV', 43, 3);
    rerender({ w: 4 });
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(getRows).toHaveBeenCalledTimes(1);
  });

  it('stays undefined when there is no word or the fetch fails', async () => {
    getRows.mockRejectedValue(new Error('no data'));
    const a = renderHook(() => useWordStrongs('KJV', V, undefined));
    expect(a.result.current).toBeUndefined();
    const b = renderHook(() => useWordStrongs('KJV', V, 1));
    await new Promise((r) => setTimeout(r, 10));
    expect(b.result.current).toBeUndefined();
  });
});
