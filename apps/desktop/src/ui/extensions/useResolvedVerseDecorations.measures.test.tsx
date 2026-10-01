import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));
vi.mock('../services/keywordSetsAPI', () => ({
  keywordSetsAPI: { list: vi.fn().mockResolvedValue([]), put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/electronAPI', () => ({
  bibleAPI: { getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@bible/core/browser', async (orig) => ({
  ...(await orig<typeof import('@bible/core/browser')>()),
  loadChapterOccurrences: vi.fn().mockResolvedValue([
    { id: '1006015.1', verseId: 1006015, parts: [{ unit: 'cubit', quantity: { value: 300 } }], usage: 'literal', review: { status: 'reviewed' } },
  ]),
}));

import { useResolvedVerseDecorations } from './useResolvedVerseDecorations';
import { useMeasureStore } from '../stores/useMeasureStore';

const V = 1006015;
const text = 'The length of the ark shall be three hundred cubits';
const words = text.split(' ').map((t) => ({ text: t }));

describe('useResolvedVerseDecorations + measures', () => {
  it('underlines the unit word for its tab and surface, never without a surface', async () => {
    useMeasureStore.getState().syncChapter({
      tabId: 'm-tab', moduleId: 5, abbreviation: 'KJV', language: 'en', bookNumber: 1, chapter: 6,
      verses: [{ verse_id: V, text }], surface: 'standard', uiLocale: 'en-US',
    });
    await waitFor(() => expect(useMeasureStore.getState().chapters['m-tab']).toBeDefined());

    const hook = renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 'm-tab'));
    expect(hook.result.current?.words.get(9)?.underlines.length).toBeGreaterThan(0); // "cubits"
    expect(hook.result.current?.words.get(0)).toBeUndefined();

    expect(renderHook(() => useResolvedVerseDecorations(V, 5, undefined, words, 'm-tab')).result.current).toBeNull();
    expect(renderHook(() => useResolvedVerseDecorations(V, 6, 'standard', words, 'm-tab')).result.current).toBeNull();
    expect(renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 'other')).result.current).toBeNull();
  });
});
