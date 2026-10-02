import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./bibleStore', () => ({ bibleStore: { getActiveModule: () => 'KJV' } }));

import { wordStudyStore, WORD_STUDY_PAGE_SIZE } from './wordStudyStore';
import { WordStudyOfflineError } from '../providers/WordStudyProvider';
import type { IWordStudyProvider, WordOccurrenceItem, WordStudyOverview } from '@bible/core/browser';

function overview(label: string, extra: Partial<WordStudyOverview> = {}): WordStudyOverview {
  return {
    subject: { kind: 'strongs', label },
    entry: null, modules: [], module: 'KJV', totals: { occurrences: 250, verses: 240 },
    bookCounts: {}, forms: [], morphology: [], family: [], semanticRange: null, ...extra,
  };
}

function items(n: number, from = 0): WordOccurrenceItem[] {
  return Array.from({ length: n }, (_, i) => ({ verseId: 43003016 + from + i, start: 0, end: 0, form: 'love' }));
}

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let provider: { resolve: ReturnType<typeof vi.fn>; getOverview: ReturnType<typeof vi.fn>; getOccurrences: ReturnType<typeof vi.fn> };

beforeEach(() => {
  provider = {
    resolve: vi.fn(async () => []),
    getOverview: vi.fn(async (subject) => overview(subject.kind === 'strongs' ? subject.strongs : subject.group.label)),
    getOccurrences: vi.fn(async (_s, q) => ({ total: 250, items: items(Math.min(q.limit ?? 100, 250 - (q.offset ?? 0)), q.offset ?? 0) })),
  };
  wordStudyStore.init(provider as unknown as IWordStudyProvider);
  wordStudyStore.reset();
});

describe('wordStudyStore submit', () => {
  it('a Strong\'s number studies it without resolving', async () => {
    await wordStudyStore.submit('g25');
    expect(provider.resolve).not.toHaveBeenCalled();
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G25' });
    expect(wordStudyStore.overview?.subject.label).toBe('G25');
    expect(wordStudyStore.occurrences?.items).toHaveLength(WORD_STUDY_PAGE_SIZE);
  });

  it('asks for the active Bible first', async () => {
    await wordStudyStore.submit('G25');
    expect(provider.getOverview.mock.calls[0][1]).toMatchObject({ module: 'KJV' });
  });

  it('falls back to the server pick when the active Bible is not tagged', async () => {
    provider.getOverview
      .mockResolvedValueOnce(overview('G25', { notice: 'not-tagged', module: 'ESV' }))
      .mockResolvedValueOnce(overview('G25', { module: 'KJV' }));
    await wordStudyStore.submit('G25');
    expect(provider.getOverview).toHaveBeenCalledTimes(2);
    expect(provider.getOverview.mock.calls[1][1].module).toBeUndefined();
    expect(wordStudyStore.overview?.notice).toBeUndefined();
  });

  it('a word with one candidate opens it directly', async () => {
    provider.resolve.mockResolvedValue([{ strongs: 'G26', language: 'Greek', gloss: 'love' }]);
    await wordStudyStore.submit('agape');
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
    expect(wordStudyStore.candidates).toEqual([]);
  });

  it('several candidates become a pick list, and picking one studies it', async () => {
    provider.resolve.mockResolvedValue([
      { strongs: 'G25', language: 'Greek', gloss: 'to love' },
      { strongs: 'G26', language: 'Greek', gloss: 'love' },
    ]);
    await wordStudyStore.submit('love');
    expect(wordStudyStore.candidates).toHaveLength(2);
    expect(wordStudyStore.subject).toBeNull();
    expect(wordStudyStore.loading).toBe(false);
    await wordStudyStore.pickCandidate('G26');
    expect(wordStudyStore.candidates).toEqual([]);
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
  });

  it('no candidates makes a word group', async () => {
    await wordStudyStore.submit('grace');
    expect(wordStudyStore.subject?.kind).toBe('group');
    if (wordStudyStore.subject?.kind === 'group') expect(wordStudyStore.subject.group.terms).toEqual(['grace']);
  });

  it.each(['love, loved', 'lov*', 'love; hate', 'a|b'])('group syntax %j skips resolve', async (text) => {
    await wordStudyStore.submit(text);
    expect(provider.resolve).not.toHaveBeenCalled();
    expect(wordStudyStore.subject?.kind).toBe('group');
  });

  it('ignores blank input', async () => {
    await wordStudyStore.submit('   ');
    expect(provider.getOverview).not.toHaveBeenCalled();
  });
});

