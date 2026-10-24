// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RemoteSemantic } from '@bible/core';
import {
  RemoteSemanticService,
  JsonFileConsentStore,
  gatewayFetch,
  type ConsentStore,
} from '../RemoteSemanticService';
import type { INetworkGateway } from '../NetworkGateway';

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function memStore(initial?: unknown): ConsentStore & { value: unknown } {
  const s = { value: initial, read: () => s.value, write: (r: unknown) => { s.value = r ?? undefined; } };
  return s as ConsentStore & { value: unknown };
}

const okBody = {
  query: 'q', mode: 'hybrid', degraded: false,
  results: [{ rank: 1, id: 'KJV.JHN.3.16', score: 0.9 }],
};
function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function make(opts: { url?: string; store?: ConsentStore; fetch?: ReturnType<typeof vi.fn>; offline?: boolean } = {}) {
  const fetchMock = opts.fetch ?? vi.fn(async () => jsonRes(okBody));
  const service = new RemoteSemanticService({
    url: opts.url ?? 'https://search.example.org',
    apiKey: 'key-1',
    store: opts.store ?? memStore(),
    fetch: fetchMock as unknown as typeof fetch,
    getGateway: () => ({ isOffline: () => opts.offline ?? false }) as unknown as INetworkGateway,
  });
  return { service, fetchMock };
}

describe('RemoteSemanticService consent', () => {
  it('starts unset, persists granted/declined, and reset clears it', () => {
    const store = memStore();
    const { service } = make({ store });
    expect(service.getStatus()).toMatchObject({ configured: true, consent: 'unset', noticeVersion: RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION });
    expect(service.getStatus().consentedAt).toBeUndefined();
    expect(service.setConsent('granted').consent).toBe('granted');
    expect(service.getStatus().consentedAt).toBeTruthy();
    // a fresh service over the same store sees it
    expect(make({ store }).service.getStatus().consent).toBe('granted');
    expect(service.setConsent('declined').consent).toBe('declined');
    expect(service.setConsent('reset').consent).toBe('unset');
    expect(store.value).toBeUndefined();
  });

  it('an older notice version counts as unset', () => {
    const store = memStore(RemoteSemantic.makeConsentRecord('granted', new Date(), RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION - 1));
    expect(make({ store }).service.getStatus().consent).toBe('unset');
  });

  it('persists to a JSON file under the key remoteSemantic.consent', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rs-')), 'sub', 'remote-semantic.json');
    const a = new RemoteSemanticService({ url: 'https://x.example', apiKey: '', store: new JsonFileConsentStore(file) });
    expect(a.getStatus().consent).toBe('unset');
    a.setConsent('granted');
    const b = new RemoteSemanticService({ url: 'https://x.example', apiKey: '', store: new JsonFileConsentStore(file) });
    expect(b.getStatus().consent).toBe('granted');
    b.setConsent('reset');
    expect(a.getStatus().consent).toBe('unset');
  });

  it('is not configured without a url', () => {
    const { service } = make({ url: '' });
    expect(service.isConfigured()).toBe(false);
    expect(service.getStatus().configured).toBe(false);
  });
});

describe('RemoteSemanticService.search', () => {
  it('never calls fetch without consent (unset or declined) or without config', async () => {
    for (const c of [undefined, 'declined'] as const) {
      const store = memStore(c ? RemoteSemantic.makeConsentRecord(c) : undefined);
      const { service, fetchMock } = make({ store });
      await expect(service.search('love your enemies')).rejects.toBeInstanceOf(RemoteSemantic.RemoteSemanticError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
    const { service, fetchMock } = make({ url: '', store: memStore(RemoteSemantic.makeConsentRecord('granted')) });
    await expect(service.search('love your enemies')).rejects.toBeInstanceOf(RemoteSemantic.RemoteSemanticError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with consent sends include_text=false and the X-API-Key header only', async () => {
    const { service, fetchMock } = make({ store: memStore(RemoteSemantic.makeConsentRecord('granted')) });
    const res = await service.search('love your enemies', { maxResults: 500 });
    expect(res.hits[0]!.id).toBe('KJV.JHN.3.16');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url.startsWith('https://search.example.org/v1/search?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('include_text')).toBe('false');
    expect(params.get('k')).toBe('50');
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe('key-1');
    expect(headers.get('authorization')).toBeNull();
    expect(headers.has('cookie')).toBe(false);
    expect(init.credentials).toBe('omit');
  });

  it('a switched-off network is a network error without any fetch', async () => {
    const { service, fetchMock } = make({ store: memStore(RemoteSemantic.makeConsentRecord('granted')), offline: true });
    await expect(service.search('love your enemies')).rejects.toMatchObject({ kind: 'network' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('gatewayFetch', () => {
  it('maps fetchBuffered to a Response and sends no redirects/body for GET', async () => {
    const fetchBuffered = vi.fn(async () => ({
      status: 429,
      headers: { 'retry-after': '30', 'x-multi': ['a', 'b'] },
      url: 'https://x.example/v1/search',
      body: Buffer.from(JSON.stringify({ error: { code: 'quota_exceeded' } })),
    }));
    const f = gatewayFetch(() => ({ fetchBuffered }) as unknown as INetworkGateway);
    const res = await f('https://x.example/v1/search?query=a', { headers: { 'X-API-Key': 'k' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('x-multi')).toBe('a, b');
    expect(await res.json()).toEqual({ error: { code: 'quota_exceeded' } });
    expect(fetchBuffered).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET', maxRedirects: 0, headers: { 'x-api-key': 'k' }, context: 'remote semantic search',
    }));
  });
});
