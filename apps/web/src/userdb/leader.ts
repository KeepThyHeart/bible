/**
 * One tab owns the OPFS database. Every tab queues for the exclusive Web Lock 'kth-userdb'; the holder is the
 * leader and runs the backend (the worker). Followers send their requests to the leader over
 * BroadcastChannel 'kth-userdb' and get answers and events back the same way. When the leader's tab closes
 * the lock passes to the next queued tab, which announces itself ('hello'); followers then re-send whatever
 * they were still waiting on (a request that was mid-flight on the old leader is therefore retried, so call
 * sites should treat a repeat of a write as possible: repository writes are keyed upserts). Non-idempotent account
 * operations are not retried: they reject with code `leader_changed` (see `isReplayable`).
 *
 * `locks`, `BroadcastChannel` and the backend are injected so tests can fake them; the defaults are the
 * browser globals. No globals are touched at import time.
 */
import { toWireError, UserDbError, type WireError } from './errors';
import type { UserDbEvent, UserDbRequest } from './protocol';

export const LOCK_NAME = 'kth-userdb';
export const CHANNEL_NAME = 'kth-userdb';

/** What the leader drives: the real one wraps the Worker; tests pass a fake. */
export interface UserDbBackend {
  send(req: UserDbRequest): Promise<unknown>;
  onEvent(cb: (event: UserDbEvent) => void): () => void;
  terminate(): void;
}

export interface LocksLike {
  request(name: string, options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<unknown>): Promise<unknown>;
}

export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  close(): void;
}

type ChannelMessage =
  | { t: 'req'; from: string; id: number; req: UserDbRequest }
  | { t: 'res'; to: string; id: number; ok: true; value: unknown }
  | { t: 'res'; to: string; id: number; ok: false; error: WireError }
  | { t: 'evt'; evt: UserDbEvent }
  | { t: 'hello'; from: string };

/** Backend events that stay in the leader tab: `hostCall` (worker -> leader main thread) is never posted on the channel. */
export function isLocalOnlyEvent(evt: UserDbEvent): boolean {
  return evt.event === 'hostCall';
}

/** Account methods whose repeat is harmful (a completed change must not run twice); `signIn` and `resume` are safe. */
const NON_REPLAYABLE_ACCOUNT_METHODS = new Set([
  'changePassword', 'regenerateRecoveryCode', 'rotateKeys', 'startOver', 'signUp', 'signInWithRecoveryCode', 'deleteAccount', 'signOut',
]);

/**
 * Whether a follower may re-send `req` to a new leader. A non-idempotent account operation that may have completed on
 * the old leader (its answer died with that tab) is rejected with `leader_changed` instead, so the user checks the
 * account rather than the password crossing the channel again and the operation running twice.
 */
export function isReplayable(req: UserDbRequest): boolean {
  return !(req.op === 'sync' && req.action === 'account' && NON_REPLAYABLE_ACCOUNT_METHODS.has(String(req.method)));
}

export interface UserDbNodeOptions {
  createBackend: () => UserDbBackend;
  locks?: LocksLike;
  createChannel?: (name: string) => ChannelLike;
  /** Unique per tab; defaults to a random string. */
  nodeId?: string;
}

export interface UserDbNode {
  request(req: UserDbRequest): Promise<unknown>;
  onEvent(cb: (event: UserDbEvent) => void): () => void;
  isLeader(): boolean;
  /** Give up leadership (releases the lock, stops the backend) and stop listening. */
  close(): void;
}

