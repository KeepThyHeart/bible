import { describe, it, expect, vi } from 'vitest';
import {
  parseBibsearchId, checkRemoteQuery, RemoteSemanticClient, RemoteSemanticError,
  runSemanticChain, noteForRemoteError, consentStatus, makeConsentRecord, parseConsentRecord,
  REMOTE_SEMANTIC_NOTICE_VERSION,
} from './index';

describe('parseBibsearchId', () => {
  it('maps a single verse', () => {
    expect(parseBibsearchId('KJV.JHN.3.16')).toEqual({ id: 'KJV.JHN.3.16', translation: 'KJV', startVerseId: 43003016, endVerseId: 43003016 });
  });
  it('maps a window', () => {
    const p = parseBibsearchId('KJV.JHN.3.16-17')!;
    expect([p.startVerseId, p.endVerseId]).toEqual([43003016, 43003017]);
  });
  it('maps a window across chapters', () => {
    const p = parseBibsearchId('KJV.GEN.1.31-2.3')!;
    expect([p.startVerseId, p.endVerseId]).toEqual([1001031, 1002003]);
  });
  it('maps first and last books', () => {
    expect(parseBibsearchId('KJV.GEN.1.1')!.startVerseId).toBe(1001001);
    expect(parseBibsearchId('KJV.REV.22.21')!.startVerseId).toBe(66022021);
    expect(parseBibsearchId('KJV.1CO.13.4')!.startVerseId).toBe(46013004);
  });
  it.each(['', 'KJV.XXX.1.1', 'KJV.JHN.3', 'KJV.JHN.0.1', 'KJV.JHN.3.17-16', 'JHN.3.16', 'KJV.JHN.3.x', 'KJV.JHN.3.16-', null, 42])('rejects %s', (id) => {
    expect(parseBibsearchId(id as any)).toBeNull();
  });
});

describe('checkRemoteQuery', () => {
  it.each(['', '   ', 'a', '12345', '!!!???', 'aaaa', 'go go go', '3:16'])('refuses %j', (q) => {
    expect(checkRemoteQuery(q).ok).toBe(false);
  });
  it('accepts real queries and trims / caps them', () => {
    expect(checkRemoteQuery('  forgiving   others ')).toEqual({ ok: true, query: 'forgiving others' });
    const long = checkRemoteQuery('word '.repeat(300) + 'x');
    expect(long.ok && long.query.length).toBeLessThanOrEqual(512);
    expect(checkRemoteQuery('grace').ok).toBe(true);
    expect(checkRemoteQuery('John 3:16').ok).toBe(true);
  });
});

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
const OK = { query: 'q', mode: 'semantic', degraded: false, results: [
  { rank: 1, id: 'KJV.MAT.6.14', score: 0.8, ref: 'Matthew 6:14' },
  { rank: 2, id: 'bogus', score: 0.5 },
  { rank: 3, id: 'KJV.JHN.3.16-17', score: 0.4 },
] };
const err = (code: string, extra: object = {}) => ({ error: { code, message: code, ...extra } });

function make(responses: Array<Response | Error>, extra: Partial<ConstructorParameters<typeof RemoteSemanticClient>[0]> = {}) {
  let t = 1_000_000;
  const fetchMock = vi.fn(async (_u: any, _i?: any) => {
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    if (r instanceof Error) throw r;
    return r;
  });
  const sleeps: number[] = [];
  const client = new RemoteSemanticClient({
    baseUrl: 'https://search.test/', fetch: fetchMock as any, now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, ...extra,
  });
  return { client, fetchMock, sleeps, advance: (ms: number) => { t += ms; }, now: () => t };
}
const kind = async (p: Promise<unknown>) => p.then(() => 'ok', (e: RemoteSemanticError) => e.kind);

