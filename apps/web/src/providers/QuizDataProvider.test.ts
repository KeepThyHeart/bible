import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuizDataProvider } from './QuizDataProvider';

const catalog = {
  modules: [{ uuid: 'u1', name: 'Q', abbreviation: 'Q', sources: [] }],
  coverage: [{ book: 41, chapter: 1, count: 3 }],
};
const q = (key: string, origin = 'u1') => ({ key, origin, passages: [], kind: 'recall', mode: 'free_response', sources: [] });

function reply(status: number, body: unknown = {}) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
}

describe('QuizDataProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the catalog once and caches it', async () => {
    fetchMock.mockReturnValue(reply(200, catalog));
    const p = new QuizDataProvider('http://x');
    expect(await p.getCatalog()).toEqual(catalog);
    expect(await p.getCatalog()).toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://x/api/quiz');
  });

  it('answers an empty catalog on 404 and asks again next time', async () => {
    fetchMock.mockReturnValueOnce(reply(404)).mockReturnValueOnce(reply(200, catalog));
    const p = new QuizDataProvider('');
    expect(await p.getCatalog()).toEqual({ modules: [], coverage: [] });
    expect(await p.getCatalog()).toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a catalog server error without caching it', async () => {
    fetchMock.mockReturnValueOnce(reply(500)).mockReturnValueOnce(reply(200, catalog));
    const p = new QuizDataProvider('');
    await expect(p.getCatalog()).rejects.toThrow('500');
    expect(await p.getCatalog()).toEqual(catalog);
  });

  it('requests questions with range, kind and mode params and caches by URL', async () => {
    fetchMock.mockReturnValue(reply(200, { questions: [q('a')] }));
    const p = new QuizDataProvider('http://x');
    const passages = [{ start: 41001001, end: 41001999 }, { start: 41002001, end: 41002005 }];
    const filter = { kinds: ['recall'], modes: ['free_response'] };
    expect(await p.getQuestions(passages, filter)).toHaveLength(1);
    expect(await p.getQuestions(passages, filter)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://x/api/quiz/questions?range=41001001-41001999&range=41002001-41002005&kind=recall&mode=free_response',
    );
  });

  it('returns no questions on 404, throws on other errors, and applies moduleUuids', async () => {
    const p = new QuizDataProvider('');
    fetchMock.mockReturnValueOnce(reply(404));
    expect(await p.getQuestions([{ start: 1, end: 2 }])).toEqual([]);
    fetchMock.mockReturnValueOnce(reply(500));
    await expect(p.getQuestions([{ start: 1, end: 3 }])).rejects.toThrow('500');
    fetchMock.mockReturnValueOnce(reply(200, { questions: [q('a', 'u1'), q('b', 'u2')] }));
    const only = await p.getQuestions([{ start: 1, end: 4 }], { moduleUuids: ['u2'] });
    expect(only.map((x) => x.key)).toEqual(['b']);
  });

  it('keeps at most 50 question sets', async () => {
    fetchMock.mockImplementation(() => reply(200, { questions: [] }));
    const p = new QuizDataProvider('');
    for (let i = 1; i <= 51; i++) await p.getQuestions([{ start: i, end: i }]);
    expect(fetchMock).toHaveBeenCalledTimes(51);
    await p.getQuestions([{ start: 51, end: 51 }]); // still cached
    expect(fetchMock).toHaveBeenCalledTimes(51);
    await p.getQuestions([{ start: 1, end: 1 }]); // evicted
    expect(fetchMock).toHaveBeenCalledTimes(52);
  });
});
