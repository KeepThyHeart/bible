/**
 * Main-thread `MemoryApi` over the user-DB worker: one method per `MEMORY_API_METHODS` key, each a `call('memory', …)`
 * through the lazily created client. `subscribe` listens for `memoryPush` events (leader and followers both get them).
 * Lazy chunk only (it imports the client).
 */
import { MEMORY_API_METHODS } from '@bible/memory/api';
import type { MemoryApi, MemoryPush } from '@bible/memory/api';
import { getUserDbClient, type UserDbClient } from '../../userdb/client';

export interface WebMemoryApi {
  api: MemoryApi;
  subscribe(listener: (push: MemoryPush) => void): () => void;
}

export function createWebMemoryApi(getClient: () => Promise<UserDbClient> = getUserDbClient): WebMemoryApi {
  const api = Object.fromEntries(
    MEMORY_API_METHODS.map((method) => [
      method,
      async (args?: unknown) => {
        const client = await getClient();
        return client.call('memory', method, ...(args === undefined ? [] : [args]));
      },
    ]),
  ) as unknown as MemoryApi;

  const subscribe = (listener: (push: MemoryPush) => void): (() => void) => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void getClient().then(
      (client) => {
        if (cancelled) return;
        off = client.onEvent((e) => {
          if (e.event === 'memoryPush') listener(e.push);
        });
      },
      () => undefined, // unsupported browser: the app shows the error from its first request
    );
    return () => {
      cancelled = true;
      off?.();
    };
  };

  return { api, subscribe };
}

let shared: WebMemoryApi | undefined;

/** The page's one instance. */
export function getWebMemoryApi(): WebMemoryApi {
  shared ??= createWebMemoryApi();
  return shared;
}
