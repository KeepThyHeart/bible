/**
 * `EventsApiImpl.publish` unit tests (`events.publish`, task 0024 round 3,
 * P1.8 - "the events system in `design-p0.3-p2.14-event-system.md`" §3,
 * slice 3).
 *
 * `publish` is the one real host RPC method `IEventsApi` has - `subscribe`
 * never reaches the host as an RPC at all (see `eventsApiImpl.ts`'s header
 * comment) - so this is the one place that needs its own test file rather
 * than reusing `ApiImpls.test.ts`'s per-namespace pattern.
 */

import { describe, it, expect } from 'vitest';
import { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { EventsApiImpl } from '../api-impl/eventsApiImpl';

type RpcEvent = Extensions.RpcEvent;
type RpcResponse = Extensions.RpcResponse;
type RpcRequest = Extensions.RpcRequest;

function pairedTransports(): {
  hostSide: IRpcTransport;
  workerSide: IRpcTransport;
  hostSent: unknown[];
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
  return { hostSide, workerSide, hostSent };
}

interface FakeWorker {
  extensionId: string;
  router: ExtensionRpcRouter;
  eventsApi: EventsApiImpl;
  hostSent: unknown[];
  workerSide: IRpcTransport;
}

/** A little test rig wiring N workers' `EventsApiImpl`s to fan out to each other, exactly as `ExtensionHostRpc.attachApiImpls` does. */
function makeWorkers(extensionIds: string[]): Map<string, FakeWorker> {
  const workers = new Map<string, FakeWorker>();
  for (const extensionId of extensionIds) {
    const { hostSide, workerSide, hostSent } = pairedTransports();
    const router = new ExtensionRpcRouter(hostSide);
    const eventsApi = new EventsApiImpl({
      extensionId,
      router,
      publish: (channel, payload) => {
        for (const [otherId, other] of workers) {
          if (otherId === extensionId) continue;
          other.router.emitEvent(channel, payload);
        }
      },
    });
    eventsApi.attach();
    workers.set(extensionId, { extensionId, router, eventsApi, hostSent, workerSide });
  }
  return workers;
}

let nextReqId = 1;

async function callPublish(
  worker: FakeWorker,
  channel: unknown,
  payload: unknown,
): Promise<RpcResponse> {
  const id = `req-${nextReqId++}`;
  const req: RpcRequest = { kind: 'request', id, method: 'events.publish', args: [channel, payload] };
  worker.workerSide.send(req);
  // `ExtensionRpcRouter.handleRaw` is invoked as `void this.handleRaw(raw)`
  // from the transport's `onMessage` callback, so the response is not on
  // `hostSent` synchronously - give the microtask queue a turn.
  await new Promise((r) => setImmediate(r));
  const res = worker.hostSent.find((e) => (e as RpcResponse).kind === 'response' && (e as RpcResponse).id === id);
  return res as RpcResponse;
}

describe('events.publish', () => {
  it('reaches every other active worker subscribed to the exact channel', async () => {
    const workers = makeWorkers(['ext.a.one', 'ext.b.two']);
    const a = workers.get('ext.a.one')!;
    const b = workers.get('ext.b.two')!;

    b.workerSide.send({ kind: 'subscribe', id: 'sub-1', channel: 'ext.a.one.ping' });

    const res = await callPublish(a, 'ext.a.one.ping', { hello: 'world' });
    expect(res.error).toBeUndefined();

    const events = b.hostSent.filter((e) => (e as RpcEvent).kind === 'event' && (e as RpcEvent).channel === 'ext.a.one.ping');
    expect(events).toHaveLength(1);
    expect((events[0] as RpcEvent).payload).toEqual({ hello: 'world' });
  });

  it('rejects a channel outside the caller\'s own namespace', async () => {
    const workers = makeWorkers(['ext.a.one', 'ext.b.two']);
    const a = workers.get('ext.a.one')!;

    const res = await callPublish(a, 'ext.b.two.snoop', {});
    expect(res.error?.code).toBe('RpcProtocolError');
  });

  it('does not deliver to the publisher itself', async () => {
    const workers = makeWorkers(['ext.a.one']);
    const a = workers.get('ext.a.one')!;
    a.workerSide.send({ kind: 'subscribe', id: 'sub-1', channel: 'ext.a.one.ping' });

    await callPublish(a, 'ext.a.one.ping', {});

    const events = a.hostSent.filter((e) => (e as RpcEvent).kind === 'event');
    expect(events).toHaveLength(0);
  });

  it('is a no-op (but not an error) when no one subscribed', async () => {
    const workers = makeWorkers(['ext.a.one', 'ext.b.two']);
    const a = workers.get('ext.a.one')!;

    const res = await callPublish(a, 'ext.a.one.ping', {});
    expect(res.error).toBeUndefined();
  });

  it('rejects a non-string channel', async () => {
    const workers = makeWorkers(['ext.a.one']);
    const a = workers.get('ext.a.one')!;
    const res = await callPublish(a, 123, {});
    expect(res.error?.code).toBe('RpcProtocolError');
  });
});
