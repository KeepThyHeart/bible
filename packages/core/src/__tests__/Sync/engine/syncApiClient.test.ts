/** SyncApiClient (contracts 0063 §7/§8, task 0150 W3-A) against a fake fetch. */
import { describe, it, expect, vi } from 'vitest';
import { b64urlEncode } from '../../../Crypto';
import { SyncApiClient } from '../../../Sync/engine/SyncApiClient';
import { SyncHttpError, SyncNetworkError, SyncResponseError } from '../../../Sync/engine/ISyncTransport';

const ID = 'ab'.repeat(16);
const KDF = { id: 'argon2id', v: 19, m: 19456, t: 2, p: 1, salt: 'c2FsdA' };
const SESSION = { accountId: ID, emailVerified: true, wrappedAk: 'w1', wrappedRecordIdKey: 'w2', keysets: [{ epoch: 1, wrappedDataKey: 'w3' }], currentEpoch: 1 };
const ACCOUNT = { email: 'a@b.c', emailVerified: true, bytesUsed: 10, quotaBytes: 100, createdAt: '2026-01-01', recordCount: 1 };
const DEVICE = { id: '0123456789abcdef', nameSealed: 'n', createdAt: 'c', lastSeenAt: 'l', userAgent: null, current: true };

interface Call { url: string; init: RequestInit }

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = (): Response => new Response(null, { status: 204 });

function client(respond: Parameters<typeof fakeFetch>[0], auth: 'cookie' | 'bearer' = 'cookie', onUnauthorized?: () => void) {
  const f = fakeFetch(respond);
  const c = new SyncApiClient({
    baseUrl: 'https://sync.example/',
    auth: auth === 'cookie' ? { kind: 'cookie' } : { kind: 'bearer', token: async () => 'tok123' },
    fetch: f.fetch, onUnauthorized,
  });
  return { c, calls: f.calls };
}

