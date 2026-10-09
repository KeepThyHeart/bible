/**
 * Email flows (contracts §7, W2-D): POST verify-email | reset | reset/confirm. Tokens are 32 random bytes,
 * stored only as SHA-256, single use (consumed on first presentation, valid or not past expiry), 24 h for
 * verification and 1 h for reset. `reset/confirm` re-keys the account to the client's new accountId. Registers the verification mail on `ctx.onAccountCreated`.
 *
 * Enumeration: `reset` answers 204 and takes the same rate-limit hits whether or not the address has an account;
 * the mail (when there is an account) is started but not awaited.
 */
import { Router } from 'express';
import { ApiHttpError, clientIp, handler, type ServerContext } from '../http';
import { enforceLimit } from '../rateLimit';
import { issueSession } from '../auth/sessions';
import { b64urlToBytes, hashPresentedToken, newToken, sha256 } from '../auth/tokens';
import * as v from '../auth/validate';
import {
  RESET_TOKEN_TTL_MS, VERIFY_TOKEN_TTL_MS, dispatchMail, resetMail, verifyMail,
} from '../email/messages';
import type { AccountRow } from '../store/SyncStore';

const BAD_LINK = 'This link is invalid or has expired';

export function emailFlowRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store, opts } = ctx;

  function issueTokenMail(account: AccountRow, purpose: 'verify' | 'reset'): void {
    const { token, hash } = newToken(opts.random);
    const ttl = purpose === 'verify' ? VERIFY_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS;
    store.transaction(() => {
      store.emailTokens.deleteForAccount(account.id, purpose);
      store.emailTokens.create({ tokenHash: hash, accountId: account.id, purpose, expiresAt: opts.now() + ttl });
    });
    dispatchMail(ctx, purpose === 'verify'
      ? verifyMail(account.email, opts.publicUrl, token)
      : resetMail(account.email, opts.publicUrl, token));
  }

  // Signup sends the verification mail. A failure is the listener's problem to log, never the signup's.
  ctx.onAccountCreated.push((account) => { issueTokenMail(account, 'verify'); });

  function presentedToken(body: Record<string, unknown>): Uint8Array {
    const h = hashPresentedToken(body.token);
    if (!h) throw new ApiHttpError(400, 'bad_request', BAD_LINK);
    return h;
  }

  r.post('/verify-email', handler((req, res) => {
    enforceLimit(ctx.limiter, 'ipAuth', clientIp(req));
    const hash = presentedToken(v.obj(req.body));
    store.transaction(() => {
      const t = store.emailTokens.consume(hash, 'verify', opts.now());
      const account = t && store.accounts.byId(t.accountId);
      if (!t || !account) throw new ApiHttpError(400, 'bad_request', BAD_LINK);
      store.accounts.update(account.id, { emailVerified: true, deleteAfter: null });
    });
    res.status(204).end();
  }));

  // Always 204. Counted in the same per-address bucket whether or not the address exists or is verified.
  r.post('/resend-verification', handler((req, res) => {
    enforceLimit(ctx.limiter, 'ipAuth', clientIp(req));
    const email = v.email(v.obj(req.body).email);
    enforceLimit(ctx.limiter, 'emailSend', `verify:${email}`);
    const account = store.accounts.byEmail(email);
    if (account && !account.emailVerified) issueTokenMail(account, 'verify');
    res.status(204).end();
  }));

  r.post('/reset', handler((req, res) => {
    enforceLimit(ctx.limiter, 'ipAuth', clientIp(req));
    const email = v.email(v.obj(req.body).email);
    // Counted per address whether or not it has an account, so a 429 reveals nothing.
    enforceLimit(ctx.limiter, 'emailSend', `reset:${email}`);
    const account = store.accounts.byEmail(email);
    if (account) issueTokenMail(account, 'reset');
    res.status(204).end();
  }));

  r.post('/reset/confirm', handler((req, res) => {
    enforceLimit(ctx.limiter, 'ipAuth', clientIp(req));
    const body = v.obj(req.body);
    // Validate everything before spending the single-use token.
    const hash = presentedToken(body);
    const accountId = v.accountId(body.accountId);
    const material = v.material(body.material);
    const device = v.deviceWire(body.device);
    const wantToken = v.optBool(body.wantToken, 'wantToken');
    const out = store.transaction(() => {
      const t = store.emailTokens.consume(hash, 'reset', opts.now());
      const account = t && store.accounts.byId(t.accountId);
      if (!t || !account) throw new ApiHttpError(400, 'bad_request', BAD_LINK);
      const taken = accountId !== account.id && store.accounts.byId(accountId);
      if (taken) throw new ApiHttpError(400, 'bad_request', 'accountId already in use');
      // Without the old password and recovery code the synced data is unreadable: start the account afresh.
      store.records.wipe(account.id);
      store.sessions.deleteAllExcept(account.id);
      for (const d of store.devices.list(account.id)) store.devices.delete(account.id, d.id);
      store.emailTokens.deleteForAccount(account.id, 'reset');
      store.emailTokens.deleteForAccount(account.id, 'verify');
      store.keysets.replaceAll(account.id, []);
      // The new wraps bind the new account id: re-key the row (next_seq and the email stay).
      store.accounts.rekey(account.id, accountId);
      store.keysets.replaceAll(accountId, material.keysets);
      store.accounts.update(accountId, {
        kdf: material.kdf,
        authHash: sha256(b64urlToBytes(material.authKey)!),
        recoveryAuthHash: sha256(b64urlToBytes(material.recoveryAuthKey)!),
        wrappedAkPassword: material.wrappedAkPassword, wrappedAkRecovery: material.wrappedAkRecovery,
        wrappedIdk: material.wrappedRecordIdKey, currentEpoch: material.currentEpoch,
        // The reset link proved control of the address.
        emailVerified: true, deleteAfter: null,
      });
      const fresh = store.accounts.byId(accountId)!;
      return issueSession(ctx, res, { account: fresh, device, kind: 'normal', wantToken, userAgent: req.get('user-agent') });
    });
    opts.log('info', 'sync-server: password reset');
    res.json(out);
  }));

  return r;
}