describe('RemoteSemanticClient', () => {
  it('sends include_text=false, no auth or cookies by default, maps and hydrates ids', async () => {
    const { client, fetchMock } = make([res(200, OK, { 'RateLimit-Limit': '50', 'RateLimit-Remaining': '12', 'RateLimit-Reset': '3600' })]);
    const r = await client.search('forgiving those who wrong you', { k: 5 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('https://search.test/v1/search?');
    expect(String(url)).toContain('include_text=false');
    expect(String(url)).toContain('k=5');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['X-API-Key']).toBeUndefined();
    expect(init.credentials).toBe('omit');
    expect(r.hits.map(h => h.id)).toEqual(['KJV.MAT.6.14', 'KJV.JHN.3.16-17']);
    expect(r.hits[0].startVerseId).toBe(40006014);
    expect(r.skipped).toBe(1);
    expect(r.rateLimit.remaining).toBe(12);
    expect(r.rateLimit.limit).toBe(50);
    expect(r.rateLimit.resetAtMs).toBe(1_000_000 + 3_600_000);
  });

  it('sends the configured API key as X-API-Key only', async () => {
    const { client, fetchMock } = make([res(200, OK)], { apiKey: 'pub-key' });
    await client.search('grace and truth');
    expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('pub-key');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('uses POST for very long queries', async () => {
    const { client, fetchMock } = make([res(200, OK)]);
    await client.search('misericórdia '.repeat(40));
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).include_text).toBe(false);
  });

  it('never sends garbage queries', async () => {
    const { client, fetchMock } = make([]);
    for (const q of ['', 'x', '123', '???']) expect(await kind(client.search(q))).toBe('invalid_query');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports degraded and routed', async () => {
    const { client } = make([res(200, { ...OK, degraded: true, mode: 'keyword' }), res(200, { ...OK, mode: 'keyword', routed: 'one_word' })]);
    const a = await client.search('forgive');
    expect([a.degraded, a.mode]).toEqual([true, 'keyword']);
    expect((await client.search('forgive')).routed).toBe('one_word');
  });

  it.each([
    [400, 'invalid_request', 'bad_request'],
    [401, 'auth_required', 'auth_required'],
    [401, 'unauthorized', 'unauthorized'],
    [422, 'query_rejected', 'rejected'],
    [500, 'internal', 'internal'],
    [503, 'not_ready', 'not_ready'],
  ])('%i %s: no retry, kind %s', async (status, code, expected) => {
    const { client, fetchMock } = make([res(status, err(code, { rule: 'not_text' })), res(200, OK)]);
    expect(await kind(client.search('mercy'))).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes the 422 rule and the request id', async () => {
    const { client } = make([res(422, err('query_rejected', { rule: 'repeated' })), res(500, err('internal'), { 'X-Request-Id': 'abc' })]);
    const e1 = await client.search('mercy').catch(e => e);
    expect(e1.rule).toBe('repeated');
    const e2 = await client.search('mercy').catch(e => e);
    expect(e2.details.requestId).toBe('abc');
  });

  it('retries 429 rate_limited once after Retry-After', async () => {
    const { client, fetchMock, sleeps } = make([res(429, err('rate_limited'), { 'Retry-After': '2' }), res(200, OK)]);
    expect((await client.search('mercy')).hits.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after one retry and then pauses on rate_limited', async () => {
    const { client, fetchMock } = make([res(429, err('rate_limited'), { 'Retry-After': '2' }), res(429, err('rate_limited'), { 'Retry-After': '30' }), res(200, OK)]);
    expect(await kind(client.search('mercy'))).toBe('rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.blockedUntil).toBeGreaterThan(0);
    expect(await kind(client.search('mercy'))).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not wait a long Retry-After; blocks instead', async () => {
    const { client, fetchMock, sleeps } = make([res(429, err('rate_limited'), { 'Retry-After': '120' })]);
    expect(await kind(client.search('mercy'))).toBe('rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(await kind(client.search('mercy'))).toBe('blocked');
  });

  it.each([502, 504])('retries %i once, then falls back', async (status) => {
    const code = status === 502 ? 'embedder_error' : 'embedder_timeout';
    const { client, fetchMock } = make([res(status, err(code)), res(status, err(code)), res(200, OK)]);
    expect(await kind(client.search('mercy'))).toBe('embedder_error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('502 then success recovers', async () => {
    const { client } = make([res(502, err('embedder_error')), res(200, OK)]);
    expect((await client.search('mercy')).hits.length).toBe(2);
  });

  it('treats network failure like 502 (one retry)', async () => {
    const { client, fetchMock } = make([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    expect(await kind(client.search('mercy'))).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out after the configured timeout', async () => {
    const fetchMock = vi.fn((_u: any, init: any) => new Promise((_r, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const client = new RemoteSemanticClient({ baseUrl: 'https://x', fetch: fetchMock as any, timeoutMs: 20, sleep: async () => {} });
    expect(await kind(client.search('mercy'))).toBe('timeout');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('quota_exceeded: no retry, blocked until the reset, then tried again', async () => {
    const { client, fetchMock, advance } = make([
      res(429, err('quota_exceeded'), { 'RateLimit-Reset': '600', 'Retry-After': '600' }),
      res(200, OK),
    ]);
    const e = await client.search('mercy').catch(e => e);
    expect(e.kind).toBe('quota_exceeded');
    expect(e.resetAtMs).toBe(1_000_000 + 600_000);
    expect(noteForRemoteError(e)).toEqual({ kind: 'quota', resetAtMs: 1_600_000 });
    expect(await kind(client.search('mercy'))).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(601_000);
    expect((await client.search('mercy')).hits.length).toBe(2);
  });

  it('503 budget_exhausted blocks for Retry-After', async () => {
    const { client, fetchMock, advance } = make([res(503, err('budget_exhausted'), { 'Retry-After': '120' }), res(200, OK)]);
    expect(await kind(client.search('mercy'))).toBe('budget_exhausted');
    expect(await kind(client.search('mercy'))).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(121_000);
    expect(await kind(client.search('mercy'))).toBe('ok');
  });

  it.each(['forbidden', 'banned'])('403 %s blocks and is never retried', async (code) => {
    const { client, fetchMock } = make([res(403, err(code), { 'Retry-After': '900' }), res(200, OK)]);
    expect(await kind(client.search('mercy'))).toBe('forbidden');
    expect(await kind(client.search('mercy'))).toBe('blocked');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes a token once on 401 unauthorized, then retries once', async () => {
    const refresh = vi.fn(async () => {});
    const { client, fetchMock } = make([res(401, err('unauthorized')), res(200, OK)], {
      auth: { getHeaders: () => ({ Authorization: 'Bearer t' }), refresh },
    });
    expect((await client.search('mercy')).hits.length).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer t');
  });

  it('info() reads /v1/info', async () => {
    const { client, fetchMock } = make([res(200, { model: 'm', dims: 768, row_count: 10, modes: ['semantic'] })]);
    const info = await client.info();
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://search.test/v1/info');
    expect([info.model, info.dims, info.rows]).toEqual(['m', 768, 10]);
  });
});

describe('runSemanticChain', () => {
  const fb = (name: string, v: string | null) => ({ name, run: vi.fn(async () => v) });
  it('does not call remote without consent', async () => {
    for (const consent of ['unset', 'declined'] as const) {
      const remote = vi.fn(async () => 'remote');
      const out = await runSemanticChain({ consent, remote, fallbacks: [fb('local', 'L')] });
      expect(remote).not.toHaveBeenCalled();
      expect(out).toMatchObject({ result: 'L', source: 'local', skipped: consent === 'unset' ? 'no-consent' : 'declined' });
    }
  });
  it('uses remote when consented', async () => {
    const local = fb('local', 'L');
    const out = await runSemanticChain({ consent: 'granted', remote: async () => 'R', fallbacks: [local] });
    expect(out).toEqual({ result: 'R', source: 'remote' });
    expect(local.run).not.toHaveBeenCalled();
  });
  it('falls back through the list on remote errors and empty providers', async () => {
    const out = await runSemanticChain({
      consent: 'granted',
      remote: async () => { throw new RemoteSemanticError('quota_exceeded', 429, 'quota_exceeded', undefined, { resetAtMs: 5 }); },
      fallbacks: [fb('local', null), { name: 'broken', run: async () => { throw new Error('x'); } }, fb('keyword', 'K')],
    });
    expect(out.source).toBe('keyword');
    expect(out.skipped).toBe('remote-error');
    expect(noteForRemoteError(out.remoteError)).toEqual({ kind: 'quota', resetAtMs: 5 });
  });
  it('is not-configured without a remote', async () => {
    const out = await runSemanticChain({ consent: 'granted', fallbacks: [fb('keyword', 'K')] });
    expect(out.skipped).toBe('not-configured');
  });
});

describe('consent record', () => {
  it('is unset with no record or an outdated notice version', () => {
    expect(consentStatus(null)).toBe('unset');
    expect(consentStatus(makeConsentRecord('granted', new Date(), REMOTE_SEMANTIC_NOTICE_VERSION - 1))).toBe('unset');
  });
  it('reads granted and declined for the current version', () => {
    expect(consentStatus(makeConsentRecord('granted'))).toBe('granted');
    expect(consentStatus(makeConsentRecord('declined'))).toBe('declined');
  });
  it('round-trips and rejects junk', () => {
    const r = makeConsentRecord('granted');
    expect(parseConsentRecord(JSON.stringify(r))).toEqual(r);
    expect(parseConsentRecord('nope')).toBeNull();
    expect(parseConsentRecord({ decision: 'maybe', version: 1 })).toBeNull();
    expect(parseConsentRecord(null)).toBeNull();
  });
});
