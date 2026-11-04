/**
 * Test harness for the user-data mirror (S1): a client-shaped object over an in-process `createUserDbHandler` on an
 * in-memory sqlite-wasm database, the same arrangement as `handler.test.ts`. Arguments and results go through
 * `structuredClone` like `postMessage`, and events arrive asynchronously. Tests only.
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createUserDbHandler, type HandlerExtensions } from './handler';
import { finishOpen } from './openUserDb';
import type { UserDbEvent, UserDbRequest, UserRepoName } from './protocol';

export type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
export const loadSqlite = () => sqlite3InitModule();

export function createInProcessClient(sqlite3: Sqlite3, extensions?: HandlerExtensions) {
  const listeners = new Set<(e: UserDbEvent) => void>();
  let current: ReturnType<typeof finishOpen> | undefined;
  const handler = createUserDbHandler({
    open: async () => (current = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:')),
    emit: (e) => queueMicrotask(() => [...listeners].forEach((cb) => cb(structuredClone(e)))),
    extensions,
  });
  const request = async (req: UserDbRequest): Promise<unknown> => {
    try {
      return structuredClone(await handler.handle(structuredClone(req)));
    } catch (e) {
      throw Object.assign(new Error(handler.fail(e).message), handler.fail(e));
    }
  };
  return {
    handler,
    /** The worker-side ISql (after the first request), for raw inserts that stand in for sync pulls. */
    sql: () => current!.sql,
    request,
    call: <T = unknown>(repo: UserRepoName, method: string, ...args: unknown[]) =>
      request({ op: 'call', repo, method, args }) as Promise<T>,
    onEvent: (cb: (e: UserDbEvent) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
