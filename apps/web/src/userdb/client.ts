/**
 * The page's user-DB client singleton (lazy chunk only: entry code must `await import('../userdb/client')`).
 *
 * - `isUserDbSupported()`: Web Locks, BroadcastChannel, Worker and OPFS (`navigator.storage.getDirectory`) exist.
 *   Without them a tab never becomes leader and requests would hang (design finding 11), so callers fall back.
 * - `getUserDbClient()`: one client per page; the first `open` must answer within 10 s, else the promise rejects with
 *   `UserDbError{code:'open_timeout'}` (or `'unsupported'`), the client is closed and the next call tries again.
 * - `registerHostApi(name, impl)`: main-thread APIs the worker may call while this tab leads (`hostCall`).
 */
import { UserDbError } from './errors';
import type { HostApiName } from './protocol';
import { UserDbClient, type HostApiImpl } from './UserDbClient';

export type { UserDbClient };

export const OPEN_TIMEOUT_MS = 10_000;

export type HostApi = Record<string, (...args: unknown[]) => Promise<unknown>>;

const hostApis = new Map<HostApiName, HostApi>();
let clientPromise: Promise<UserDbClient> | undefined;
let testOptions: { create?: () => UserDbClient; openTimeoutMs?: number } = {};

export function isUserDbSupported(): boolean {
  const g = globalThis as unknown as {
    navigator?: { locks?: unknown; storage?: { getDirectory?: unknown } };
    BroadcastChannel?: unknown;
    Worker?: unknown;
  };
  return Boolean(
    g.navigator?.locks
      && typeof g.BroadcastChannel === 'function'
      && typeof g.Worker === 'function'
      && typeof g.navigator.storage?.getDirectory === 'function',
  );
}

function lookupHostApi(name: HostApiName): HostApiImpl | undefined {
  return hostApis.get(name) as HostApiImpl | undefined;
}

export function getUserDbClient(): Promise<UserDbClient> {
  clientPromise ??= start().catch((e) => {
    clientPromise = undefined; // let a later call retry
    throw e;
  });
  return clientPromise;
}

async function start(): Promise<UserDbClient> {
  if (!testOptions.create && !isUserDbSupported()) {
    throw new UserDbError({ name: 'UserDbError', message: 'The local user database is not supported in this browser', code: 'unsupported' });
  }
  const client = testOptions.create ? testOptions.create() : new UserDbClient({ hostApis: lookupHostApi });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new UserDbError({ name: 'UserDbError', message: 'The local user database did not open in time', code: 'open_timeout' })),
      testOptions.openTimeoutMs ?? OPEN_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([client.open(), timeout]);
    return client;
  } catch (e) {
    client.close();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Register a host API for the worker (`hostCall`); dispose with the returned function. The latest registration wins. */
export function registerHostApi(name: HostApiName, impl: HostApi): () => void {
  hostApis.set(name, impl);
  return () => {
    if (hostApis.get(name) === impl) hostApis.delete(name);
  };
}

/** Close the singleton and forget host APIs. `options.create` replaces the real client (tests pass a fake backend). */
export function resetUserDbClientForTests(options: { create?: () => UserDbClient; openTimeoutMs?: number } = {}): void {
  const old = clientPromise;
  clientPromise = undefined;
  old?.then((c) => c.close(), () => undefined);
  hostApis.clear();
  testOptions = options;
}

/** For tests that build their own `UserDbClient`: the lookup the singleton uses. */
export const hostApiLookupForTests = lookupHostApi;
