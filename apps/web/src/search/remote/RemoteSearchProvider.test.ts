import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteSemantic } from '@bible/core/browser';
import type { IBibleDataProvider, ISearchProvider } from '../../providers/interfaces';
import type { SearchResultSet } from '../../types';
import { RemoteConsentStore } from './consentStore';
import { RemoteSearchProvider } from './RemoteSearchProvider';

const JOHN_3_16 = 43003016;
const kwSet: SearchResultSet = {
  results: [{ verseId: 1001001, reference: 'Genesis 1:1', text: 'In the beginning', module: 'KJV', type: 'exact' }],
  total: 1,
};

function setup(opts: { via?: 'server' | 'browser'; fetch?: ReturnType<typeof vi.fn>; client?: { search: ReturnType<typeof vi.fn> } } = {}) {
  localStorage.clear();
  const consent = new RemoteConsentStore();
  consent.configure({ via: opts.via ?? 'server', noticeVersion: 1 });
  const inner = {
    keywordSearch: vi.fn(async () => kwSet),
    semanticSearch: vi.fn(),
    strongsSearch: vi.fn(async () => ({}) as never),
    warmupSemanticSearch: vi.fn(async () => {}),
  } satisfies ISearchProvider;
  const bible = {
    getVerseTexts: vi.fn(async (_m: string, ids: number[]) => ({
      verses: Object.fromEntries(ids.map((id) => [String(id), { text: `text ${id}`, text_html: `<i>text ${id}</i>` }])),
    })),
  } as unknown as IBibleDataProvider;
  const fetchMock = opts.fetch ?? vi.fn();
  const provider = new RemoteSearchProvider({
    baseUrl: 'http://app',
    inner,
    consent,
    getBible: async () => bible,
    getActiveModule: () => 'ESV',
    remote: opts.via === 'browser' ? { url: 'https://bibsearch.test', apiKey: 'k' } : undefined,
    fetch: fetchMock as unknown as typeof fetch,
    createClient: opts.client ? () => opts.client as never : undefined,
  });
  return { provider, consent, inner, bible, fetchMock };
}

const okBody = {
  results: [{ verseId: JOHN_3_16, reference: 'John 3:16', text: 'For God', module: 'KJV', type: 'verse' }],
  total: 1,
  semantic: { source: 'remote' },
};
const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('RemoteSearchProvider (via server)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup({ fetch: vi.fn(async () => jsonRes(200, okBody)) }); });

  it('sends nothing before consent: warm-up is a no-op and the dialog gates the search', async () => {
    await t.provider.warmupSemanticSearch();
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.inner.warmupSemanticSearch).not.toHaveBeenCalled();

    const p = t.provider.semanticSearch('love your enemies', { pageSize: 20, modules: ['KJV'] });
    await Promise.resolve();
    expect(t.consent.dialogOpen).toBe(true);
    expect(t.fetchMock).not.toHaveBeenCalled();
    t.consent.grant();
    const res = await p;
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetchMock.mock.calls[0];
    expect(url).toContain('/api/search/semantic?');
    expect(url).toContain('maxResults=20');
    expect(init.headers['X-Remote-Search-Consent']).toBe('1');
    expect(res.semantic?.source).toBe('remote');
    expect(res.results[0].reference).toBe('John 3:16');
    expect(t.consent.status).toBe('granted');
  });

  it('Not now falls back to keyword with the declined hint and does not ask again', async () => {
    const p = t.provider.semanticSearch('love your enemies', { modules: ['KJV'] });
    await Promise.resolve();
    t.consent.decline();
    const res = await p;
    expect(res.semantic).toEqual({ source: 'keyword', notice: { kind: 'declined' } });
    expect(res.results).toEqual(kwSet.results);
    const again = await t.provider.semanticSearch('another phrase', { modules: ['KJV'] });
    expect(t.consent.dialogOpen).toBe(false);
    expect(again.semantic?.notice).toEqual({ kind: 'declined' });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it('shares one keyword request between the store call and the fallback', async () => {
    t.consent.decline();
    const [, kw] = await Promise.all([
      t.provider.semanticSearch('love your enemies', { modules: ['KJV'] }),
      t.provider.keywordSearch('love your enemies', ['KJV']),
    ]);
    expect(kw.total).toBe(1);
    expect(t.inner.keywordSearch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, { error: { code: 'REMOTE_UNAVAILABLE' }, results: [], total: 0, semantic: { source: 'remote', notice: { kind: 'unavailable' } } }, { kind: 'unavailable' }],
    [503, { error: { code: 'REMOTE_UNAVAILABLE' }, results: [], total: 0, semantic: { source: 'remote', notice: { kind: 'quota', resetAtMs: 5 } } }, { kind: 'quota', resetAtMs: 5 }],
    [503, { error: { code: 'REMOTE_UNAVAILABLE' }, results: [], total: 0, semantic: { source: 'remote', notice: { kind: 'rephrase' } } }, { kind: 'rephrase' }],
    [503, { error: { code: 'REMOTE_UNAVAILABLE' } }, { kind: 'unavailable' }],
  ])('falls back to keyword on HTTP %i (%#)', async (status, body, notice) => {
    const f = setup({ fetch: vi.fn(async () => jsonRes(status, body)) });
    f.consent.grant();
    const res = await f.provider.semanticSearch('love your enemies', { modules: ['KJV'] });
    expect(res.semantic?.source).toBe('keyword');
    expect(res.semantic?.notice).toEqual(notice);
    expect(res.results).toEqual(kwSet.results);
  });

  it('falls back with "unavailable" when fetch throws', async () => {
    const f = setup({ fetch: vi.fn(async () => { throw new TypeError('down'); }) });
    f.consent.grant();
    const res = await f.provider.semanticSearch('love your enemies', { modules: ['KJV'] });
    expect(res.semantic).toEqual({ source: 'keyword', notice: { kind: 'unavailable' } });
  });

  it('does not send a query the client guard refuses', async () => {
    t.consent.grant();
    const res = await t.provider.semanticSearch('12', { modules: ['KJV'] });
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(res.semantic).toEqual({ source: 'keyword', notice: { kind: 'rephrase' } });
  });

  it('with no modules and a failure returns an empty set', async () => {
    const f = setup({ fetch: vi.fn(async () => jsonRes(503, {})) });
    f.consent.grant();
    const res = await f.provider.semanticSearch('love your enemies');
    expect(res.results).toEqual([]);
    expect(res.semantic?.source).toBe('keyword');
  });

  it('passes keyword and Strong\'s through', async () => {
    await t.provider.strongsSearch('G25');
    expect(t.inner.strongsSearch).toHaveBeenCalled();
  });
});

