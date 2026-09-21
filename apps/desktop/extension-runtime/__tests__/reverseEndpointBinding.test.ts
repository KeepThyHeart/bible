/**
 * `api.runtime.expose` and `api.panels.onMessage` — binding an extension's
 * callbacks to the endpoints the host calls back on.
 *
 * **The gap this closes.** `ExtensionRuntime` has always had
 * `registerReverseHandler`, and until now nothing called it. Registration DTOs
 * carry a `handlerEndpoint` *string* rather than a function, because a
 * function cannot survive the RPC envelope that carries the registration to
 * the host — but the extension had no way to say which of its functions
 * answers to that name. So every reverse request came back `Unknown reverse
 * RPC method`:
 *
 *   - a `contributes.commands` entry appeared in the palette and did nothing
 *     when invoked;
 *   - hover, decorator and display-mode providers registered successfully and
 *     were never called;
 *   - `packages/extension-testing`'s realm smoke suite reported every endpoint
 *     hook as `not-invokable`, with a header explaining that this was the API
 *     surface's problem rather than the sandbox's.
 *
 * These tests pin the fix at the seam that was broken: a callback bound
 * through the public API must be reachable by a reverse request arriving on
 * the wire.
 */

import { describe, it, expect } from 'vitest';

import { ExtensionRuntime } from '../runtime';
import { PANEL_MESSAGE_ENDPOINT } from '../apiProxy';
import type { Extensions } from '@bible/core';

type RpcEnvelope = Extensions.RpcEnvelope;
type RpcRequest = Extensions.RpcRequest;
type RpcResponse = Extensions.RpcResponse;

/**
 * A worker with an in-memory channel.
 *
 * The runtime does not subscribe to its own channel — the entry script owns
 * that and feeds envelopes in through `dispatch`. So `deliver` below calls
 * `dispatch` directly, which is exactly what `workerBootstrap` does in
 * production.
 */
function makeWorker() {
  const sent: RpcEnvelope[] = [];
  const runtime = new ExtensionRuntime({
    channel: {
      send: (env: RpcEnvelope) => {
        sent.push(env);
      },
      onMessage: () => undefined,
    },
    moduleLoader: async () => ({ activate: async () => undefined }),
    // The error boundary installs process-level handlers; give it a stub so
    // the test process is left alone.
    boundaryProcess: {
      on: () => undefined,
      off: () => undefined,
      removeListener: () => undefined,
    } as never,
  });

  return {
    sent,
    runtime,
    api: runtime.getApi(),
    /** Push an envelope at the worker as the host would. */
    deliver: (env: RpcEnvelope) => runtime.dispatch(env),
    /** The response the worker sent for a given request id. */
    responseFor: (id: string) =>
      sent.find((e) => e.kind === 'response' && e.id === id) as RpcResponse | undefined,
    /** The first request the worker sent for a given method. */
    requestFor: (method: string) =>
      sent.find((e) => e.kind === 'request' && e.method === method) as RpcRequest | undefined,
  };
}

