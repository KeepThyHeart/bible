/**
 * Main-thread promise proxy for the user database. App code gets the singleton from `client.ts`
 * (`await import('../userdb/client')`), so the worker and sqlite-wasm stay out of the entry chunk.
 *
 * Host APIs (M3): the worker may call back into the leader tab's main thread (`hostCall` event, leader only, never
 * broadcast). The client runs `hostApis(api)[method](...args)` and answers with `{op:'hostReply'}`.
 */
import { toWireError, UserDbError } from './errors';
import { createUserDbNode, type UserDbBackend, type UserDbNode, type UserDbNodeOptions } from './leader';
import type {
  HostApiName, UserDbEvent, UserDbRequest, UserDbRequestMessage, UserDbResponse, UserRepoName,
} from './protocol';

/** A main-thread API the worker may call (`registerHostApi` in client.ts). */
export type HostApiImpl = Record<string, (...args: unknown[]) => unknown>;
export type HostApiLookup = (name: HostApiName) => Promise<HostApiImpl | undefined> | HostApiImpl | undefined;

export interface UserDbClientOptions extends Partial<UserDbNodeOptions> {
  hostApis?: HostApiLookup;
}

/** The real backend: a dedicated module worker with request ids. */
export function createWorkerBackend(worker: Worker): UserDbBackend {
  let nextId = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  const listeners = new Set<(e: UserDbEvent) => void>();
  worker.onmessage = (e: MessageEvent<UserDbResponse | UserDbEvent>) => {
    const m = e.data;
    if ('event' in m) {
      listeners.forEach((cb) => cb(m));
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(new UserDbError(m.error));
  };
  return {
    send(req) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ ...req, id } as UserDbRequestMessage);
      });
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    terminate() {
      worker.terminate();
      for (const p of pending.values()) p.reject(new UserDbError({ name: 'Error', message: 'worker terminated', code: 'closed' }));
      pending.clear();
    },
  };
}

export class UserDbClient {
  private readonly node: UserDbNode;

  private readonly hostApis?: HostApiLookup;

  constructor(options: UserDbClientOptions = {}) {
    const { hostApis, ...nodeOptions } = options;
    this.hostApis = hostApis;
    this.node = createUserDbNode({
      createBackend: () =>
        createWorkerBackend(new Worker(new URL('./userDb.worker.ts', import.meta.url), { type: 'module' })),
      ...nodeOptions,
    });
    this.node.onEvent((event) => {
      if (event.event === 'hostCall') void this.answerHostCall(event);
    });
  }

  /** Runs a worker -> main-thread call (only the leader tab receives one) and replies; never throws. */
  private async answerHostCall(call: Extract<UserDbEvent, { event: 'hostCall' }>): Promise<void> {
    if (!this.node.isLeader()) return;
    let reply: Extract<UserDbRequest, { op: 'hostReply' }>;
    try {
      const impl = await this.hostApis?.(call.api);
      const fn = impl && Object.prototype.hasOwnProperty.call(impl, call.method) ? impl[call.method] : undefined;
      if (typeof fn !== 'function') {
        reply = {
          op: 'hostReply', callId: call.callId, ok: false,
          error: { name: 'UserDbError', message: `Host API ${call.api}.${call.method} is not available`, code: 'host_api_unavailable' },
        };
      } else {
        const value = await fn.apply(impl, Array.isArray(call.args) ? call.args : []);
        reply = { op: 'hostReply', callId: call.callId, ok: true, value: value === undefined ? null : value };
      }
    } catch (e) {
      reply = { op: 'hostReply', callId: call.callId, ok: false, error: toWireError(e) };
    }
    try {
      await this.node.request(reply);
    } catch (e) {
      // A value that cannot be cloned: report it; if the worker went away (leader change, close) this fails too and
      // the worker's pending call times out on its side.
      if (reply.ok) {
        await this.node.request({ op: 'hostReply', callId: call.callId, ok: false, error: toWireError(e) }).catch(() => undefined);
      }
    }
  }

  request(req: UserDbRequest): Promise<unknown> {
    return this.node.request(req);
  }

  open(): Promise<void> {
    return this.node.request({ op: 'open' }).then(() => undefined);
  }

  call<T = unknown>(repo: UserRepoName, method: string, ...args: unknown[]): Promise<T> {
    return this.node.request({ op: 'call', repo, method, args }) as Promise<T>;
  }

  /** A typed-by-the-caller facade: `client.repo<IUserNoteRepository>('notes').getAll()` returns promises. */
  repo(name: UserRepoName): Record<string, (...args: unknown[]) => Promise<unknown>> {
    // `then` (Promise resolution probes it when the proxy is awaited or returned from an async function), `toJSON` and
    // every Object.prototype name are not repo methods: answer undefined instead of a remote call.
    return new Proxy({}, {
      get: (_t, method) =>
        typeof method === 'string' && method !== 'then' && method !== 'toJSON' && !(method in Object.prototype)
          ? (...args: unknown[]) => this.call(name, method, ...args)
          : undefined,
    });
  }

  wipe(): Promise<void> {
    return this.node.request({ op: 'wipe' }).then(() => undefined);
  }

  onEvent(cb: (event: UserDbEvent) => void): () => void {
    return this.node.onEvent(cb);
  }

  isLeader(): boolean {
    return this.node.isLeader();
  }

  close(): void {
    this.node.close();
  }
}
