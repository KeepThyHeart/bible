import { describe, it, expect } from 'vitest';
import { isAssetError } from '@bible/core/browser';
import { FetchTransport } from './FetchTransport';

const sig = () => new AbortController().signal;
const online = () => true;

async function drain(it: AsyncIterable<Uint8Array>): Promise<number> {
  let n = 0;
  for await (const c of it) n += c.length;
  return n;
}
async function code(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; } catch (e) { return isAssetError(e) ? e.code : 'other'; }
  return undefined;
}

describe('FetchTransport', () => {
  it('sends Range and If-Range, maps headers and streams the body', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const t = new FetchTransport(async (url, init) => {
      seen = { url, init };
      return new Response(new Uint8Array(5), {
        status: 206,
        headers: { 'Content-Length': '5', 'Content-Range': 'bytes 10-14/15', ETag: '"e"', 'Last-Modified': 'Mon', 'Content-Type': 'x/y' },
      });
    }, online);
    const r = await t.get({ url: 'https://h/a', rangeStart: 10, ifRange: '"e"', signal: sig() });
    expect(seen!.init!.headers).toEqual({ Range: 'bytes=10-', 'If-Range': '"e"' });
    expect(seen!.init!.cache).toBe('no-store');
    expect(r.status).toBe(206);
    expect(r.headers).toMatchObject({ contentLength: 5, contentRange: 'bytes 10-14/15', etag: '"e"', lastModified: 'Mon', contentType: 'x/y' });
    expect(await drain(r.body)).toBe(5);
  });

  it('ignores content-length when content-encoding is set; returns non-2xx statuses', async () => {
    const t = new FetchTransport(async () => new Response('gz', { status: 404, headers: { 'Content-Length': '99', 'Content-Encoding': 'gzip' } }), online);
    const r = await t.get({ url: 'https://h/a', signal: sig() });
    expect(r.status).toBe(404);
    expect(r.headers.contentLength).toBeUndefined();
  });

  it('maps TypeError to retryable network, offline to offline, abort to aborted', async () => {
    const fail = new FetchTransport(async () => { throw new TypeError('Failed to fetch'); }, online);
    let err: unknown;
    try { await fail.get({ url: 'https://h/a', signal: sig() }); } catch (e) { err = e; }
    expect(isAssetError(err) && [err.code, err.retryable]).toEqual(['network', true]);

    const off = new FetchTransport(async () => { throw new Error('unreachable'); }, () => false);
    expect(await code(off.get({ url: 'https://h/a', signal: sig() }))).toBe('offline');

    const ac = new AbortController();
    const ab = new FetchTransport(async () => { ac.abort(); throw new DOMException('x', 'AbortError'); }, online);
    expect(await code(ab.get({ url: 'https://h/a', signal: ac.signal }))).toBe('aborted');
  });

  it('a body read that fails becomes network, or aborted after abort', async () => {
    const mk = () => new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(3)); },
      pull() { throw new TypeError('reset'); },
    });
    const t = new FetchTransport(async () => new Response(mk(), { status: 200 }), online);
    const r = await t.get({ url: 'https://h/a', signal: sig() });
    expect(await code(drain(r.body))).toBe('network');
  });

  it('getText: text, null on 404, http error otherwise (5xx retryable)', async () => {
    const mk = (status: number, text = '') => new FetchTransport(async () => new Response(text, { status }), online);
    expect(await mk(200, 'abc').getText('https://h/s', sig())).toBe('abc');
    expect(await mk(404).getText('https://h/s', sig())).toBeNull();
    let err: unknown;
    try { await mk(503).getText('https://h/s', sig()); } catch (e) { err = e; }
    expect(isAssetError(err) && [err.code, err.retryable, err.status]).toEqual(['http', true, 503]);
    try { await mk(403).getText('https://h/s', sig()); } catch (e) { err = e; }
    expect(isAssetError(err) && err.retryable).toBe(false);
  });
});
