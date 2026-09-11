/**
 * The panel-to-worker channel (`PlatformPlan.md` P0).
 *
 * Before this channel existed, a panel iframe could navigate a verse, read the
 * theme mode, and make a permission-gated fetch. That was the entire surface:
 * it could not read scripture, store anything, or localise a string, so no
 * stateful panel extension was possible at all. The channel is deliberately
 * opaque - the panel posts a message, the extension's own worker decides what
 * to do with the API access it already holds - so that permission enforcement
 * stays in `ExtensionPermissionGuard` and does not get duplicated into the
 * renderer.
 *
 * What these tests pin, in order of how badly it would hurt to lose:
 *
 *   1. The identity of the sender is host-supplied. A panel that could name an
 *      extension could spend another extension's grants.
 *   2. Payloads are capped, in both directions. The worker is a QuickJS realm
 *      with a bounded heap.
 *   3. A message to an extension with no handler fails usefully rather than as
 *      a bare `Unknown reverse RPC method`.
 *   4. The endpoint name the host calls matches the one the guest binds. These
 *      live in two files that do not import each other.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  PanelsApiImpl,
  PANEL_MESSAGE_ENDPOINT,
  MAX_PANEL_MESSAGE_BYTES,
  PanelMessageTooLargeError,
  assertPanelMessageWithinCap,
} from '../api-impl/panelsApiImpl';
import { PANEL_MESSAGE_ENDPOINT as GUEST_PANEL_ENDPOINT } from '../../../extension-runtime/apiProxy';
import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';

/** A router stand-in that records reverse requests and replays a canned reply. */
function fakeRouter(reply: unknown = 'ok') {
  const namespaces = new Map<string, Record<string, (args: unknown[]) => unknown>>();
  const requests: { method: string; args: unknown[]; timeoutMs?: number }[] = [];
  const router = {
    registerNamespace(ns: string, methods: Record<string, (args: unknown[]) => unknown>) {
      namespaces.set(ns, methods);
    },
    request: vi.fn(async (method: string, args: unknown[], opts?: { timeoutMs?: number }) => {
      requests.push({ method, args, ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
      if (reply instanceof Error) throw reply;
      return reply;
    }),
  } as unknown as ExtensionRpcRouter;
  return { router, namespaces, requests };
}

/** Drive the worker->host direction: call an RPC method the impl registered. */
async function callRpc(
  namespaces: Map<string, Record<string, (args: unknown[]) => unknown>>,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const fn = namespaces.get('panels')?.[method];
  if (!fn) throw new Error(`panels.${method} was not registered`);
  return fn(args);
}

const SENDER = {
  extensionId: 'ext.test.alpha',
  panelId: 'panel-7',
  panelTypeId: 'ext.test.alpha.main',
};

describe('panel channel', () => {
  describe('host and guest agree on the endpoint name', () => {
    it('uses the same constant on both sides of the wire', () => {
      // These are declared in two files that never import each other - the
      // guest bundle must not pull in host code. A rename on one side would
      // otherwise turn every panel message into `Unknown reverse RPC method`,
      // and only at runtime, inside a sandboxed realm.
      expect(PANEL_MESSAGE_ENDPOINT).toBe(GUEST_PANEL_ENDPOINT);
    });
  });

  describe('delivering a message to the worker', () => {
    it('reverse-RPCs the handler and resolves with its reply', async () => {
      const { router, namespaces, requests } = fakeRouter({ verses: 3 });
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();
      await callRpc(namespaces, 'setMessageHandler', [true]);

      const result = await api.deliver({ type: 'getRange' }, SENDER);

      expect(result).toEqual({ verses: 3 });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.method).toBe(PANEL_MESSAGE_ENDPOINT);
      expect(requests[0]!.args[0]).toEqual({ type: 'getRange' });
    });

    it('passes the host-supplied sender through as the second argument', async () => {
      const { router, namespaces, requests } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();
      await callRpc(namespaces, 'setMessageHandler', [true]);

      await api.deliver({ hello: true }, SENDER);

      // The worker can trust this in a way it must not trust the message: it
      // is assembled by the host from the closure that mounted the iframe.
      expect(requests[0]!.args[1]).toEqual(SENDER);
    });

    it('does not let the message payload override the sender identity', async () => {
      const { router, namespaces, requests } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();
      await callRpc(namespaces, 'setMessageHandler', [true]);

      // A hostile panel naming another extension inside its own payload. The
      // payload is opaque and travels as-is, but it is arg 0; the identity the
      // worker reads is arg 1, and that came from the host.
      await api.deliver(
        { extensionId: 'ext.other.victim', panelId: 'not-mine' },
        SENDER,
      );

      expect(requests[0]!.args[1]).toEqual(SENDER);
      expect((requests[0]!.args[1] as { extensionId: string }).extensionId).toBe(
        'ext.test.alpha',
      );
    });

    it('applies a timeout so a wedged worker cannot hang the panel forever', async () => {
      const { router, namespaces, requests } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();
      await callRpc(namespaces, 'setMessageHandler', [true]);

      await api.deliver({}, SENDER);

      expect(requests[0]!.timeoutMs).toBeGreaterThan(0);
    });

    it('refuses when the extension never registered a handler', async () => {
      const { router, requests } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();

      // Without `setMessageHandler(true)` the router would answer the reverse
      // request with `Unknown reverse RPC method`, which tells an extension
      // author nothing. Fail before the wire instead, naming the fix.
      await expect(api.deliver({}, SENDER)).rejects.toThrow(
        /no panel message handler/i,
      );
      expect(requests).toHaveLength(0);
    });

    it('stops delivering once disposed', async () => {
      const { router, namespaces } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();
      await callRpc(namespaces, 'setMessageHandler', [true]);
      api.dispose();

      await expect(api.deliver({}, SENDER)).rejects.toThrow(/disposed/i);
    });
  });

  describe('payload cap', () => {
    it('accepts a message at the limit and rejects one over it', () => {
      // Sized against the JSON the transport actually carries, because that is
      // what the realm has to allocate.
      const underBy = MAX_PANEL_MESSAGE_BYTES - 100;
      expect(() =>
        assertPanelMessageWithinCap({ s: 'x'.repeat(underBy) }, 'test'),
      ).not.toThrow();

      expect(() =>
        assertPanelMessageWithinCap({ s: 'x'.repeat(MAX_PANEL_MESSAGE_BYTES) }, 'test'),
      ).toThrow(PanelMessageTooLargeError);
    });

    it('caps the panel -> worker direction', async () => {
      const { router, namespaces, requests } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();
      await callRpc(namespaces, 'setMessageHandler', [true]);

      await expect(
        api.deliver({ s: 'x'.repeat(MAX_PANEL_MESSAGE_BYTES) }, SENDER),
      ).rejects.toThrow(PanelMessageTooLargeError);
      // Nothing reached the realm.
      expect(requests).toHaveLength(0);
    });

    it('caps the worker -> panel direction too', async () => {
      const { router, namespaces } = fakeRouter();
      const posted: unknown[] = [];
      const api = new PanelsApiImpl({
        extensionId: 'ext.test.alpha',
        router,
        uiBridge: {
          postPanelMessage: (extensionId: string, message: unknown, panelId?: string) =>
            posted.push({ extensionId, message, panelId }),
        } as never,
      });
      api.attach();

      await expect(
        callRpc(namespaces, 'postMessage', [{ s: 'x'.repeat(MAX_PANEL_MESSAGE_BYTES) }]),
      ).rejects.toThrow(PanelMessageTooLargeError);
      expect(posted).toHaveLength(0);
    });

    it('rejects an unserialisable message with a readable error', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => assertPanelMessageWithinCap(cyclic, 'test')).toThrow(
        /not serialisable/i,
      );
    });
  });

  describe('worker -> panel push', () => {
    it('stamps the sending extension and forwards the target panel', async () => {
      const { router, namespaces } = fakeRouter();
      const posted: { extensionId: string; message: unknown; panelId?: string }[] = [];
      const api = new PanelsApiImpl({
        extensionId: 'ext.test.alpha',
        router,
        uiBridge: {
          postPanelMessage: (extensionId: string, message: unknown, panelId?: string) => {
            posted.push({ extensionId, message, ...(panelId ? { panelId } : {}) });
          },
        } as never,
      });
      api.attach();

      await callRpc(namespaces, 'postMessage', [{ tick: 1 }, { panelId: 'panel-7' }]);
      await callRpc(namespaces, 'postMessage', [{ tick: 2 }]);

      // `extensionId` is stamped here, not accepted from the worker, so a
      // worker cannot push into another extension's panels.
      expect(posted).toEqual([
        { extensionId: 'ext.test.alpha', message: { tick: 1 }, panelId: 'panel-7' },
        { extensionId: 'ext.test.alpha', message: { tick: 2 } },
      ]);
    });

    it('rejects rather than silently dropping when no UI bridge is wired', async () => {
      const { router, namespaces } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();

      await expect(callRpc(namespaces, 'postMessage', [{ x: 1 }])).rejects.toThrow(
        /no UI bridge/i,
      );
    });

    it('rejects a non-string panelId', async () => {
      const { router, namespaces } = fakeRouter();
      const api = new PanelsApiImpl({
        extensionId: 'ext.test.alpha',
        router,
        uiBridge: { postPanelMessage: () => undefined } as never,
      });
      api.attach();

      await expect(
        callRpc(namespaces, 'postMessage', [{ x: 1 }, { panelId: 42 }]),
      ).rejects.toThrow(/panelId/);
    });
  });

  describe('setMessageHandler', () => {
    it('tracks whether a handler is bound', async () => {
      const { router, namespaces } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();

      expect(api.hasMessageHandler()).toBe(false);
      await callRpc(namespaces, 'setMessageHandler', [true]);
      expect(api.hasMessageHandler()).toBe(true);
      await callRpc(namespaces, 'setMessageHandler', [false]);
      expect(api.hasMessageHandler()).toBe(false);
    });

    it('rejects a non-boolean', async () => {
      const { router, namespaces } = fakeRouter();
      const api = new PanelsApiImpl({ extensionId: 'ext.test.alpha', router });
      api.attach();

      await expect(callRpc(namespaces, 'setMessageHandler', ['yes'])).rejects.toThrow(
        /boolean/,
      );
    });
  });
});
