import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WordStudySubject } from '@bible/core/browser';
import { WordStudyProvider, WordStudyOfflineError, isWordStudyOfflineError, getWordStudyProvider } from './WordStudyProvider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ok = (data: unknown) => ({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve('') });

beforeEach(() => { mockFetch.mockReset(); });

describe('WordStudyProvider', () => {
  const p = new WordStudyProvider('http://x');

  it('resolve GETs an encoded query', async () => {
    mockFetch.mockResolvedValue(ok([]));
    await expect(p.resolve('ἀγαπάω & co')).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(`http://x/api/word-study/resolve?q=${encodeURIComponent('ἀγαπάω & co')}`);
  });

  it('getOverview POSTs subject and options', async () => {
    mockFetch.mockResolvedValue(ok({ totals: { occurrences: 1, verses: 1 } }));
    const subject: WordStudySubject = { kind: 'strongs', strongs: 'G25' };
    await p.getOverview(subject, { module: 'KJV' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://x/api/word-study/overview');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ subject, options: { module: 'KJV' } });
  });

  it('getOccurrences POSTs subject and query', async () => {
    mockFetch.mockResolvedValue(ok({ total: 0, items: [] }));
    const subject: WordStudySubject = { kind: 'group', group: { id: 'g', label: 'love', terms: ['love'] } };
    await expect(p.getOccurrences(subject, { module: 'KJV', limit: 10 })).resolves.toEqual({ total: 0, items: [] });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ subject, query: { module: 'KJV', limit: 10 } });
  });

  it('maps a network failure to WordStudyOfflineError', async () => {
    mockFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    let err: unknown;
    try { await p.resolve('love'); } catch (e) { err = e; }
    expect(isWordStudyOfflineError(err)).toBe(true);
  });

  it('throws WordStudyOfflineError without fetching when navigator is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    try {
      await expect(p.resolve('love')).rejects.toBeInstanceOf(WordStudyOfflineError);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('fetch', mockFetch);
    }
  });

  it('surfaces HTTP errors as ordinary errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('bad') });
    const err = await p.getOverview({ kind: 'strongs', strongs: 'x' }).catch(e => e);
    expect(err.message).toBe('API error 400: bad');
    expect(isWordStudyOfflineError(err)).toBe(false);
  });

  it('exposes a singleton', () => {
    expect(getWordStudyProvider()).toBe(getWordStudyProvider());
  });
});
