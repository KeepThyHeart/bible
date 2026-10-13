// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createUserDbNode, isReplayable, type ChannelLike, type LocksLike, type UserDbBackend } from './leader';
import type { UserDbEvent, UserDbRequest } from './protocol';

/** Fake navigator.locks: exclusive FIFO queue per name; the holder keeps the lock until its callback's promise settles. */
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

/** Fake BroadcastChannel bus: delivers asynchronously to every other open channel with the same name. */
class FakeBus {
  private channels = new Set<FakeChannel>();
  create(): ChannelLike {
    const c = new FakeChannel(this);
    this.channels.add(c);
    return c;
  }
  post(from: FakeChannel, data: unknown) {
    for (const c of this.channels) if (c !== from) queueMicrotask(() => c.deliver(structuredClone(data)));
  }
  remove(c: FakeChannel) {
    this.channels.delete(c);
  }
}
class FakeChannel implements ChannelLike {
  private listeners: Array<(e: { data: unknown }) => void> = [];
  constructor(private bus: FakeBus) {}
  postMessage(m: unknown) {
    this.bus.post(this, m);
  }
  addEventListener(_t: 'message', l: (e: { data: unknown }) => void) {
    this.listeners.push(l);
  }
  deliver(data: unknown) {
    this.listeners.forEach((l) => l({ data }));
  }
  close() {
    this.bus.remove(this);
  }
}

