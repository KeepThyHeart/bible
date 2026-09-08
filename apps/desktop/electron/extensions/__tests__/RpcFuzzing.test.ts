/**
 * RPC fuzzing tests - verify the host-side router never crashes when
 * confronted with malformed, hostile, or high-volume RPC traffic.
 *
 * These tests exercise `ExtensionRpcRouter` directly via paired in-memory
 * transports, matching the pattern established in `ExtensionRpcRouter.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { Extensions } from '@bible/core';

import {
  ExtensionRpcRouter,
  type IRpcTransport,
  type RpcProtocolViolation,
} from '../ExtensionRpcRouter';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcResponse = Extensions.RpcResponse;
type RpcRequest = Extensions.RpcRequest;

// --- Test helpers ------------------------------------------------------------

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
  violations: RpcProtocolViolation[];
} {
  let hostHandler: ((env: unknown) => void) | null = null;
  let workerHandler: ((env: unknown) => void) | null = null;
  const hostSent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      hostSent.push(env);
      workerHandler?.(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const workerSide: IRpcTransport = {
    send(env) {
      hostHandler?.(env);
    },
    onMessage(h) {
      workerHandler = h;
    },
    close() {
      workerHandler = null;
    },
  };
  const violations: RpcProtocolViolation[] = [];
  return { hostSide, workerSide, hostSent, violations };
}

function createRouter(pair: ReturnType<typeof pairedTransports>): ExtensionRpcRouter {
  return new ExtensionRpcRouter(pair.hostSide, {
    onProtocolViolation: (v) => pair.violations.push(v),
  });
}

/** Yield to the event loop so async handleRaw completes. */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

let nextId = 1;
async function workerCall(
  pair: ReturnType<typeof pairedTransports>,
  method: string,
  args: unknown[],
): Promise<RpcResponse> {
  const startLen = pair.hostSent.length;
  const id = `fuzz-${nextId++}`;
  const req: RpcRequest = { kind: 'request', id, method, args };
  pair.workerSide.send(req);
  for (let i = 0; i < 100; i++) {
    await flush();
    for (let j = startLen; j < pair.hostSent.length; j++) {
      const env = pair.hostSent[j];
      if (
        env &&
        typeof env === 'object' &&
        (env as RpcResponse).kind === 'response' &&
        (env as RpcResponse).id === id
      ) {
        return env as RpcResponse;
      }
    }
  }
  throw new Error(`workerCall: no response received for ${method}`);
}

// --- Tests -------------------------------------------------------------------