describe('RemoteSearchProvider (via browser)', () => {
  const hit = (n: number, start: number, end: number, score: number) =>
    ({ rank: n, id: `KJV.JHN.3.${start % 1000}`, score, startVerseId: start, endVerseId: end });
  const resp = (hits: unknown[], extra: Record<string, unknown> = {}) => ({
    query: 'q', hits, degraded: false, mode: 'semantic', skipped: 0,
    rateLimit: { remaining: 9, resetAtMs: 1000 }, ...extra,
  });

  it('sends nothing before Agree; then searches directly and hydrates into the reader translation', async () => {
    const client = { search: vi.fn(async () => resp([hit(1, JOHN_3_16, JOHN_3_16, 0.9), hit(2, 43003016, 43003018, 0.5)])) };
    const t = setup({ via: 'browser', client });
    await t.provider.warmupSemanticSearch();
    const p = t.provider.semanticSearch('love your enemies', { pageSize: 5, modules: ['ESV'] });
    await Promise.resolve();
    expect(client.search).not.toHaveBeenCalled();
    t.consent.grant();
    const res = await p;
    expect(client.search).toHaveBeenCalledWith('love your enemies', { k: 10 });
    expect(t.fetchMock).not.toHaveBeenCalled(); // never our own server
    expect(t.bible.getVerseTexts).toHaveBeenCalledWith('ESV', expect.arrayContaining([JOHN_3_16]));
    // The overlapping, lower-scored window is dropped.
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ verseId: JOHN_3_16, type: 'verse', module: 'ESV', text: `text ${JOHN_3_16}` });
    expect(res.semantic).toMatchObject({ source: 'remote', rateLimit: { remaining: 9 } });
    expect(res.semantic?.notice).toBeUndefined();
  });

  it('turns a window into a paragraph result with a range reference', async () => {
    const client = { search: vi.fn(async () => resp([hit(1, JOHN_3_16, 43003018, 0.9)])) };
    const t = setup({ via: 'browser', client });
    t.consent.grant();
    const res = await t.provider.semanticSearch('love your enemies', { modules: ['ESV'] });
    expect(res.results[0]).toMatchObject({ type: 'paragraph', endVerseId: 43003018 });
    expect(res.results[0].reference).toMatch(/3:16-18$/);
    expect(res.results[0].text).toBe('text 43003016 text 43003017 text 43003018');
  });

  it('shows the degraded note when the service answered with keyword results', async () => {
    const client = { search: vi.fn(async () => resp([hit(1, JOHN_3_16, JOHN_3_16, 0.9)], { degraded: true })) };
    const t = setup({ via: 'browser', client });
    t.consent.grant();
    const res = await t.provider.semanticSearch('love your enemies', { modules: ['ESV'] });
    expect(res.semantic?.source).toBe('remote');
    expect(res.semantic?.notice).toEqual({ kind: 'degraded' });
  });

  it.each([
    ['quota_exceeded', { resetAtMs: 99 }, { kind: 'quota', resetAtMs: 99 }],
    ['rate_limited', {}, { kind: 'paused' }],
    ['rejected', {}, { kind: 'rephrase' }],
    ['network', {}, { kind: 'unavailable' }],
    ['timeout', {}, { kind: 'unavailable' }],
  ] as const)('maps remote error %s to the right note and falls back', async (kind, details, notice) => {
    const client = { search: vi.fn(async () => { throw new RemoteSemantic.RemoteSemanticError(kind, 0, kind, undefined, details); }) };
    const t = setup({ via: 'browser', client });
    t.consent.grant();
    const res = await t.provider.semanticSearch('love your enemies', { modules: ['ESV'] });
    expect(res.semantic).toEqual({ source: 'keyword', notice });
    expect(res.results).toEqual(kwSet.results);
  });

  it('falls back when hydration fails', async () => {
    const client = { search: vi.fn(async () => resp([hit(1, JOHN_3_16, JOHN_3_16, 0.9)])) };
    const t = setup({ via: 'browser', client });
    (t.bible.getVerseTexts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
    t.consent.grant();
    const res = await t.provider.semanticSearch('love your enemies', { modules: ['ESV'] });
    expect(res.semantic?.source).toBe('keyword');
  });
});