describe('wordStudyStore occurrences', () => {
  it('load more appends the next page', async () => {
    await wordStudyStore.openStrongs('G25');
    expect(wordStudyStore.hasMore).toBe(true);
    await wordStudyStore.loadMore();
    expect(provider.getOccurrences.mock.calls[1][1]).toMatchObject({ offset: 100, limit: 100 });
    expect(wordStudyStore.occurrences?.items).toHaveLength(200);
    await wordStudyStore.loadMore();
    expect(wordStudyStore.occurrences?.items).toHaveLength(250);
    expect(wordStudyStore.hasMore).toBe(false);
    await wordStudyStore.loadMore();
    expect(provider.getOccurrences).toHaveBeenCalledTimes(3);
  });

  it('a filter change reloads from the first page', async () => {
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.loadMore();
    await wordStudyStore.setFilters({ book: 43, form: 'love' });
    const q = provider.getOccurrences.mock.calls.at(-1)![1];
    expect(q).toMatchObject({ book: 43, form: 'love', offset: 0 });
    expect(wordStudyStore.occurrences?.items).toHaveLength(WORD_STUDY_PAGE_SIZE);
    expect(wordStudyStore.filters).toEqual({ book: 43, form: 'love' });
  });

  it('a new subject clears the filters', async () => {
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.setFilters({ book: 43 });
    await wordStudyStore.openStrongs('G26');
    expect(wordStudyStore.filters).toEqual({});
  });

  it('changing module or rendering mode reloads the overview', async () => {
    provider.getOverview.mockImplementation(async (_s, o) => overview('G25', { module: o?.module ?? 'KJV' }));
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.setModule('ESV');
    expect(provider.getOverview.mock.calls.at(-1)![1]).toMatchObject({ module: 'ESV' });
    await wordStudyStore.setRenderingMode('phrase');
    expect(provider.getOverview.mock.calls.at(-1)![1]).toMatchObject({ module: 'ESV', renderingMode: 'phrase' });
    expect(provider.getOccurrences.mock.calls.at(-1)![1]).toMatchObject({ renderingMode: 'phrase' });
  });

  it('drops a stale occurrence page after the filter changed', async () => {
    await wordStudyStore.openStrongs('G25');
    const slow = deferred<{ total: number; items: WordOccurrenceItem[] }>();
    provider.getOccurrences.mockReturnValueOnce(slow.promise);
    const first = wordStudyStore.setFilters({ book: 1 });
    const second = wordStudyStore.setFilters({ book: 2 });
    await second;
    slow.resolve({ total: 1, items: items(1) });
    await first;
    expect(wordStudyStore.occurrences?.total).toBe(250);
    expect(wordStudyStore.filters).toEqual({ book: 2 });
  });
});

describe('wordStudyStore stale study responses', () => {
  it('drops a slow overview for a subject the reader left', async () => {
    const slow = deferred<WordStudyOverview>();
    provider.getOverview.mockReturnValueOnce(slow.promise);
    const first = wordStudyStore.openStrongs('G25');
    await wordStudyStore.openStrongs('G26');
    slow.resolve(overview('G25'));
    await first;
    expect(wordStudyStore.overview?.subject.label).toBe('G26');
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
  });

  it('drops a slow resolve after a newer submit', async () => {
    const slow = deferred<never[]>();
    provider.resolve.mockReturnValueOnce(slow.promise);
    const first = wordStudyStore.submit('grace');
    await wordStudyStore.submit('G26');
    slow.resolve([]);
    await first;
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
  });
});

describe('wordStudyStore trail', () => {
  it('goes back and forward and truncates on a new subject', async () => {
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.openStrongs('G26');
    await wordStudyStore.openStrongs('G27');
    expect(wordStudyStore.canGoBack).toBe(true);
    expect(wordStudyStore.canGoForward).toBe(false);
    await wordStudyStore.back();
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
    expect(wordStudyStore.canGoForward).toBe(true);
    await wordStudyStore.back();
    expect(wordStudyStore.canGoBack).toBe(false);
    await wordStudyStore.forward();
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
    await wordStudyStore.openStrongs('G30');
    expect(wordStudyStore.canGoForward).toBe(false);
    await wordStudyStore.back();
    expect(wordStudyStore.subject).toEqual({ kind: 'strongs', strongs: 'G26' });
  });

  it('does not stack the same subject twice', async () => {
    await wordStudyStore.openStrongs('G25');
    await wordStudyStore.openStrongs('G25');
    expect(wordStudyStore.canGoBack).toBe(false);
  });
});

describe('wordStudyStore offline and errors', () => {
  it('flags offline for the friendly state', async () => {
    provider.getOverview.mockRejectedValue(new WordStudyOfflineError());
    await wordStudyStore.openStrongs('G25');
    expect(wordStudyStore.offline).toBe(true);
    expect(wordStudyStore.error).toBeNull();
    expect(wordStudyStore.loading).toBe(false);
  });

  it('flags offline when resolve fails', async () => {
    provider.resolve.mockRejectedValue(new WordStudyOfflineError());
    await wordStudyStore.submit('love');
    expect(wordStudyStore.offline).toBe(true);
  });

  it('keeps other failures as an error message and recovers on reload', async () => {
    provider.getOverview.mockRejectedValueOnce(new Error('API error 500'));
    await wordStudyStore.openStrongs('G25');
    expect(wordStudyStore.error).toBe('API error 500');
    expect(wordStudyStore.offline).toBe(false);
    await wordStudyStore.reload();
    expect(wordStudyStore.error).toBeNull();
    expect(wordStudyStore.overview).not.toBeNull();
  });
});

describe('wordStudyStore is read-only for groups', () => {
  it('studies an ad-hoc group without persisting anything', async () => {
    localStorage.clear();
    await wordStudyStore.submit('love, lov* -lovely');
    expect(wordStudyStore.subject?.kind).toBe('group');
    expect(localStorage.length).toBe(0);
    expect('saveGroup' in wordStudyStore).toBe(false);
    expect('groups' in wordStudyStore).toBe(false);
  });
});
