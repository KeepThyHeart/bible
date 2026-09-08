import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';

type RpcEnvelope = Extensions.RpcEnvelope;

/**
 * Tiny in-memory transport pair. Each side gets one of these and any
 * envelope `send`-ed on `a` shows up in `b`'s `onMessage` listener (and vice
 * versa). Lets us drive the router under vitest without spawning a worker.
 */
function pairedTransports(): { a: IRpcTransport; b: IRpcTransport; sentByA: unknown[]; sentByB: unknown[] } {
  let aHandler: ((env: unknown) => void) | null = null;
  let bHandler: ((env: unknown) => void) | null = null;
  const sentByA: unknown[] = [];
  const sentByB: unknown[] = [];
  const a: IRpcTransport = {
    send(env) {
      sentByA.push(env);
      bHandler?.(env);
    },
    onMessage(h) {
      aHandler = h;
    },
    close() {
      aHandler = null;
    },
  };
  const b: IRpcTransport = {
    send(env) {
      sentByB.push(env);
      aHandler?.(env);
    },
    onMessage(h) {
      bHandler = h;
    },
    close() {
      bHandler = null;
    },
  };
  return { a, b, sentByA, sentByB };
}

describe('ExtensionRpcRouter', () => {
  let router: ExtensionRpcRouter;
  let pair: ReturnType<typeof pairedTransports>;

  beforeEach(() => {
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.a);
  });

  it('routes a registered method call back as a response', async () => {
    router.registerMethod('bible.getVerse', (args) => ({ id: args[0], text: 'In the beginning' }));

    // Worker side: send a request envelope.
    pair.b.send({ kind: 'request', id: 'r1', method: 'bible.getVerse', args: [1001001] });

    // Yield to let the async handler run.
    await new Promise((r) => setImmediate(r));

    expect(pair.sentByA).toHaveLength(1);
    const res = pair.sentByA[0] as Extensions.RpcResponse;
    expect(res.kind).toBe('response');
    expect(res.id).toBe('r1');
    expect(res.result).toEqual({ id: 1001001, text: 'In the beginning' });
  });

  it('returns RpcProtocolError for an unknown method', async () => {
    pair.b.send({ kind: 'request', id: 'r2', method: 'bible.nope', args: [] });
    await new Promise((r) => setImmediate(r));
    const res = pair.sentByA[0] as Extensions.RpcResponse;
    expect(res.error?.code).toBe('RpcProtocolError');
    expect(res.error?.message).toContain('Unknown RPC method');
  });

  it('serializes thrown ExtensionApiError with its code', async () => {
    router.registerMethod('storage.set', () => {
      throw new Extensions.QuotaExceededError('5MB exceeded');
    });
    pair.b.send({ kind: 'request', id: 'r3', method: 'storage.set', args: [] });
    await new Promise((r) => setImmediate(r));
    const res = pair.sentByA[0] as Extensions.RpcResponse;
    expect(res.error?.code).toBe('QuotaExceededError');
    expect(res.error?.message).toBe('5MB exceeded');
  });

  it('drops malformed envelopes via the violation callback', async () => {
    const onViolation = vi.fn();
    pair = pairedTransports();
    router = new ExtensionRpcRouter(pair.a, { onProtocolViolation: onViolation });
    pair.b.send({ kind: 'garbage' } as unknown as RpcEnvelope);
    await new Promise((r) => setImmediate(r));
    expect(onViolation).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'malformed-envelope' }),
    );
    expect(pair.sentByA).toHaveLength(0);
  });

  it('only emits events to subscribed channels', () => {
    router.emitEvent('bible.activeVerse', { verseId: 43003016 });
    expect(pair.sentByA).toHaveLength(0); // no subscribers yet

    pair.b.send({ kind: 'subscribe', id: 'sub-1', channel: 'bible.activeVerse' });
    router.emitEvent('bible.activeVerse', { verseId: 43003016 });
    expect(pair.sentByA).toHaveLength(1);
    expect((pair.sentByA[0] as Extensions.RpcEvent).channel).toBe('bible.activeVerse');

    pair.b.send({ kind: 'unsubscribe', id: 'sub-1' });
    router.emitEvent('bible.activeVerse', { verseId: 1 });
    expect(pair.sentByA).toHaveLength(1); // still only the first
  });

  it('reverse request resolves on response', async () => {
    const promise = router.request<string>('commands.execute', ['ext.test.greet'], { timeoutMs: 1000 });

    // The router should have written a request envelope to its transport.
    expect(pair.sentByA).toHaveLength(1);
    const sent = pair.sentByA[0] as Extensions.RpcRequest;
    expect(sent.kind).toBe('request');
    expect(sent.method).toBe('commands.execute');

    // Worker replies.
    pair.b.send({ kind: 'response', id: sent.id, result: 'hello' });
    expect(await promise).toBe('hello');
  });

  it('reverse request times out and rejects with RpcTimeoutError', async () => {
    const p = router.request('commands.execute', [], { timeoutMs: 5 });
    await expect(p).rejects.toMatchObject({ code: 'RpcTimeoutError' });
  });

  it('close cancels pending reverse requests', async () => {
    const p = router.request('commands.execute', [], { timeoutMs: 5_000 });
    router.close();
    await expect(p).rejects.toMatchObject({ code: 'RpcCancelledError' });
  });
});
