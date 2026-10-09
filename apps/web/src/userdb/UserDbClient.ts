/**
 * Main-thread promise proxy for the user database. Nothing imports this yet (M1 ships no UI); the first
 * consumer will `await import('./userdb/UserDbClient')` so the worker and sqlite-wasm stay out of the entry chunk.
 */
import { UserDbError } from './errors';
import { createUserDbNode, type UserDbBackend, type UserDbNode, type UserDbNodeOptions } from './leader';
import type {
  UserDbEvent, UserDbRequest, UserDbRequestMessage, UserDbResponse, UserRepoName,
} from './protocol';

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

  constructor(options: Partial<UserDbNodeOptions> = {}) {
    this.node = createUserDbNode({
      createBackend: () =>
        createWorkerBackend(new Worker(new URL('./userDb.worker.ts', import.meta.url), { type: 'module' })),
      ...options,
    });
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
    return new Proxy({}, { get: (_t, method) => (typeof method === 'string' ? (...args: unknown[]) => this.call(name, method, ...args) : undefined) });
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