describe('reverse-RPC endpoint binding', () => {
  describe('api.runtime.expose', () => {
    it('makes a bound callback reachable by a reverse request', async () => {
      const w = makeWorker();

      await w.api.runtime.expose('helloWorld', async (name: unknown) => `hi ${String(name)}`);

      // The host invoking a `contributes.commands` handler looks exactly like
      // this. Before the binding existed it answered `Unknown reverse RPC
      // method` and the palette entry did nothing.
      await w.deliver({ kind: 'request', id: 'host-1', method: 'helloWorld', args: ['world'] });

      const res = w.responseFor('host-1');
      expect(res?.error).toBeUndefined();
      expect(res?.result).toBe('hi world');
    });

    it('reports a throwing handler back to the host as an error', async () => {
      const w = makeWorker();
      await w.api.runtime.expose('boom', () => {
        throw new Error('handler exploded');
      });

      await w.deliver({ kind: 'request', id: 'host-2', method: 'boom', args: [] });

      expect(w.responseFor('host-2')?.error?.message).toMatch(/handler exploded/);
    });

    it('unbinds through the returned handle', async () => {
      const w = makeWorker();

      const handle = await w.api.runtime.expose('temp', () => 'here');
      expect(await w.api.runtime.listExposed()).toContain('temp');

      await handle.dispose();

      expect(await w.api.runtime.listExposed()).not.toContain('temp');
      await w.deliver({ kind: 'request', id: 'host-3', method: 'temp', args: [] });
      expect(w.responseFor('host-3')?.error?.message).toMatch(/Unknown reverse RPC method/);
    });

    it('unbinds through unexpose, idempotently', async () => {
      const w = makeWorker();

      await w.api.runtime.expose('temp', () => 'here');
      await w.api.runtime.unexpose('temp');
      await w.api.runtime.unexpose('temp');

      expect(await w.api.runtime.listExposed()).toEqual([]);
    });

    it('replaces a handler when the same endpoint is bound twice', async () => {
      const w = makeWorker();

      await w.api.runtime.expose('dup', () => 'first');
      await w.api.runtime.expose('dup', () => 'second');

      await w.deliver({ kind: 'request', id: 'host-4', method: 'dup', args: [] });
      expect(w.responseFor('host-4')?.result).toBe('second');
    });

    it('passes every positional argument through to the handler', async () => {
      const w = makeWorker();
      await w.api.runtime.expose('sum', (...args: unknown[]) =>
        (args as number[]).reduce((a, b) => a + b, 0),
      );

      await w.deliver({ kind: 'request', id: 'host-5', method: 'sum', args: [1, 2, 3] });
      expect(w.responseFor('host-5')?.result).toBe(6);
    });

    it('refuses the host-reserved endpoint prefix', async () => {
      const w = makeWorker();
      // `runtime.init` is the activation handshake. An extension binding there
      // could shadow a control message.
      await expect(w.api.runtime.expose('runtime.init', () => 1)).rejects.toThrow(/reserved/i);
    });

    it('validates its arguments', async () => {
      const w = makeWorker();
      await expect(w.api.runtime.expose('', () => 1)).rejects.toThrow(/non-empty string/);
      await expect(
        (w.api.runtime.expose as unknown as (a: string, b: unknown) => Promise<unknown>)(
          'x',
          'not a function',
        ),
      ).rejects.toThrow(/must be a function/);
    });

    it('does not send anything to the host — the table is worker-local', async () => {
      const w = makeWorker();

      await w.api.runtime.expose('local', () => 1);
      await w.api.runtime.listExposed();

      // A round trip here would be pure latency: the thing being written is
      // the worker's own inbound-request table.
      expect(w.sent).toHaveLength(0);
    });
  });

  describe('api.panels.onMessage', () => {
    it('binds the panel endpoint and receives message plus sender', async () => {
      const w = makeWorker();
      const seen: unknown[] = [];

      const pending = w.api.panels.onMessage(async (message, sender) => {
        seen.push({ message, sender });
        return { ok: true };
      });

      // The guest tells the host a handler now exists, so a message arriving
      // at a handler-less extension can be refused with a useful error.
      // Answer that request so the registration settles.
      const req = w.requestFor('panels.setMessageHandler');
      expect(req?.args).toEqual([true]);
      await w.deliver({ kind: 'response', id: req!.id, result: undefined });
      await pending;

      await w.deliver({
        kind: 'request',
        id: 'host-6',
        method: PANEL_MESSAGE_ENDPOINT,
        args: [{ type: 'load' }, { extensionId: 'ext.a', panelId: 'p1', panelTypeId: 't' }],
      });

      expect(seen).toEqual([
        {
          message: { type: 'load' },
          sender: { extensionId: 'ext.a', panelId: 'p1', panelTypeId: 't' },
        },
      ]);
      expect(w.responseFor('host-6')?.result).toEqual({ ok: true });
    });

    it('tells the host when the handler goes away', async () => {
      const w = makeWorker();

      const pending = w.api.panels.onMessage(() => undefined);
      const reg = w.requestFor('panels.setMessageHandler');
      await w.deliver({ kind: 'response', id: reg!.id, result: undefined });
      const handle = await pending;

      const disposing = handle.dispose();
      const off = w.sent.filter(
        (e) => e.kind === 'request' && e.method === 'panels.setMessageHandler',
      ) as RpcRequest[];
      expect(off).toHaveLength(2);
      expect(off[1]!.args).toEqual([false]);
      await w.deliver({ kind: 'response', id: off[1]!.id, result: undefined });
      await disposing;

      // And the endpoint really is unbound, not merely announced as gone.
      await w.deliver({
        kind: 'request',
        id: 'host-7',
        method: PANEL_MESSAGE_ENDPOINT,
        args: [{}, {}],
      });
      expect(w.responseFor('host-7')?.error?.message).toMatch(/Unknown reverse RPC method/);
    });

    it('rejects a non-function handler', async () => {
      const w = makeWorker();
      await expect(
        (w.api.panels.onMessage as unknown as (h: unknown) => Promise<unknown>)('nope'),
      ).rejects.toThrow(/must be a function/);
    });
  });

  describe('unbound endpoints', () => {
    it('still answer Unknown reverse RPC method, so typos stay loud', async () => {
      const w = makeWorker();

      await w.deliver({ kind: 'request', id: 'host-8', method: 'neverBound', args: [] });

      expect(w.responseFor('host-8')?.error?.message).toMatch(
        /Unknown reverse RPC method: neverBound/,
      );
    });
  });
});
