/// <reference lib="webworker" />
/**
 * The user-DB worker. Owned by the leader tab only (see leader.ts); it holds the OPFS handle.
 * Messages in: `UserDbRequestMessage`. Messages out: `UserDbResponse` (has `id`) or `UserDbEvent` (has `event`).
 * Extensions (M3): `sync` = the sync host (S4), `import` = the one-shot `kth-user-data` copy (S1). After a wipe the
 * IndexedDB stores `kth-secrets` and `kth-user-data` are deleted too.
 */
import { createUserDbHandler } from './handler';
import { importKthUserData } from './importKthUserData';
import { openUserDb } from './openUserDb';
import type { UserDbEvent, UserDbRequestMessage, UserDbResponse } from './protocol';
import { createSyncHost } from './sync/syncHost';
import { wipeBrowserStores } from './wipeStores';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const sync = createSyncHost({ fetch: scope.fetch.bind(scope), indexedDB: scope.indexedDB, origin: scope.location.origin });

const handler = createUserDbHandler({
  open: openUserDb,
  emit: (event: UserDbEvent) => scope.postMessage(event),
  extensions: { sync: (req, ctx) => sync.handle(req, ctx), import: importKthUserData },
  onLocalWrite: (tables) => sync.notifyLocalChange(tables),
  onWipe: () => wipeBrowserStores(scope.indexedDB),
});

scope.onmessage = (e: MessageEvent<UserDbRequestMessage>) => {
  const { id, ...req } = e.data;
  handler.handle(req).then(
    (value): UserDbResponse => ({ id, ok: true, value }),
    (error): UserDbResponse => ({ id, ok: false, error: handler.fail(error) }),
  ).then((res) => scope.postMessage(res));
};
