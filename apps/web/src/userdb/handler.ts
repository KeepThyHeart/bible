/**
 * The request handler behind the worker, kept free of `self`/Worker so tests can drive it directly.
 * `open` is memoised; `call` dispatches to a core repository; sync/backup/import are delegated to optional
 * extensions (later waves wire the sync engine in) and answer `not_implemented` until then.
 */
import type { Sync } from '@bible/core/browser';
import { toWireError, type WireError } from './errors';
import type { OpenedUserDb } from './openUserDb';
import type { UserDbEvent, UserDbRequest } from './protocol';
import { createRepos, isReadMethod, REPO_TABLES, type RepoBag } from './repos';

export interface HandlerExtensions {
  sync?(req: Extract<UserDbRequest, { op: 'sync' }>, ctx: { sql: Sync.ISql }): Promise<unknown>;
  backup?(req: Extract<UserDbRequest, { op: 'backup' }>, ctx: { sql: Sync.ISql }): Promise<unknown>;
  import?(req: Extract<UserDbRequest, { op: 'import' }>, ctx: { sql: Sync.ISql }): Promise<unknown>;
}

export class UserDbHandlerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UserDbError';
  }
}

export function createUserDbHandler(opts: {
  open: () => Promise<OpenedUserDb>;
  emit: (event: UserDbEvent) => void;
  extensions?: HandlerExtensions;
}): { handle(req: UserDbRequest): Promise<unknown>; fail(error: unknown): WireError } {
  let opened: Promise<OpenedUserDb> | undefined;
  let repos: RepoBag | undefined;

  const ensure = async (): Promise<{ db: OpenedUserDb; repos: RepoBag }> => {
    opened ??= opts.open().catch((e) => {
      opened = undefined; // let the next request retry
      throw e;
    });
    const db = await opened;
    repos ??= createRepos(db.sql);
    return { db, repos };
  };

  async function handle(req: UserDbRequest): Promise<unknown> {
    switch (req.op) {
      case 'open':
        await ensure();
        return null;
      case 'call': {
        const { repos: bag } = await ensure();
        const repo = bag[req.repo] as Record<string, unknown> | undefined;
        if (!repo) throw new UserDbHandlerError('unknown_repo', `Unknown user repository: ${req.repo}`);
        const fn = req.method.startsWith('_') ? undefined : repo[req.method];
        if (typeof fn !== 'function') {
          throw new UserDbHandlerError('unknown_method', `Unknown method ${req.repo}.${req.method}`);
        }
        const value = await (fn as (...a: unknown[]) => unknown).apply(repo, req.args);
        if (!isReadMethod(req.method)) opts.emit({ event: 'changed', tables: REPO_TABLES[req.repo] ?? [] });
        return value === undefined ? null : value;
      }
      case 'sync':
      case 'backup':
      case 'import': {
        const { db } = await ensure();
        const ext = opts.extensions?.[req.op] as ((r: UserDbRequest, c: { sql: Sync.ISql }) => Promise<unknown>) | undefined;
        if (!ext) throw new UserDbHandlerError('not_implemented', `${req.op} is not available yet`);
        return ext(req, { sql: db.sql });
      }
      case 'wipe': {
        if (opened) {
          const db = await opened;
          await db.wipe();
        }
        opened = undefined;
        repos = undefined;
        opts.emit({ event: 'changed', tables: Object.values(REPO_TABLES).flat() as string[] });
        return null;
      }
      default:
        throw new UserDbHandlerError('bad_request', `Unknown op: ${(req as { op?: string }).op}`);
    }
  }

  return { handle, fail: toWireError };
}