export function createUserDbNode(options: UserDbNodeOptions): UserDbNode {
  const nodeId = options.nodeId ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const locks = options.locks ?? (globalThis.navigator as unknown as { locks?: LocksLike } | undefined)?.locks;
  const channel = (options.createChannel ?? ((n) => new BroadcastChannel(n) as unknown as ChannelLike))(CHANNEL_NAME);
  const listeners = new Set<(event: UserDbEvent) => void>();
  const pending = new Map<number, { req: UserDbRequest; resolve(v: unknown): void; reject(e: unknown): void }>();
  const inFlight = new Set<string>(); // leader: `${from}:${id}` being served, to ignore re-sent duplicates
  let nextId = 1;
  let leader = false;
  let closed = false;
  let backend: UserDbBackend | undefined;
  let backendReady: Promise<UserDbBackend> | undefined;
  let releaseLock: (() => void) | undefined;

  const emitLocal = (event: UserDbEvent) => listeners.forEach((cb) => cb(event));
  const post = (m: ChannelMessage) => channel.postMessage(m);

  function serve(req: UserDbRequest): Promise<unknown> {
    return (backendReady as Promise<UserDbBackend>).then((b) => b.send(req));
  }

  channel.addEventListener('message', (e) => {
    const m = e.data as ChannelMessage;
    if (!m || closed) return;
    if (m.t === 'req' && leader) {
      // `hostReply` is only ever valid from this tab's own client (it answers a hostCall that never leaves the leader).
      if ((m.req as { op?: string } | undefined)?.op === 'hostReply') {
        post({ t: 'res', to: m.from, id: m.id, ok: false, error: { name: 'Error', message: 'hostReply is not accepted from the channel', code: 'bad_request' } });
        return;
      }
      const key = `${m.from}:${m.id}`;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      serve(m.req).then(
        (value) => post({ t: 'res', to: m.from, id: m.id, ok: true, value }),
        (error) => post({ t: 'res', to: m.from, id: m.id, ok: false, error: toWireError(error) }),
      ).finally(() => inFlight.delete(key));
    } else if (m.t === 'res' && m.to === nodeId) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new UserDbError(m.error));
    } else if (m.t === 'evt' && !leader) {
      if (isLocalOnlyEvent(m.evt)) return; // defence in depth: a follower never acts on a broadcast hostCall
      emitLocal(m.evt);
    } else if (m.t === 'hello' && !leader && m.from !== nodeId) {
      // New leader: whatever we still wait on may have died with the old one.
      for (const [id, p] of pending) {
        if (isReplayable(p.req)) {
          post({ t: 'req', from: nodeId, id, req: p.req });
        } else {
          pending.delete(id);
          p.reject(new UserDbError({ name: 'Error', message: 'The sync host changed while this was running; check your account and try again', code: 'leader_changed' }));
        }
      }
    }
  });

  function becomeLeader(): Promise<void> {
    leader = true;
    const b = options.createBackend();
    backend = b;
    backendReady = Promise.resolve(b);
    b.onEvent((evt) => {
      emitLocal(evt);
      // A worker -> main-thread call is for the leader tab only (it may carry user text): never broadcast it.
      if (isLocalOnlyEvent(evt)) return;
      post({ t: 'evt', evt });
    });
    emitLocal({ event: 'leader', isLeader: true });
    post({ t: 'hello', from: nodeId });
    // Our own queued requests go straight to the backend.
    for (const [id, p] of pending) {
      pending.delete(id);
      serve(p.req).then(p.resolve, (e) => p.reject(new UserDbError(toWireError(e))));
    }
    // Hold the lock until close().
    return new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
  }

  if (locks) {
    locks.request(LOCK_NAME, { mode: 'exclusive' }, async () => {
      if (closed) return;
      await becomeLeader();
    }).catch(() => undefined);
  }

  return {
    request(req) {
      if (closed) return Promise.reject(new UserDbError({ name: 'Error', message: 'user DB node is closed', code: 'closed' }));
      if (leader) return serve(req).catch((e) => Promise.reject(e instanceof UserDbError ? e : new UserDbError(toWireError(e))));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { req, resolve, reject });
        post({ t: 'req', from: nodeId, id, req });
      });
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isLeader: () => leader,
    close() {
      if (closed) return;
      closed = true;
      const wasLeader = leader;
      leader = false;
      backend?.terminate();
      backend = undefined;
      releaseLock?.();
      channel.close();
      for (const p of pending.values()) p.reject(new UserDbError({ name: 'Error', message: 'user DB node closed', code: 'closed' }));
      pending.clear();
      if (wasLeader) emitLocal({ event: 'leader', isLeader: false });
    },
  };
}