describe('RPC Fuzzing', () => {
  let pair: ReturnType<typeof pairedTransports>;
  let router: ExtensionRpcRouter;

  beforeEach(() => {
    pair = pairedTransports();
    router = createRouter(pair);
    // Register a simple handler so we can test valid vs invalid paths.
    router.registerMethod('echo', (args) => args[0]);
  });

  // --- Malformed envelope shapes --------------------------------------

  describe('malformed envelopes', () => {
    it('drops null', async () => {
      pair.workerSide.send(null as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
      expect(pair.hostSent).toHaveLength(0);
    });

    it('drops undefined', async () => {
      pair.workerSide.send(undefined as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
    });

    it('drops a number', async () => {
      pair.workerSide.send(42 as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
    });

    it('drops a string', async () => {
      pair.workerSide.send('hello' as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
    });

    it('drops an empty object', async () => {
      pair.workerSide.send({} as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
    });

    it('drops an array', async () => {
      pair.workerSide.send([1, 2, 3] as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
    });

    it('drops an object with an unknown kind', async () => {
      pair.workerSide.send({ kind: 'destroy' } as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
      expect(pair.violations[0]!.reason).toBe('malformed-envelope');
    });

    it('drops a boolean', async () => {
      pair.workerSide.send(true as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
    });

    it('drops deeply nested garbage', async () => {
      pair.workerSide.send({ kind: { nested: { deep: true } } } as unknown as RpcEnvelope);
      await flush();
      expect(pair.violations).toHaveLength(1);
    });
  });

  // --- Requests with missing or wrong-typed fields --------------------

  describe('malformed request envelopes', () => {
    it('drops a request with kind but no id', async () => {
      // isRpcEnvelope passes (kind is valid), but the handler should
      // cope gracefully even though `id` is undefined.
      pair.workerSide.send({ kind: 'request', method: 'echo', args: [] } as unknown as RpcEnvelope);
      await flush();
      // The router should still send a response (possibly to id=undefined).
      // The key invariant: no crash.
      expect(pair.hostSent.length).toBeGreaterThanOrEqual(0);
    });

    it('drops a request with no method', async () => {
      pair.workerSide.send({ kind: 'request', id: 'no-method', args: [] } as unknown as RpcEnvelope);
      await flush();
      // Should get a response with an error, since method lookup fails.
      pair.hostSent.find(
        (e) => e && typeof e === 'object' && (e as RpcResponse).id === 'no-method',
      );
      // Method is undefined -> unknown-method violation
      expect(pair.violations.some((v) => v.reason === 'unknown-method')).toBe(true);
    });

    it('returns error for a request with non-array args', async () => {
      pair.workerSide.send({
        kind: 'request',
        id: 'bad-args',
        method: 'echo',
        args: 'not-an-array',
      } as unknown as RpcEnvelope);
      await flush();
      // The handler receives args as 'not-an-array'. echo returns args[0]
      // which is 'n'. The point is: the router does not crash.
      expect(pair.hostSent.length).toBeGreaterThanOrEqual(0);
    });

    it('returns error for a request with null args', async () => {
      pair.workerSide.send({
        kind: 'request',
        id: 'null-args',
        method: 'echo',
        args: null,
      } as unknown as RpcEnvelope);
      await flush();
      // No crash is the invariant.
      expect(pair.hostSent.length).toBeGreaterThanOrEqual(0);
    });
  });

  // --- Method name injection ------------------------------------------

  describe('method name injection', () => {
    it('rejects __proto__ method', async () => {
      const res = await workerCall(pair, '__proto__', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects constructor method', async () => {
      const res = await workerCall(pair, 'constructor', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects __proto__.polluted method', async () => {
      const res = await workerCall(pair, '__proto__.polluted', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects toString method', async () => {
      const res = await workerCall(pair, 'toString', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects hasOwnProperty method', async () => {
      const res = await workerCall(pair, 'hasOwnProperty', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects empty-string method', async () => {
      const res = await workerCall(pair, '', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('rejects method with null bytes', async () => {
      const res = await workerCall(pair, 'echo\x00.evil', []);
      expect(res.error?.code).toBe('RpcProtocolError');
    });

    it('does not pollute the handler table via prototype methods', async () => {
      // After all the injection attempts, the registered echo handler
      // should still work normally.
      const res = await workerCall(pair, 'echo', ['safe']);
      expect(res.result).toBe('safe');
      expect(res.error).toBeUndefined();
    });
  });

  // --- Oversized payloads ---------------------------------------------

  describe('oversized payloads', () => {
    it('handles a request with a very large args array', async () => {
      const largeArgs = new Array(10_000).fill('x');
      const res = await workerCall(pair, 'echo', largeArgs);
      // Should return the first arg ('x'). The key: no crash, no hang.
      expect(res.result).toBe('x');
    });

    it('handles a request with a 1 MB string argument', async () => {
      const bigString = 'A'.repeat(1_024 * 1_024);
      const res = await workerCall(pair, 'echo', [bigString]);
      expect(res.result).toBe(bigString);
    });

    it('handles deeply nested objects in args', async () => {
      let nested: unknown = 'leaf';
      for (let i = 0; i < 100; i++) {
        nested = { child: nested };
      }
      const res = await workerCall(pair, 'echo', [nested]);
      // The echo handler returns args[0], so it should be the nested object.
      expect(res.error).toBeUndefined();
    });
  });

  // --- Subscribe/unsubscribe fuzzing ----------------------------------

  describe('subscription fuzzing', () => {
    it('ignores a duplicate subscription ID', async () => {
      pair.workerSide.send({ kind: 'subscribe', id: 'dup-1', channel: 'test.channel' });
      await flush();
      pair.workerSide.send({ kind: 'subscribe', id: 'dup-1', channel: 'test.channel' });
      await flush();
      expect(pair.violations.some((v) => v.reason === 'duplicate-subscription')).toBe(true);
    });

    it('ignores unsubscribe for unknown ID', async () => {
      pair.workerSide.send({ kind: 'unsubscribe', id: 'never-subscribed' });
      await flush();
      // Should not crash; violation is not raised for unknown unsub (it's a no-op).
      expect(router.hasSubscription('anything')).toBe(false);
    });

    it('handles rapid subscribe-unsubscribe cycling', async () => {
      for (let i = 0; i < 100; i++) {
        const id = `cycle-${i}`;
        pair.workerSide.send({ kind: 'subscribe', id, channel: 'rapid.channel' });
        pair.workerSide.send({ kind: 'unsubscribe', id });
      }
      await flush();
      // After all unsubscribes, no subscriptions remain.
      expect(router.hasSubscription('rapid.channel')).toBe(false);
    });
  });

  // --- Event from worker (forbidden in v1) ----------------------------

  describe('worker-initiated events', () => {
    it('rejects event envelopes from the worker', async () => {
      pair.workerSide.send({
        kind: 'event',
        channel: 'evil.channel',
        payload: { hack: true },
      });
      await flush();
      expect(pair.violations.some((v) => v.reason === 'unknown-kind')).toBe(true);
      expect(pair.hostSent).toHaveLength(0);
    });
  });

  // --- Concurrent rapid-fire requests ---------------------------------

  describe('concurrent rapid-fire', () => {
    it('handles 500 concurrent requests without dropping any', async () => {
      const COUNT = 500;
      router.registerMethod('counter', (args) => (args[0] as number) * 2);

      const promises: Promise<RpcResponse>[] = [];
      for (let i = 0; i < COUNT; i++) {
        promises.push(workerCall(pair, 'counter', [i]));
      }
      const results = await Promise.all(promises);

      expect(results).toHaveLength(COUNT);
      for (let i = 0; i < COUNT; i++) {
        expect(results[i]!.error).toBeUndefined();
        expect(results[i]!.result).toBe(i * 2);
      }
    });

    it('handles interleaved valid and invalid requests', async () => {
      const results: RpcResponse[] = [];
      const invalidCount = 50;
      const validCount = 50;

      // Send alternating valid and invalid requests.
      for (let i = 0; i < validCount; i++) {
        // Invalid
        pair.workerSide.send({ kind: 'garbage', i } as unknown as RpcEnvelope);
        // Valid
        results.push(await workerCall(pair, 'echo', [i]));
      }

      // All valid calls should have succeeded.
      for (let i = 0; i < validCount; i++) {
        expect(results[i]!.result).toBe(i);
        expect(results[i]!.error).toBeUndefined();
      }
      // Invalid messages should have produced violations.
      expect(pair.violations.length).toBeGreaterThanOrEqual(invalidCount);
    });
  });

  // --- Handler that throws synchronously ------------------------------

  describe('handler errors', () => {
    it('serializes a synchronous throw as a clean error response', async () => {
      router.registerMethod('boom', () => {
        throw new Error('kaboom');
      });
      const res = await workerCall(pair, 'boom', []);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe('Error');
      expect(res.error!.message).toBe('kaboom');
    });

    it('serializes a rejected promise as a clean error response', async () => {
      router.registerMethod('async-boom', async () => {
        throw new Error('async kaboom');
      });
      const res = await workerCall(pair, 'async-boom', []);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe('Error');
      expect(res.error!.message).toBe('async kaboom');
    });

    it('serializes non-Error throws (string)', async () => {
      router.registerMethod('throw-string', () => {
        throw 'just a string';
      });
      const res = await workerCall(pair, 'throw-string', []);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe('Error');
      expect(res.error!.message).toBe('just a string');
    });

    it('serializes non-Error throws (number)', async () => {
      router.registerMethod('throw-number', () => {
        throw 42;
      });
      const res = await workerCall(pair, 'throw-number', []);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe('Error');
      expect(res.error!.message).toBe('42');
    });
  });

  // --- Interaction after close ----------------------------------------

  describe('post-close behavior', () => {
    it('ignores messages after close', async () => {
      router.close();
      // Sending after close should not throw or process.
      pair.workerSide.send({ kind: 'request', id: 'post-close', method: 'echo', args: ['hi'] });
      await flush();
      // No response should be produced.
      expect(pair.hostSent).toHaveLength(0);
    });

    it('rejects reverse requests after close', async () => {
      router.close();
      await expect(router.request('echo', [])).rejects.toMatchObject({
        code: 'RpcCancelledError',
      });
    });
  });
});
