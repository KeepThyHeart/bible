/**
 * Task 0216: a search never switches itself to Ideas (meaning) search, and the
 * Ideas -> Keyword suggestion probe is a single local phrase search.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const performSearchMock = vi.fn();
const semanticSearchExMock = vi.fn();

vi.mock('../services/electronAPI', () => ({
  searchAPI: {
    performSearch: (...args: unknown[]) => performSearchMock(...args),
    semanticSearchEx: (...args: unknown[]) => semanticSearchExMock(...args),
    semanticAvailable: vi.fn().mockResolvedValue(true),
  },
  dictionaryAPI: { getAvailableDictionaries: vi.fn().mockResolvedValue([]), getEntryByKey: vi.fn() },
  remoteSemanticAPI: {},
}));

import { useSearchStore } from './useSearchStore';

describe('useSearchStore - no automatic switch to Ideas search', () => {
  beforeEach(() => {
    performSearchMock.mockReset();
    semanticSearchExMock.mockReset();
    useSearchStore.setState({ semanticAvailable: true, isSemanticMode: false });
  });

  it('a keyword search with zero results stays keyword and never runs a meaning search', async () => {
    performSearchMock.mockResolvedValue([]);
    await useSearchStore.getState().performSearch('zzzz qqqq', { reveal: false });

    const st = useSearchStore.getState();
    expect(st.resultsForQuery).toBe('zzzz qqqq');
    expect(st.searchResults).toHaveLength(0);
    expect(st.isSemanticMode).toBe(false);
    expect(semanticSearchExMock).not.toHaveBeenCalled();
  });

  it('switches only when asked (toggleSemanticMode), then runs the meaning search', async () => {
    performSearchMock.mockResolvedValue([]);
    semanticSearchExMock.mockResolvedValue({ results: [], source: 'local' });
    await useSearchStore.getState().performSearch('zzzz qqqq', { reveal: false });
    useSearchStore.getState().toggleSemanticMode();
    expect(useSearchStore.getState().isSemanticMode).toBe(true);
    await vi.waitFor(() => expect(semanticSearchExMock).toHaveBeenCalledTimes(1));
  });
});

describe('useSearchStore.hasExactPhraseMatch', () => {
  beforeEach(() => {
    performSearchMock.mockReset();
  });

  it('is true when a single-hit quoted phrase search finds a verse', async () => {
    performSearchMock.mockResolvedValue([{ verseId: 43003016 }]);
    await expect(useSearchStore.getState().hasExactPhraseMatch('God so loved')).resolves.toBe(true);
    expect(performSearchMock).toHaveBeenCalledWith('"God so loved"', expect.objectContaining({ maxResults: 1, autoFuzzy: false }));
  });

  it('is false when the phrase does not occur', async () => {
    performSearchMock.mockResolvedValue([]);
    await expect(useSearchStore.getState().hasExactPhraseMatch('love of money tree')).resolves.toBe(false);
  });

  it('skips the search for single words and for queries that already use operators', async () => {
    const { hasExactPhraseMatch } = useSearchStore.getState();
    await expect(hasExactPhraseMatch('love')).resolves.toBe(false);
    await expect(hasExactPhraseMatch('"God so" loved')).resolves.toBe(false);
    await expect(hasExactPhraseMatch('love -hate')).resolves.toBe(false);
    expect(performSearchMock).not.toHaveBeenCalled();
  });

  it('is false (not an error) when the search fails', async () => {
    performSearchMock.mockRejectedValue(new Error('boom'));
    await expect(useSearchStore.getState().hasExactPhraseMatch('God so loved')).resolves.toBe(false);
  });
});
