/** GatewayTransport (task 0090): fake gateway with an EventEmitter response. */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type { ClientRequest, IncomingMessage } from 'electron';
import { AssetError } from '@bible/core/browser';
import { GatewayTransport } from '../assets/GatewayTransport';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';
import { NetworkBlockedError } from '../NetworkGateway';

interface Rig {
  response: EventEmitter;
  request: { abortCalls: number; abort(): void };
  gateway: FakeNetworkGateway;
}

function rig(status = 200, headers: Record<string, string | string[]> = {}): Rig {
  const response = new EventEmitter();
  const request = { abortCalls: 0, abort(): void { this.abortCalls++; } };
  const gateway = new FakeNetworkGateway();
  gateway.downloadStreamImpl = async () => ({
    status,
    headers,
    url: '',
    response: response as unknown as IncomingMessage,
    request: request as unknown as ClientRequest,
  });
  return { response, request, gateway };
}

const buf = (...n: number[]): Buffer => Buffer.from(n);

describe('GatewayTransport.get', () => {
  it('yields chunks in order, sends Range + If-Range, and maps headers', async () => {
    const r = rig(206, { 'content-range': 'bytes 10-19/20', etag: '"e"', 'content-length': '10', 'content-type': 'x/y' });
    const t = new GatewayTransport(r.gateway);
    const res = await t.get({ url: 'https://h/f', rangeStart: 10, ifRange: '"e"', signal: new AbortController().signal });
    expect(r.gateway.downloadCalls[0].headers).toEqual({ Range: 'bytes=10-', 'If-Range': '"e"' });
    expect(res.status).toBe(206);
    expect(res.headers).toEqual({ contentLength: 10, contentRange: 'bytes 10-19/20', etag: '"e"', contentType: 'x/y' });
    // Listeners attach synchronously in get(); emit before anyone iterates.
    r.response.emit('data', buf(1, 2));
    r.response.emit('data', buf(3));
    const out: number[] = [];
    const it = res.body[Symbol.asyncIterator]();
    setImmediate(() => { r.response.emit('data', buf(4)); r.response.emit('end'); });
    for (let n = await it.next(); !n.done; n = await it.next()) out.push(...n.value);
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it('a response error rejects the pending next() as a retryable network error', async () => {
    const r = rig();
    const res = await new GatewayTransport(r.gateway).get({ url: 'https://h/f', signal: new AbortController().signal });
    const it = res.body[Symbol.asyncIterator]();
    const pending = it.next();
    r.response.emit('error', new Error('reset'));
    await expect(pending).rejects.toMatchObject({ code: 'network', retryable: true });
  });

  it('NetworkBlockedError becomes offline', async () => {
    const r = rig();
    r.gateway.offline = true;
    await expect(new GatewayTransport(r.gateway).get({ url: 'https://h/f', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'offline' });
    expect(NetworkBlockedError).toBeDefined();
  });

  it('other gateway failures become retryable network errors', async () => {
    const r = rig();
    r.gateway.downloadStreamImpl = () => Promise.reject(new Error('ECONNRESET'));
    await expect(new GatewayTransport(r.gateway).get({ url: 'https://h/f', signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'network', retryable: true });
  });

  it('abort rejects the pending next() with aborted and calls request.abort()', async () => {
    const r = rig();
    const ac = new AbortController();
    const res = await new GatewayTransport(r.gateway).get({ url: 'https://h/f', signal: ac.signal });
    const it = res.body[Symbol.asyncIterator]();
    const pending = it.next();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(r.request.abortCalls).toBeGreaterThanOrEqual(1);
  });

  it('an already-aborted signal throws before any request', async () => {
    const r = rig();
    const ac = new AbortController();
    ac.abort();
    await expect(new GatewayTransport(r.gateway).get({ url: 'https://h/f', signal: ac.signal })).rejects.toBeInstanceOf(AssetError);
    expect(r.gateway.downloadCalls).toHaveLength(0);
  });

  it('non-2xx statuses are returned with an empty body and the request dropped', async () => {
    const r = rig(404);
    const res = await new GatewayTransport(r.gateway).get({ url: 'https://h/f', signal: new AbortController().signal });
    expect(res.status).toBe(404);
    expect((await res.body[Symbol.asyncIterator]().next()).done).toBe(true);
    expect(r.request.abortCalls).toBe(1);
  });
});

describe('GatewayTransport.getText', () => {
  it('returns the text, null on 404, throws http otherwise', async () => {
    const gateway = new FakeNetworkGateway();
    const t = new GatewayTransport(gateway);
    const ac = new AbortController();
    gateway.fetchBufferedImpl = async () => fetchResult(200, 'abc  file\n');
    expect(await t.getText('https://h/x.sha256', ac.signal)).toBe('abc  file\n');
    expect(gateway.fetchCalls[0]).toMatchObject({ maxResponseBytes: 2 * 1024 * 1024, timeoutMs: 30000 });
    gateway.fetchBufferedImpl = async () => fetchResult(404);
    expect(await t.getText('https://h/x.sha256', ac.signal)).toBeNull();
    gateway.fetchBufferedImpl = async () => fetchResult(503);
    await expect(t.getText('https://h/x', ac.signal)).rejects.toMatchObject({ code: 'http', retryable: true });
  });

  it('offline and abort map to asset errors', async () => {
    const gateway = new FakeNetworkGateway();
    const t = new GatewayTransport(gateway);
    gateway.offline = true;
    await expect(t.getText('https://h/x', new AbortController().signal)).rejects.toMatchObject({ code: 'offline' });
    const ac = new AbortController();
    ac.abort();
    await expect(t.getText('https://h/x', ac.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
});
