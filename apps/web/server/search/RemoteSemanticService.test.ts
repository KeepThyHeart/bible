import { describe, it, expect, vi } from 'vitest';
import { RemoteSemantic } from '@bible/core';
import { RemoteSemanticService, hasRemoteConsent } from './RemoteSemanticService';

const JHN_3_16 = 43003016;
const JHN_3_17 = 43003017;

function fakeFetch(body: object, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn(async (_url: unknown, _init?: unknown) =>
    new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...init.headers } }));
}

function makeService(fetchFn: ReturnType<typeof fakeFetch>) {
  const client = new RemoteSemantic.RemoteSemanticClient({ baseUrl: 'http://bibsearch.internal/', apiKey: 'k1', fetch: fetchFn as unknown as typeof fetch });
  return new RemoteSemanticService(client);
}

const repo = {
  getVerse: (id: number) => ({ text: `verse ${id}` }),
  getVerseRange: (a: number, b: number) => [{ text: `v${a}` }, { text: `v${b}` }],
} as never;
const bookNames = new Map([[43, 'John']]);

describe('hasRemoteConsent', () => {
  it('accepts only the current notice version', () => {
    expect(hasRemoteConsent(String(RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION))).toBe(true);
    expect(hasRemoteConsent('0')).toBe(false);
    expect(hasRemoteConsent(undefined)).toBe(false);
    expect(hasRemoteConsent('')).toBe(false);
  });
});

describe('RemoteSemanticService', () => {
  it('hydrates hits in the given translation and marks the source remote', async () => {
    const f = fakeFetch({
      query: 'love', mode: 'semantic', degraded: false,
      results: [
        { rank: 1, id: 'KJV.JHN.3.16', score: 0.81234 },
        { rank: 2, id: 'KJV.JHN.3.16-17', score: 0.7 },
      ],
    }, { headers: { 'RateLimit-Remaining': '9' } });
    const res = await makeService(f).search('love of god', 10, { repo, module: 'WEB', bookNames });
    expect(res.total).toBe(2);
    expect(res.results[0]).toMatchObject({ verseId: JHN_3_16, endVerseId: JHN_3_16, text: `verse ${JHN_3_16}`, module: 'WEB', type: 'verse', score: 0.812 });
    expect(res.results[1]).toMatchObject({ verseId: JHN_3_16, endVerseId: JHN_3_17, type: 'paragraph', text: `v${JHN_3_16} v${JHN_3_17}` });
    expect(res.results[0].reference).toContain('John');
    expect(res.semantic.source).toBe('remote');
    expect(res.semantic.notice).toBeUndefined();
    expect(res.semantic.rateLimit?.remaining).toBe(9);
  });

  it('flags degraded responses', async () => {
    const f = fakeFetch({ query: 'q', mode: 'keyword', degraded: true, results: [] });
    const res = await makeService(f).search('some words', 5, { repo, module: 'KJV', bookNames });
    expect(res.semantic.notice).toEqual({ kind: 'degraded' });
  });

  it('truncates the snippet to 200 characters', async () => {
    const long = { getVerse: () => ({ text: 'x'.repeat(300) }), getVerseRange: () => [] } as never;
    const f = fakeFetch({ results: [{ rank: 1, id: 'KJV.JHN.3.16', score: 0.5 }] });
    const res = await makeService(f).search('some words', 5, { repo: long, module: 'KJV', bookNames });
    expect(res.results[0].snippet).toHaveLength(203);
  });

  it('sends only the query and the configured API key', async () => {
    const f = fakeFetch({ results: [] });
    await makeService(f).search('some words', 5, { repo, module: 'KJV', bookNames });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('http://bibsearch.internal/v1/search');
    expect(url).toContain('include_text=false');
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe('k1');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-forwarded-for')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
    expect(init.credentials).toBe('omit');
  });

  it('throws RemoteSemanticError on service errors', async () => {
    const f = fakeFetch({ error: { code: 'quota_exceeded', message: 'x' } }, { status: 429, headers: { 'Retry-After': '3600' } });
    await expect(makeService(f).search('some words', 5, { repo, module: 'KJV', bookNames }))
      .rejects.toBeInstanceOf(RemoteSemantic.RemoteSemanticError);
  });
});
