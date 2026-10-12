// @vitest-environment node
/**
 * Worker -> main-thread host calls (M3): handler `ctx.hostCall` emits a `hostCall` event, the leader tab's
 * UserDbClient runs the registered host API and answers with `hostReply`. The event never crosses the
 * BroadcastChannel, and followers never run host APIs.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Sync } from '@bible/core/browser';
import { createUserDbHandler, type ExtCtx } from './handler';
import type { ChannelLike, LocksLike, UserDbBackend } from './leader';
import type { UserDbEvent, UserDbRequest } from './protocol';
import { UserDbClient } from './UserDbClient';

class FakeLocks {
  private held = false;
  private queue: Array<() => void> = [];
  forTab(): LocksLike {
    return {
      request: (_name, _opts, cb) =>
        new Promise((resolve, reject) => {
          const run = () => {
            this.held = true;
            cb().then(resolve, reject).finally(() => {
              this.held = false;
              this.queue.shift()?.();
            });
          };
          if (this.held) this.queue.push(run);
          else run();
        }),
    };
  }
}

/** Records every message posted on the bus (structured-cloned, as a real channel would). */
class FakeBus {
  readonly posted: unknown[] = [];
  private channels = new Set<{ deliver(d: unknown): void }>();
  create(): ChannelLike {
    const listeners: Array<(e: { data: unknown }) => void> = [];
    const bus = this;
    const c = {
      postMessage(m: unknown) {
        const data = structuredClone(m);
        bus.posted.push(data);
        for (const o of bus.channels) if (o !== c) queueMicrotask(() => o.deliver(structuredClone(data)));
      },
      addEventListener(_t: 'message', l: (e: { data: unknown }) => void) {
        listeners.push(l);
      },
      deliver(data: unknown) {
        listeners.forEach((l) => l({ data }));
      },
      close() {
        bus.channels.delete(c);
      },
    };
    this.channels.add(c);
    return c;
  }
}

const fakeSql = {} as Sync.ISql;

/** An in-process backend over the real handler; the `sync` extension asks the main thread through `ctx.hostCall`. */
function handlerBackend(hostTimeoutMs?: number): UserDbBackend {
  const listeners = new Set<(e: UserDbEvent) => void>();
  const handler = createUserDbHandler({
    open: async () => ({ sql: fakeSql, wipe: async () => undefined, close: () => undefined }),
    emit: (e) => listeners.forEach((cb) => cb(structuredClone(e))),
    hostTimeoutMs,
    extensions: {
      sync: async (_req, ctx: ExtCtx) => ctx.hostCall('memory.bible', 'listModules', [{ lang: 'en' }]),
    },
  });
  return {
    send: async (req: UserDbRequest) => {
      try {
        return structuredClone(await handler.handle(structuredClone(req)));
      } catch (e) {
        throw handler.fail(e);
      }
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    terminate: () => undefined,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const syncReq: UserDbRequest = { op: 'sync', action: 'syncNow' };

function twoTabs(apis: { A?: Record<string, (...a: unknown[]) => unknown>; B?: Record<string, (...a: unknown[]) => unknown> }, hostTimeoutMs?: number) {
  const locks = new FakeLocks();
  const bus = new FakeBus();
  const created: string[] = [];
  const mk = (id: 'A' | 'B') =>
    new UserDbClient({
      nodeId: id,
      locks: locks.forTab(),
      createChannel: () => bus.create(),
      createBackend: () => {
        created.push(id);
        return handlerBackend(hostTimeoutMs);
      },
      hostApis: (name) => (name === 'memory.bible' ? apis[id] : undefined),
    });
  return { a: mk('A'), b: mk('B'), bus, created };
}

describe('hostCall round trip', () => {
  it('the leader tab runs the host API; the event never crosses the channel; followers get the answer', async () => {
    const leaderApi = { listModules: vi.fn(async (o: unknown) => [{ abbr: 'KJV', o }]) };
    const followerApi = { listModules: vi.fn(async () => ['follower']) };
    const { a, b, bus, created } = twoTabs({ A: leaderApi, B: followerApi });
    await tick();
    expect(a.isLeader()).toBe(true);
    const seenByFollower: UserDbEvent[] = [];
    b.onEvent((e) => seenByFollower.push(e));

    expect(await a.request(syncReq)).toEqual([{ abbr: 'KJV', o: { lang: 'en' } }]);
    // A follower's request is served by the leader's worker, which calls back into the LEADER tab.
    expect(await b.request(syncReq)).toEqual([{ abbr: 'KJV', o: { lang: 'en' } }]);
    await tick();

    expect(leaderApi.listModules).toHaveBeenCalledTimes(2);
    expect(followerApi.listModules).not.toHaveBeenCalled();
    expect(created).toEqual(['A']);
    expect(seenByFollower.some((e) => e.event === 'hostCall')).toBe(false);
    expect(JSON.stringify(bus.posted)).not.toContain('hostCall');
    expect(JSON.stringify(bus.posted)).not.toContain('hostReply');
    a.close();
    b.close();
  });

  it('an unknown api or method answers host_api_unavailable; a throwing api keeps its code', async () => {
    const { a, b } = twoTabs({ A: { listModules: async () => { throw Object.assign(new Error('no catalog'), { code: 'catalog_missing' }); } } });
    await tick();
    await expect(a.request(syncReq)).rejects.toMatchObject({ code: 'catalog_missing', message: 'no catalog' });
    a.close();
    b.close();

    const none = twoTabs({});
    await tick();
    await expect(none.a.request(syncReq)).rejects.toMatchObject({ code: 'host_api_unavailable' });
    none.a.close();
    none.b.close();

    const proto = twoTabs({ A: {} });
    await tick();
    await expect(proto.a.request(syncReq)).rejects.toMatchObject({ code: 'host_api_unavailable' });
    proto.a.close();
    proto.b.close();
  });

  it('a host API that never answers times out with host_timeout', async () => {
    const { a, b } = twoTabs({ A: { listModules: () => new Promise(() => undefined) } }, 20);
    await tick();
    await expect(a.request(syncReq)).rejects.toMatchObject({ code: 'host_timeout' });
    a.close();
    b.close();
  });
});