describe('SyncApiClient routes', () => {
  it('uses the right method, path and body for every route', async () => {
    const routes: Record<string, unknown> = {
      'GET /info': { apiVersion: 1, signupOpen: true, quotaBytes: 1, minKdf: { m: 1, t: 1 }, minAge: 13 },
      'POST /prelogin': { kdf: KDF },
      'POST /signup': SESSION, 'POST /login': SESSION, 'POST /recover': SESSION, 'POST /reset/confirm': SESSION,
      'GET /account': ACCOUNT,
      'GET /devices': { devices: [DEVICE] },
      'GET /export': { format: 'kth-sync-export', version: 1, account: { ...ACCOUNT, accountId: ID, kdf: KDF }, devices: [DEVICE], keysets: [], records: [] },
    };
    const { c, calls } = client((url, init) => {
      const key = `${init.method} ${url.replace('https://sync.example/api/sync/v1', '').replace(/\?.*$/, '')}`;
      return key in routes ? json(routes[key]) : empty();
    });
    const dev = { id: '0123456789abcdef', nameSealed: 'x' };
    await c.info();
    await c.prelogin({ email: 'a@b.c' });
    await c.signup({ email: 'a@b.c', accountId: ID, material: {} as never, device: dev, consent: { terms: true, ageConfirmed: true } });
    await c.login({ email: 'a@b.c', authKey: 'k', device: dev });
    await c.recover({ email: 'a@b.c', recoveryAuthKey: 'k', device: dev });
    await c.logout();
    await c.verifyEmail({ token: 't' });
    await c.resendVerification({ email: 'a@b.c' });
    await c.reset({ email: 'a@b.c' });
    await c.resetConfirm({ token: 't', accountId: ID, material: {} as never, device: dev });
    await c.account();
    await c.keys({ kind: 'recovery', currentAuthKey: 'a', recoveryAuthKey: 'b', wrappedAkRecovery: 'c' });
    await c.devices();
    await c.setDeviceName({ nameSealed: 'sealed' });
    await c.revokeDevice('0123456789abcdef');
    await c.exportAll();
    await c.deleteAccount({ authKey: 'k' });
    expect(calls.map((x) => `${x.init.method} ${x.url}`)).toEqual([
      'GET /info', 'POST /prelogin', 'POST /signup', 'POST /login', 'POST /recover', 'POST /logout', 'POST /verify-email',
      'POST /resend-verification', 'POST /reset', 'POST /reset/confirm', 'GET /account', 'PUT /keys', 'GET /devices',
      'PUT /devices/current', 'DELETE /devices/0123456789abcdef', 'GET /export', 'DELETE /account',
    ].map((s) => s.replace(' /', ' https://sync.example/api/sync/v1/')));
    const body = (i: number) => JSON.parse(String(calls[i].init.body));
    expect(body(1)).toEqual({ email: 'a@b.c' });
    expect(body(13)).toEqual({ nameSealed: 'sealed' });
    expect(calls[0].init.body).toBeUndefined();
    expect((calls[1].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('cookie auth sends credentials: include and no Authorization; bearer sends the token and omits cookies', async () => {
    const cookie = client(() => json({ kdf: KDF }));
    await cookie.c.prelogin({ email: 'x' });
    expect(cookie.calls[0].init.credentials).toBe('include');
    expect((cookie.calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();

    const bearer = client(() => json({ kdf: KDF }), 'bearer');
    await bearer.c.prelogin({ email: 'x' });
    expect(bearer.calls[0].init.credentials).toBe('omit');
    expect((bearer.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });

  it('rejects a malformed device id before any request', async () => {
    const { c, calls } = client(() => empty());
    await expect(c.revokeDevice('../account')).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });
});

describe('SyncApiClient errors', () => {
  it('maps non-2xx to SyncHttpError with the parsed ApiError; 401 calls onUnauthorized', async () => {
    const onUnauthorized = vi.fn();
    const { c } = client(() => json({ error: 'unauthorized', message: 'Sign in again' }, 401), 'cookie', onUnauthorized);
    const e = await c.account().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SyncHttpError);
    expect(e).toMatchObject({ status: 401, body: { error: 'unauthorized', message: 'Sign in again' } });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    const q = client(() => json({ error: 'quota_exceeded', retryAfterSec: 5, extra: 'x' }, 413));
    await expect(q.c.transport().push([])).rejects.toMatchObject({ status: 413, body: { error: 'quota_exceeded', retryAfterSec: 5 } });
  });

  it('a non-ApiError body gives body null; messages never contain the request body', async () => {
    const { c } = client(() => new Response('<html>oops</html>', { status: 500 }));
    const e = await c.login({ email: 'me@x', authKey: 'SECRET-AUTH-KEY', device: { id: '0123456789abcdef', nameSealed: 'n' } })
      .catch((x: unknown) => x) as SyncHttpError;
    expect(e).toBeInstanceOf(SyncHttpError);
    expect(e.body).toBeNull();
    expect(e.message).toBe('HTTP 500');
    expect(String(e.message) + String(e.stack)).not.toContain('SECRET-AUTH-KEY');

    const unknownCode = client(() => json({ error: 'teapot' }, 418));
    await expect(unknownCode.c.info()).rejects.toMatchObject({ status: 418, body: null });
  });

  it('a request without an answer is a SyncNetworkError; an abort rethrows the abort reason', async () => {
    const { c } = client(() => { throw new TypeError('fetch failed: secret.example'); });
    const e = await c.info().catch((x: unknown) => x) as Error;
    expect(e).toBeInstanceOf(SyncNetworkError);
    expect(e.message).not.toContain('secret');

    const ctl = new AbortController();
    const reason = new Error('stopped');
    const aborting = client(() => { ctl.abort(reason); throw new DOMException('aborted', 'AbortError'); });
    await expect(aborting.c.transport().pull(0, 10, ctl.signal)).rejects.toBe(reason);
  });

  it('rejects malformed 2xx responses with SyncResponseError', async () => {
    const cases: Array<[string, unknown]> = [
      ['not json', '{'],
      ['records not an array', { records: 'x', next: 0, more: false }],
      ['bad record id', { records: [{ id: 'nope', seq: 1, deleted: false, blob: 'AA' }], next: 1, more: false }],
      ['live record without blob', { records: [{ id: ID, seq: 1, deleted: false, blob: null }], next: 1, more: false }],
      ['tombstone with blob', { records: [{ id: ID, seq: 1, deleted: true, blob: 'AA' }], next: 1, more: false }],
      ['negative seq', { records: [{ id: ID, seq: -1, deleted: true, blob: null }], next: 1, more: false }],
      ['bad b64url', { records: [{ id: ID, seq: 1, deleted: false, blob: '***' }], next: 1, more: false }],
      ['missing more', { records: [], next: 0 }],
    ];
    for (const [what, body] of cases) {
      const { c } = client(() => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 }));
      await expect(c.transport().pull(0, 10), what).rejects.toBeInstanceOf(SyncResponseError);
    }
    const s = client(() => json({ ...SESSION, accountId: 'XYZ' }));
    await expect(s.c.login({ email: 'a', authKey: 'k', device: { id: '0123456789abcdef', nameSealed: 'n' } })).rejects.toBeInstanceOf(SyncResponseError);
    const p = client(() => json({ accepted: [], conflicts: [{ id: ID, current: { id: 'cd'.repeat(16), seq: 1, deleted: true, blob: null } }] }));
    await expect(p.c.transport().push([])).rejects.toBeInstanceOf(SyncResponseError);
  });
});

describe('SyncApiClient transport', () => {
  it('pull sends since/limit and converts b64url blobs to bytes', async () => {
    const blob = Uint8Array.from([1, 2, 3, 250, 251]);
    const { c, calls } = client(() => json({
      records: [{ id: ID, seq: 4, deleted: false, blob: b64urlEncode(blob) }, { id: 'cd'.repeat(16), seq: 5, deleted: true, blob: null }],
      next: 5, more: true,
    }));
    const r = await c.transport().pull(3, 500);
    expect(calls[0].url).toBe('https://sync.example/api/sync/v1/changes?since=3&limit=500');
    expect(calls[0].init.method).toBe('GET');
    expect(r.next).toBe(5);
    expect(r.more).toBe(true);
    expect(r.records[0].blob).toEqual(blob);
    expect(r.records[1]).toEqual({ id: 'cd'.repeat(16), seq: 5, deleted: true, blob: null });
  });

  it('push posts the records and converts conflict blobs', async () => {
    const cur = Uint8Array.from([9, 8, 7]);
    const { c, calls } = client(() => json({
      accepted: [{ id: ID, seq: 7 }], conflicts: [{ id: 'cd'.repeat(16), current: { id: 'cd'.repeat(16), seq: 6, deleted: false, blob: b64urlEncode(cur) } }],
    }));
    const recs = [{ id: ID, baseSeq: null, deleted: false, blob: 'AQID' }];
    const r = await c.transport().push(recs);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].url).toBe('https://sync.example/api/sync/v1/push');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ records: recs });
    expect(r.accepted).toEqual([{ id: ID, seq: 7 }]);
    expect(r.conflicts[0].current.blob).toEqual(cur);
  });
});
