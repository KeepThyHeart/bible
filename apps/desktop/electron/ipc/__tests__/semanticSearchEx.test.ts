// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteSemantic } from '@bible/core';

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handlers.set(channel, (...a) => fn({}, ...a)) },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { RemoteSemanticService, __setRemoteSemanticServiceForTests, type ConsentStore } from '../../services/RemoteSemanticService';
import { registerRemoteSemanticHandlers } from '../remoteSemanticHandlers';
import { runSemanticSearchEx, isSemanticOffered, type SemanticRow } from '../semanticSearchEx';
import type { INetworkGateway } from '../../services/NetworkGateway';

type Reply = { ok: boolean; value?: any; error?: { code: string } };
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as Promise<Reply>;

function memStore(initial?: unknown): ConsentStore {
  const s = { v: initial, read: () => s.v, write: (r: unknown) => { s.v = r ?? undefined; } };
  return s as ConsentStore;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const okBody = {
  query: 'q', mode: 'hybrid', degraded: false,
  results: [
    { rank: 1, id: 'KJV.JHN.3.16', score: 0.91234 },
    { rank: 2, id: 'KJV.JHN.3.16-17', score: 0.8 },
    { rank: 3, id: 'KJV.GEN.1.1', score: 0.7 }, // not hydratable in the fake Bible
  ],
};

const localRow: SemanticRow = {
  id: 'local1', level: 'verse', startVerseId: 43003016, endVerseId: 43003016,
  reference: 'John 3:16', text: 't', textPreview: 't', similarity: 0.5,
};

function setup(opts: { consent?: 'granted' | 'declined' | undefined; configured?: boolean; fetch?: ReturnType<typeof vi.fn>; local?: boolean } = {}) {
  const fetchMock = opts.fetch ?? vi.fn(async () => json(okBody, 200, { 'RateLimit-Limit': '100', 'RateLimit-Remaining': '99' }));
  const store = memStore(opts.consent ? RemoteSemantic.makeConsentRecord(opts.consent) : undefined);
  const service = new RemoteSemanticService({
    url: opts.configured === false ? '' : 'https://search.example.org',
    apiKey: 'key-1',
    store,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => {},
    getGateway: () => ({ isOffline: () => false }) as unknown as INetworkGateway,
  });
  const runLocal = vi.fn(async () => [localRow]);
  const hydrate = vi.fn((hits: RemoteSemantic.RemoteHit[]): SemanticRow[] =>
    hits.filter(h => h.startVerseId === 43003016).map(h => ({
      ...localRow, id: h.id, endVerseId: h.endVerseId, similarity: Math.round(h.score * 1000) / 1000,
      level: h.startVerseId === h.endVerseId ? 'verse' : 'paragraph',
    })));
  const deps = { service, localAvailable: () => opts.local ?? true, runLocal, hydrate };
  return { service, fetchMock, runLocal, hydrate, deps, store };
}

describe('runSemanticSearchEx', () => {
  beforeEach(() => handlers.clear());

  it('sends nothing before consent (unset, declined) and answers from the local pack', async () => {
    for (const consent of [undefined, 'declined'] as const) {
      const t = setup({ consent });
      const r = await runSemanticSearchEx(t.deps, 'love your enemies');
      expect(t.fetchMock).not.toHaveBeenCalled();
      expect(r.source).toBe('local');
      expect(r.results).toEqual([localRow]);
      expect(r.notice).toEqual(consent === 'declined' ? { kind: 'declined' } : undefined);
    }
  });

  it('with consent calls the configured url and hydrates the hits', async () => {
    const t = setup({ consent: 'granted' });
    const r = await runSemanticSearchEx(t.deps, 'love your enemies', { maxResults: 12 });
    expect(r.source).toBe('remote');
    expect(t.runLocal).not.toHaveBeenCalled();
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetchMock.mock.calls[0]! as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin).toBe('https://search.example.org');
    expect(u.searchParams.get('include_text')).toBe('false');
    expect(u.searchParams.get('k')).toBe('12');
    expect(new Headers(init.headers).get('x-api-key')).toBe('key-1');
    expect(r.results.map(x => x.id)).toEqual(['KJV.JHN.3.16', 'KJV.JHN.3.16-17']); // the Genesis hit was dropped
    expect(r.results[0]!.similarity).toBe(0.912);
    expect(r.results[1]!.level).toBe('paragraph');
    expect(r.rateLimit).toMatchObject({ limit: 100, remaining: 99 });
    expect(r.notice).toBeUndefined();
  });

  it('a degraded remote answer carries the degraded notice', async () => {
    const t = setup({ consent: 'granted', fetch: vi.fn(async () => json({ ...okBody, degraded: true })) });
    const r = await runSemanticSearchEx(t.deps, 'love your enemies');
    expect(r.source).toBe('remote');
    expect(r.notice).toEqual({ kind: 'degraded' });
  });

  it.each([
    ['429 quota', () => json({ error: { code: 'quota_exceeded', message: 'x' } }, 429, { 'Retry-After': '3600' }), 'quota'],
    ['502', () => json({ error: { code: 'embedder_error', message: 'x' } }, 502), 'unavailable'],
    ['503 budget', () => json({ error: { code: 'budget_exhausted', message: 'x' } }, 503, { 'Retry-After': '600' }), 'paused'],
  ])('remote %s falls back to the local pack with the right notice', async (_n, make, kind) => {
    const t = setup({ consent: 'granted', fetch: vi.fn(async () => make()) });
    const r = await runSemanticSearchEx(t.deps, 'love your enemies');
    expect(r.source).toBe('local');
    expect(r.results).toEqual([localRow]);
    expect(r.notice?.kind).toBe(kind);
  });

  it('a network failure falls back with the unavailable notice', async () => {
    const t = setup({ consent: 'granted', fetch: vi.fn(async () => { throw new TypeError('fetch failed'); }) });
    const r = await runSemanticSearchEx(t.deps, 'love your enemies');
    expect(r).toMatchObject({ source: 'local', notice: { kind: 'unavailable' } });
  });

  it('a garbage query is never sent and maps to the rephrase notice', async () => {
    const t = setup({ consent: 'granted' });
    const r = await runSemanticSearchEx(t.deps, '12345');
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ source: 'local', notice: { kind: 'rephrase' } });
  });

  it('no local pack and a remote failure is the unavailable error', async () => {
    const t = setup({ consent: 'granted', local: false, fetch: vi.fn(async () => json({ error: { code: 'embedder_error' } }, 502)) });
    await expect(runSemanticSearchEx(t.deps, 'love your enemies')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('no local pack and no consent is the unavailable error, still without a fetch', async () => {
    const t = setup({ consent: undefined, local: false });
    await expect(runSemanticSearchEx(t.deps, 'love your enemies')).rejects.toMatchObject({ code: 'unavailable' });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it('not configured: the remote is never called, even with a granted record', async () => {
    const t = setup({ consent: 'granted', configured: false });
    const r = await runSemanticSearchEx(t.deps, 'love your enemies');
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ source: 'local' });
    expect(r.notice).toBeUndefined();
  });
});

describe('isSemanticOffered truth table', () => {
  it.each([
    // local, configured, consent, expected
    [false, false, 'unset', false],
    [false, false, 'granted', false],
    [true, false, 'unset', true],
    [true, false, 'declined', true],
    [false, true, 'unset', true],
    [false, true, 'granted', true],
    [false, true, 'declined', false],
    [true, true, 'declined', true],
  ] as const)('local=%s configured=%s consent=%s -> %s', (local, configured, consent, expected) => {
    expect(isSemanticOffered(local, { configured, consent })).toBe(expected);
  });
});

describe('remoteSemantic IPC handlers', () => {
  beforeEach(() => {
    handlers.clear();
    registerRemoteSemanticHandlers();
  });

  it('getStatus / setConsent persist and the version bump asks again', async () => {
    const store = memStore();
    const mk = () => new RemoteSemanticService({ url: 'https://x.example', apiKey: 'secret', store });
    __setRemoteSemanticServiceForTests(mk());
    expect((await call('remoteSemantic:getStatus')).value).toMatchObject({ configured: true, consent: 'unset' });
    const granted = await call('remoteSemantic:setConsent', 'granted');
    expect(granted.value).toMatchObject({ consent: 'granted' });
    expect(JSON.stringify(granted)).not.toContain('secret');
    expect(JSON.stringify(granted)).not.toContain('x.example');
    expect((await call('remoteSemantic:getStatus')).value.consent).toBe('granted');
    // an older stored version is unset
    store.write(RemoteSemantic.makeConsentRecord('granted', new Date(), RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION - 1));
    expect((await call('remoteSemantic:getStatus')).value.consent).toBe('unset');
    expect((await call('remoteSemantic:setConsent', 'declined')).value.consent).toBe('declined');
    expect((await call('remoteSemantic:setConsent', 'reset')).value.consent).toBe('unset');
  });

  it('rejects bad arguments and an unconfigured build', async () => {
    __setRemoteSemanticServiceForTests(new RemoteSemanticService({ url: 'https://x.example', apiKey: '', store: memStore() }));
    for (const bad of ['yes', '', 1, null, undefined, { decision: 'granted' }]) {
      expect(await call('remoteSemantic:setConsent', bad)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    __setRemoteSemanticServiceForTests(new RemoteSemanticService({ url: '', apiKey: '', store: memStore() }));
    expect((await call('remoteSemantic:getStatus')).value).toMatchObject({ configured: false, consent: 'unset' });
    expect(await call('remoteSemantic:setConsent', 'granted')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
