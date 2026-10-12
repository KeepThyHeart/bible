/**
 * The worker's sync host (S4, design §6): `{op:'sync'}` requests (configure/account/api/status/syncNow) over
 * SyncApiClient + AccountClient + SyncEngine, and local-write notifications for push scheduling.
 * Security: every `account` result is sanitised to `AccountResult` (never keys); errors never carry passwords or keys.
 * STUB (C3): signatures only; S4 fills the bodies. No side effects at module load.
 */
import type { Sync } from '@bible/core/browser';
import type { ExtCtx } from '../handler';
import type { UserDbRequest } from '../protocol';

export interface SyncHost {
  handle(req: Extract<UserDbRequest, { op: 'sync' }>, ctx: ExtCtx): Promise<unknown>;
  notifyLocalChange(tables: string[]): void;
}

export interface SyncHostOptions {
  fetch: typeof fetch;
  indexedDB: IDBFactory;
  origin: string;
  now?: () => number;
  timers?: Sync.SyncTimers;
  online?: EventTarget;
}

export function createSyncHost(o: SyncHostOptions): SyncHost {
  void o;
  return {
    async handle() {
      throw new Error('not implemented');
    },
    notifyLocalChange() {
      // S4: schedule a push unless every table is untracked
    },
  };
}
