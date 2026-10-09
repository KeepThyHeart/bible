/**
 * Data export and account deletion (contracts §7, W2-C): GET export | DELETE account. Export is everything the
 * server holds for the account (never the hashes, which are not the user's data). Deletion needs a valid auth
 * key on top of the session, then removes every row of the account.
 */
import { Router } from 'express';
import type { Sync } from '@bible/core';
import { ApiHttpError, authOf, clearSessionCookie, handler, requireSession, type ServerContext } from '../http';
import { checkAuthKey } from '../auth/tokens';
import { enforceLimit } from '../rateLimit';
import * as v from '../auth/validate';
import { deviceWire } from './devices';

export function privacyRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store, opts } = ctx;

  r.get('/export', requireSession(ctx), (_req, res) => {
    const { account, session } = authOf(res);
    const body: Sync.ServerExport = {
      format: 'kth-sync-export', version: 1,
      account: {
        accountId: account.id, email: account.email, emailVerified: account.emailVerified,
        bytesUsed: account.bytesUsed, quotaBytes: account.quotaBytes ?? opts.quotaBytes,
        createdAt: new Date(account.createdAt).toISOString(), recordCount: store.records.count(account.id),
        kdf: account.kdf,
      },
      devices: store.devices.listDetailed(account.id).map((d) => deviceWire(d, session.deviceId)),
      keysets: store.keysets.list(account.id),
      records: store.records.changes(account.id, 0, Number.MAX_SAFE_INTEGER),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="sync-export.json"');
    res.json(body);
  });

  r.delete('/account', requireSession(ctx), handler((req, res) => {
    const { account } = authOf(res);
    const body = v.obj(req.body);
    enforceLimit(ctx.limiter, 'emailAuth', account.email);
    if (!checkAuthKey(body.authKey, account.authHash)) {
      throw new ApiHttpError(403, 'forbidden', 'Key is incorrect');
    }
    store.accounts.delete(account.id); // records, keysets, devices, sessions, tokens: one transaction
    clearSessionCookie(ctx, res);
    opts.log('info', 'sync-server: account deleted', { accountId: account.id });
    res.status(204).end();
  }));

  return r;
}