function fakeBackend(label: string, log: string[]): UserDbBackend & { emit(e: UserDbEvent): void; terminated: boolean } {
  const listeners = new Set<(e: UserDbEvent) => void>();
  return {
    terminated: false,
    async send(req: UserDbRequest) {
      if (req.op === 'call' && req.method === 'boom') throw Object.assign(new Error('kaput'), { code: 'SQLITE_BUSY' });
      log.push(`${label}:${req.op === 'call' ? req.method : req.op}`);
      return req.op === 'call' ? { by: label, args: req.args } : null;
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(e) {
      listeners.forEach((cb) => cb(e));
    },
    terminate() {
      this.terminated = true;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const call = (method: string, ...args: unknown[]): UserDbRequest => ({ op: 'call', repo: 'notes', method, args });

describe('leader / follower', () => {
  it('first tab leads, second proxies over the channel, events fan out', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const log: string[] = [];
    const backends: Record<string, ReturnType<typeof fakeBackend>> = {};
    const mk = (id: string) =>
      createUserDbNode({
        nodeId: id,
        locks: locks.forTab(),
        createChannel: () => bus.create(),
        createBackend: () => (backends[id] = fakeBackend(id, log)),
      });
    const a = mk('A');
    const b = mk('B');
    await tick();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);

    expect(await a.request(call('getAll', 1))).toEqual({ by: 'A', args: [1] });
    expect(await b.request(call('getAll', 2))).toEqual({ by: 'A', args: [2] });
    expect(backends.B).toBeUndefined(); // the follower never spawned a worker

    const seen: UserDbEvent[] = [];
    b.onEvent((e) => seen.push(e));
    backends.A.emit({ event: 'changed', tables: ['user_note'] });
    await tick();
    expect(seen).toEqual([{ event: 'changed', tables: ['user_note'] }]);

    // errors cross the channel as {name,message,code}
    await expect(b.request(call('boom'))).rejects.toMatchObject({ message: 'kaput', code: 'SQLITE_BUSY' });
    await expect(a.request(call('boom'))).rejects.toMatchObject({ message: 'kaput', code: 'SQLITE_BUSY' });
    a.close();
    b.close();
  });

  it('re-elects when the leader closes; the follower retries its pending request on the new leader', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const log: string[] = [];
    const backends: Record<string, ReturnType<typeof fakeBackend>> = {};
    const mk = (id: string, hang = false) =>
      createUserDbNode({
        nodeId: id,
        locks: locks.forTab(),
        createChannel: () => bus.create(),
        createBackend: () => {
          const be = (backends[id] = fakeBackend(id, log));
          if (hang) be.send = () => new Promise(() => undefined); // the old leader never answers
          return be;
        },
      });
    const a = mk('A', true);
    const b = mk('B');
    const c = mk('C');
    await tick();
    const leaderEvents: boolean[] = [];
    b.onEvent((e) => e.event === 'leader' && leaderEvents.push(e.isLeader));

    const inflight = c.request(call('save', 'x')); // A swallows it
    await tick();
    a.close(); // tab closes: lock passes to B
    expect(await inflight).toEqual({ by: 'B', args: ['x'] });
    expect(b.isLeader()).toBe(true);
    expect(c.isLeader()).toBe(false);
    expect(leaderEvents).toEqual([true]);
    expect(backends.A.terminated).toBe(true);
    expect(await c.request(call('after'))).toMatchObject({ by: 'B' });
    b.close();
    c.close();
  });

  it('hostCall events reach the leader tab only and are never posted on the channel', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const posted: unknown[] = [];
    const log: string[] = [];
    const backends: Record<string, ReturnType<typeof fakeBackend>> = {};
    const mk = (id: string) =>
      createUserDbNode({
        nodeId: id,
        locks: locks.forTab(),
        createChannel: () => {
          const c = bus.create();
          const postMessage = c.postMessage.bind(c);
          c.postMessage = (m: unknown) => {
            posted.push(m);
            postMessage(m);
          };
          return c;
        },
        createBackend: () => (backends[id] = fakeBackend(id, log)),
      });
    const a = mk('A');
    const b = mk('B');
    await tick();
    const seenA: UserDbEvent[] = [];
    const seenB: UserDbEvent[] = [];
    a.onEvent((e) => seenA.push(e));
    b.onEvent((e) => seenB.push(e));
    const hostCall: UserDbEvent = { event: 'hostCall', callId: 1, api: 'memory.bible', method: 'listModules', args: [] };
    backends.A.emit(hostCall);
    backends.A.emit({ event: 'changed', tables: ['user_note'] });
    await tick();
    expect(seenA).toEqual([hostCall, { event: 'changed', tables: ['user_note'] }]);
    expect(seenB).toEqual([{ event: 'changed', tables: ['user_note'] }]);
    expect(posted.some((m) => (m as { evt?: UserDbEvent }).evt?.event === 'hostCall')).toBe(false);

    // A forged broadcast hostCall is ignored by followers.
    const rogue = bus.create();
    rogue.postMessage({ t: 'evt', evt: hostCall });
    await tick();
    expect(seenB.filter((e) => e.event === 'hostCall')).toEqual([]);
    a.close();
    b.close();
  });

  it('requests made before the lock is granted are served once this tab leads', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const log: string[] = [];
    const a = createUserDbNode({ nodeId: 'A', locks: locks.forTab(), createChannel: () => bus.create(), createBackend: () => fakeBackend('A', log) });
    const early = a.request(call('early'));
    expect(await early).toMatchObject({ by: 'A' });
    a.close();
    await expect(a.request(call('late'))).rejects.toMatchObject({ code: 'closed' });
  });

  it('a follower request that is not replayable (changePassword) rejects with leader_changed after a leader change; replayable ones are re-sent', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const log: string[] = [];
    const mk = (id: string, hang = false) =>
      createUserDbNode({
        nodeId: id,
        locks: locks.forTab(),
        createChannel: () => bus.create(),
        createBackend: () => {
          const be = fakeBackend(id, log);
          if (hang) be.send = () => new Promise(() => undefined);
          return be;
        },
      });
    const a = mk('A', true);
    const b = mk('B');
    const c = mk('C');
    await tick();
    const change = c.request({ op: 'sync', action: 'account', method: 'changePassword', args: ['old', 'new'] });
    const signIn = c.request({ op: 'sync', action: 'account', method: 'signIn', args: ['e', 'p'] });
    const changeResult = change.then(() => 'ok', (e) => (e as { code?: string }).code);
    await tick();
    a.close();
    expect(await changeResult).toBe('leader_changed');
    await signIn; // idempotent: re-sent and answered by the new leader
    expect(log).toEqual(['B:sync']); // only signIn reached the new backend, never changePassword
    b.close();
    c.close();
  });

  it('isReplayable rejects exactly the non-idempotent account methods', () => {
    for (const method of ['changePassword', 'regenerateRecoveryCode', 'rotateKeys', 'startOver', 'signUp', 'signInWithRecoveryCode', 'deleteAccount', 'signOut']) {
      expect(isReplayable({ op: 'sync', action: 'account', method: method as never, args: [] })).toBe(false);
    }
    expect(isReplayable({ op: 'sync', action: 'account', method: 'signIn', args: [] })).toBe(true);
    expect(isReplayable({ op: 'sync', action: 'account', method: 'resume', args: [] })).toBe(true);
    expect(isReplayable({ op: 'sync', action: 'api', method: 'info', args: [] })).toBe(true);
    expect(isReplayable(call('save'))).toBe(true);
  });

  it('the leader refuses hostReply arriving over the channel (bad_request) and never forwards it', async () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const log: string[] = [];
    const a = createUserDbNode({ nodeId: 'A', locks: locks.forTab(), createChannel: () => bus.create(), createBackend: () => fakeBackend('A', log) });
    await tick();
    const attacker = bus.create();
    const answers: unknown[] = [];
    attacker.addEventListener('message', (e) => answers.push(e.data));
    attacker.postMessage({ t: 'req', from: 'evil', id: 1, req: { op: 'hostReply', callId: 1, ok: true, value: 'forged' } });
    await tick();
    expect(answers).toContainEqual(expect.objectContaining({ t: 'res', to: 'evil', id: 1, ok: false, error: expect.objectContaining({ code: 'bad_request' }) }));
    expect(log).toEqual([]);
    // the leader's own client can still answer a host call
    await a.request({ op: 'hostReply', callId: 5, ok: true, value: 1 });
    expect(log).toEqual(['A:hostReply']);
    a.close();
  });
});
