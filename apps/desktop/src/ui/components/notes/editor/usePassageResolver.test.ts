import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const fetched: Array<[number, number]> = [];
vi.mock('../../../services/verseFetchCache', () => ({
  getVersesCached: async (_v: string, start: number, end: number) => {
    fetched.push([start, end]);
    return [{ verse_id: start, book_number: Math.floor(start / 1e6), chapter: Math.floor(start / 1000) % 1000, verse: start % 1000, text: 't' }];
  },
}));

import { usePassageResolver } from './usePassageResolver';

async function resolveTo(text: string) {
  const { result } = renderHook(() =>
    usePassageResolver({ enabled: true, initialReference: '', initialTranslation: 'KJV' }));
  act(() => result.current.setReference(text));
  await waitFor(() => expect(['ok', 'invalid', 'notfound', 'noTranslation']).toContain(result.current.status), { timeout: 2000 });
  return result.current.status;
}

describe('usePassageResolver lists (B-020)', () => {
  it.each(['Rom 8:28-30, 38-39', 'Rom 8:28, 9:1', 'John 3:16; Rom 8:28'])('accepts %s', async (text) => {
    fetched.length = 0;
    const st = await resolveTo(text);
    expect(st).not.toBe('invalid');
    expect(fetched.length).toBeGreaterThanOrEqual(2);
  });
});
