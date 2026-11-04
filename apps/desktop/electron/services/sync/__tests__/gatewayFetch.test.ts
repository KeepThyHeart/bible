// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NetworkBlockedError, type FetchBufferedOptions, type FetchBufferedResult } from '../../NetworkGateway';
import { createGatewayFetch, SYNC_MAX_RESPONSE_BYTES } from '../gatewayFetch';

function gateway(answer: (o: FetchBufferedOptions) => Promise<FetchBufferedResult> | FetchBufferedResult) {
  const seen: FetchBufferedOptions[] = [];
  return { seen, gw: { fetchBuffered: async (o: FetchBufferedOptions) => { seen.push(o); return answer(o); } } };
}
const ok = (body: string, status = 200, headers: FetchBufferedResult['headers'] = {}): FetchBufferedResult =>
  ({ status, headers, url: 'x', body: Buffer.from(body) });

describe('createGatewayFetch', () => {
  it('passes request details through with the sync limits and no redirects', async () => {
    const { gw, seen } = gateway(() => ok('{"a":1}', 200, { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] }));
    const res = await createGatewayFetch(gw)('https://s.example/api', {
      method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{"x":1}',
    });
    expect(seen[0]).toMatchObject({
      url: 'https://s.example/api', method: 'POST', body: '{"x":1}', maxResponseBytes: SYNC_MAX_RESPONSE_BYTES,
      maxRedirects: 0, timeoutMs: 60_000, context: 'sync',
    });
    expect(seen[0].headers).toMatchObject({ authorization: 'Bearer t', 'content-type': 'application/json' });
    expect(SYNC_MAX_RESPONSE_BYTES).toBe(24 * 1024 * 1024);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('turns a redirect into a TypeError', async () => {
    const { gw } = gateway(() => ok('', 307, { location: 'https://evil.example' }));
    await expect(createGatewayFetch(gw)('https://s.example/a')).rejects.toBeInstanceOf(TypeError);
  });

  it('rethrows NetworkBlockedError unchanged and passes other failures on', async () => {
    const blocked = new NetworkBlockedError('sync');
    const a = gateway(() => { throw blocked; });
    await expect(createGatewayFetch(a.gw)('https://s.example/a')).rejects.toBe(blocked);
    const big = new Error('Response exceeded 25165824 bytes');
    const b = gateway(() => { throw big; });
    await expect(createGatewayFetch(b.gw)('https://s.example/a')).rejects.toBe(big);
  });

  it('handles 204, binary bodies and rejects unsupported bodies', async () => {
    const { gw, seen } = gateway(() => ok('', 204));
    const f = createGatewayFetch(gw);
    const res = await f('https://s.example/a', { method: 'PUT', body: new Uint8Array([1, 2, 3]) });
    expect(res.status).toBe(204);
    expect(Buffer.isBuffer(seen[0].body)).toBe(true);
    await expect(f('https://s.example/a', { method: 'POST', body: new URLSearchParams('a=1') })).rejects.toBeInstanceOf(TypeError);
  });

  it('honours the abort signal', async () => {
    const never = gateway(() => new Promise<FetchBufferedResult>(() => undefined));
    const f = createGatewayFetch(never.gw);
    const pre = new AbortController();
    pre.abort(new Error('early'));
    await expect(f('https://s.example/a', { signal: pre.signal })).rejects.toThrow('early');
    expect(never.seen).toHaveLength(0);
    const mid = new AbortController();
    const p = f('https://s.example/a', { signal: mid.signal });
    mid.abort(new Error('later'));
    await expect(p).rejects.toThrow('later');
  });
});
