/// <reference lib="webworker" />
/**
 * The user-DB worker. Owned by the leader tab only (see leader.ts); it holds the OPFS handle.
 * Messages in: `UserDbRequestMessage`. Messages out: `UserDbResponse` (has `id`) or `UserDbEvent` (has `event`).
 */
import { createUserDbHandler } from './handler';
import { openUserDb } from './openUserDb';
import type { UserDbEvent, UserDbRequestMessage, UserDbResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const handler = createUserDbHandler({
  open: openUserDb,
  emit: (event: UserDbEvent) => scope.postMessage(event),
});

scope.onmessage = (e: MessageEvent<UserDbRequestMessage>) => {
  const { id, ...req } = e.data;
  handler.handle(req).then(
    (value): UserDbResponse => ({ id, ok: true, value }),
    (error): UserDbResponse => ({ id, ok: false, error: handler.fail(error) }),
  ).then((res) => scope.postMessage(res));
};
