import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));
vi.mock('../services/keywordSetsAPI', () => ({
  keywordSetsAPI: { list: vi.fn().mockResolvedValue([]), put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/electronAPI', () => ({
  bibleAPI: { getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}) },
}));

import { useResolvedVerseDecorations } from './useResolvedVerseDecorations';
import { useKeywordMarkStore } from '../stores/useKeywordMarkStore';

const V = 43003016;
const words = ['For', 'God', 'so', 'loved'].map((text) => ({ text }));

describe('useResolvedVerseDecorations + keyword marks', () => {
  it('paints marked words for its tab only, and never without a surface', async () => {
    const store = useKeywordMarkStore.getState();
    store.syncChapter({
      tabId: 'kw-tab', moduleId: 5, abbreviation: 'KJV', language: 'en', bookNumber: 43, chapter: 3,
      verses: [{ verse_id: V, text: 'For God so loved' }],
    });
    await act(async () => { await store.addMarkFromWord('kw-tab', { text: 'God' }, 'word'); });

    const withTab = renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 'kw-tab'));
    expect(withTab.result.current).not.toBeNull();
    const paint = withTab.result.current!.words.get(1); // "God"
    expect(paint?.underlines.length).toBeGreaterThan(0);
    expect(paint?.badges.length).toBeGreaterThan(0); // colour-safe symbol badge
    expect(withTab.result.current!.words.get(2)).toBeUndefined(); // "so": nothing marks it

    const otherTab = renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 'other'));
    expect(otherTab.result.current).toBeNull();

    const otherModule = renderHook(() => useResolvedVerseDecorations(V, 6, 'standard', words, 'kw-tab'));
    expect(otherModule.result.current).toBeNull();

    const noSurface = renderHook(() => useResolvedVerseDecorations(V, 5, undefined, words, 'kw-tab'));
    expect(noSurface.result.current).toBeNull();

    act(() => useKeywordMarkStore.getState().toggleTab('kw-tab'));
    expect(withTab.result.current).toBeNull();
  });
});
