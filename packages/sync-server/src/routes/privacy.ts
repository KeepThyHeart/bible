/**
 * Data export and account deletion (contracts §7, W2-C): GET export | DELETE account. Export is everything the
 * server holds for the account (never the hashes, which are not the user's data). Deletion needs a valid auth
 * key on top of the session, then removes every row of the account.
 */
import { Router } from 'express';
import type { Sync } from '@bible/core';
import { ApiHttpError, authOf, clearSessionCookie, handler, requireSession, type ServerContext } from '../http';
import { checkAuthKey } from '../auth/tokens';
import { authFail, authGate } from '../auth/gate';
import { enforceLimit } from '../rateLimit';
import * as v from '../auth/validate';
import { deviceWire } from './devices';

/** Blob bytes held in memory per export page. */
const EXPORT_PAGE_BYTES = 4 * 1024 * 1024;

export function privacyRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store, opts } = ctx;

  // Streams the export page by page (never one giant string or the whole record set in memory); the JSON is
  // the same ServerExport document as before. At most 3 per hour per account.
  r.get('/export', requireSession(ctx), handler(async (_req, res) => {
    const { account, session } = authOf(res);
    enforceLimit(ctx.limiter, 'export', account.id);
    const head: Omit<Sync.ServerExport, 'records'> = {
      format: 'kth-sync-export', version: 1,
      account: {
        accountId: account.id, email: account.email, emailVerified: account.emailVerified,
        bytesUsed: account.bytesUsed, quotaBytes: account.quotaBytes ?? opts.quotaBytes,
        createdAt: new Date(account.createdAt).toISOString(), recordCount: store.records.count(account.id),
        kdf: account.kdf,
      },
      devices: store.devices.listDetailed(account.id).map((d) => deviceWire(d, session.deviceId)),
      keysets: store.keysets.list(account.id),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="sync-export.json"');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const write = async (chunk: string): Promise<void> => {
      if (!res.write(chunk)) await new Promise<void>((resolve) => { res.once('drain', resolve); res.once('close', resolve); });
    };
    try {
      await write(`${JSON.stringify(head).slice(0, -1)},"records":[`);
      let since = 0;
      let first = true;
      for (;;) {
        const page = store.records.changesPage(account.id, since, 100, EXPORT_PAGE_BYTES);
        for (const rec of page.records) {
          await write(`${first ? '' : ','}${JSON.stringify(rec)}`);
          first = false;
        }
        if (!page.more || page.records.length === 0) break;
        since = page.records[page.records.length - 1].seq;
        if (res.destroyed) return;
      }
      res.end(']}');
    } catch (e) {
      // Headers are out already: cut the connection so the client sees a truncated, invalid document.
      res.destroy();
      opts.log('error', 'sync-server: export failed', { name: (e as Error)?.name });
    }
  }));

  r.delete('/account', requireSession(ctx), handler((req, res) => {
    const { account } = authOf(res);
    const body = v.obj(req.body);
    authGate(ctx, req, account.email);
    if (!checkAuthKey(body.authKey, account.authHash)) {
      authFail(ctx, req, account.email);
      throw new ApiHttpError(403, 'forbidden', 'Key is incorrect');
    }
    store.accounts.delete(account.id); // records, keysets, devices, sessions, tokens: one transaction
    clearSessionCookie(ctx, res);
    opts.log('info', 'sync-server: account deleted', { accountId: account.id });
    res.status(204).end();
  }));

  return r;
}
