/**
 * The request handler behind the worker, kept free of `self`/Worker so tests can drive it directly.
 * `open` is memoised; `call` dispatches to a repository from `repos.ts` (created lazily, per repo, on first use);
 * sync/backup/import are delegated to optional extensions and answer `not_implemented` without one.
 *
 * Worker -> main thread calls (`hostCall`, M3): `ctx.hostCall(api, method, args)` emits a `hostCall` event (the
 * leader tab's main thread runs it; leader.ts never broadcasts it) and waits for `{op:'hostReply'}` with the same
 * `callId`, or fails with `host_timeout` after `hostTimeoutMs` (30 s).
 */
import type { Sync } from '@bible/core/browser';
import { toWireError, type WireError } from './errors';
import type { OpenedUserDb } from './openUserDb';
import type { HostApiName, UserDbEvent, UserDbRequest } from './protocol';
import { createRepos, disposeRepos, isChangeFreeCall, REPO_TABLES, type RepoBag } from './repos';

/** Calls a main-thread host API (leader tab) from the worker. */
export type HostCall = (api: HostApiName, method: string, args: unknown[]) => Promise<unknown>;

/** What an extension (sync, backup, import) gets with each request. */
export interface ExtCtx {
  sql: Sync.ISql;
  emit(event: UserDbEvent): void;
  /** Close and delete the OPFS database (as `{op:'wipe'}`), run `onWipe`, reset repos, emit `changed` for every table. */
  wipe(): Promise<void>;
  hostCall: HostCall;
}

/** What `createRepos` passes to repos that need more than SQL (memory). */
export interface RepoCtx {
  emit(event: UserDbEvent): void;
  hostCall: HostCall;
}

export interface HandlerExtensions {
  sync?(req: Extract<UserDbRequest, { op: 'sync' }>, ctx: ExtCtx): Promise<unknown>;
  backup?(req: Extract<UserDbRequest, { op: 'backup' }>, ctx: ExtCtx): Promise<unknown>;
  import?(req: Extract<UserDbRequest, { op: 'import' }>, ctx: ExtCtx): Promise<unknown>;
}

export interface UserDbHandlerOptions {
  open: () => Promise<OpenedUserDb>;
  emit: (event: UserDbEvent) => void;
  extensions?: HandlerExtensions;
  /** After a successful writing `call` (and after `import`), with the tables the repo writes. Errors are swallowed. */
  onLocalWrite?(tables: string[]): void;
  /** After the OPFS files are gone (wipe op or `ctx.wipe()`): the worker deletes the IndexedDB stores here. */
  onWipe?(): Promise<void> | void;
  /** Timeout for a `hostCall` round trip. Default 30 000 ms. */
  hostTimeoutMs?: number;
}

export class UserDbHandlerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UserDbError';
  }
}

export const HOST_CALL_TIMEOUT_MS = 30_000;

export function createUserDbHandler(opts: UserDbHandlerOptions): {
  handle(req: UserDbRequest): Promise<unknown>;
  fail(error: unknown): WireError;
} {
  let opened: Promise<OpenedUserDb> | undefined;
  let repos: RepoBag | undefined;
  let nextCallId = 1;
  const hostPending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> }>();

  const hostCall: HostCall = (api, method, args) =>
    new Promise((resolve, reject) => {
      const callId = nextCallId++;
      const timer = setTimeout(() => {
        hostPending.delete(callId);
        reject(new UserDbHandlerError('host_timeout', `Host call ${api}.${method} timed out`));
      }, opts.hostTimeoutMs ?? HOST_CALL_TIMEOUT_MS);
      hostPending.set(callId, { resolve, reject, timer });
      opts.emit({ event: 'hostCall', callId, api, method, args });
    });

  const repoCtx: RepoCtx = { emit: opts.emit, hostCall };

  const ensure = async (): Promise<{ db: OpenedUserDb; repos: RepoBag }> => {
    opened ??= opts.open().catch((e) => {
      opened = undefined; // let the next request retry
      throw e;
    });
    const db = await opened;
    repos ??= createRepos(db.sql, repoCtx);
    return { db, repos };
  };

  const notifyLocalWrite = (tables: string[]) => {
    try {
      opts.onLocalWrite?.(tables);
    } catch {
      // a scheduling hiccup in sync must not fail the write that already committed
    }
  };

  async function wipe(): Promise<void> {
    if (repos) disposeRepos(repos);
    repos = undefined;
    if (opened) {
      const pending = opened;
      opened = undefined;
      const db = await pending.catch(() => undefined);
      if (db) await db.wipe();
    }
    await opts.onWipe?.();
    opts.emit({ event: 'changed', tables: Object.values(REPO_TABLES).flat() as string[] });
  }

  const extCtx = (sql: Sync.ISql): ExtCtx => ({ sql, emit: opts.emit, wipe, hostCall });

  async function handle(req: UserDbRequest): Promise<unknown> {
    switch (req.op) {
      case 'open':
        await ensure();
        return null;
      case 'call': {
        const { repos: bag } = await ensure();
        // Own properties only (repos are lazy getters on the bag), so `toString`/`__proto__` are never a repo.
        const repo = (Object.prototype.hasOwnProperty.call(bag, req.repo) ? bag[req.repo] : undefined) as
          | Record<string, unknown>
          | undefined;
        if (!repo) throw new UserDbHandlerError('unknown_repo', `Unknown user repository: ${req.repo}`);
        const fn = req.method.startsWith('_') || req.method in Object.prototype ? undefined : repo[req.method];
        if (typeof fn !== 'function') {
          throw new UserDbHandlerError('unknown_method', `Unknown method ${req.repo}.${req.method}`);
        }
        const value = await (fn as (...a: unknown[]) => unknown).apply(repo, req.args);
        if (!isChangeFreeCall(req.repo, req.method)) {
          const tables = REPO_TABLES[req.repo] ?? [];
          opts.emit({ event: 'changed', tables });
          notifyLocalWrite(tables);
        }
        return value === undefined ? null : value;
      }
      case 'sync':
      case 'backup':
      case 'import': {
        const { db } = await ensure();
        const ext = opts.extensions?.[req.op] as ((r: UserDbRequest, c: ExtCtx) => Promise<unknown>) | undefined;
        if (!ext) throw new UserDbHandlerError('not_implemented', `${req.op} is not available yet`);
        const value = await ext(req, extCtx(db.sql));
        if (req.op === 'import') notifyLocalWrite(REPO_TABLES.userDataMirror ?? []);
        return value;
      }
      case 'wipe':
        await wipe();
        return null;
      case 'hostReply': {
        const p = hostPending.get(req.callId);
        if (!p) return null; // late (timed out) or duplicate reply
        hostPending.delete(req.callId);
        clearTimeout(p.timer);
        if (req.ok) p.resolve(req.value);
        else p.reject(new UserDbHandlerError(req.error.code ?? 'host_error', req.error.message));
        return null;
      }
      default:
        throw new UserDbHandlerError('bad_request', `Unknown op: ${(req as { op?: string }).op}`);
    }
  }

  return { handle, fail: toWireError };
}
