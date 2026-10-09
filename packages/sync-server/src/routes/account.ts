/**
 * Account and session routes (contracts §7, W1-F): GET info | POST prelogin, signup, login, recover, logout |
 * GET account | PUT keys. Email flows (verify-email, reset) are W2-D; records, devices, export and account
 * deletion are W2-C.
 *
 * Enumeration: prelogin answers the same shape for unknown emails (fake, stable salt); login and recover give the
 * same 401 for an unknown email and a wrong key, after the same hash-and-compare work. Signup must say
 * `conflict_email` for a taken address (contract), with a neutral message.
 */
import { Router, type Request } from 'express';
import { Crypto, type Sync } from '@bible/core';
import {
  ApiHttpError, UNVERIFIED_ACCOUNT_TTL_MS, authOf, clearSessionCookie, clientIp, handler, requireSession,
  resolveSession, type ServerContext,
} from '../http';
import { enforceLimit } from '../rateLimit';
import { canonicalKdf, fakeKdf } from '../auth/prelogin';
import { issueSession } from '../auth/sessions';
import { b64urlToBytes, checkAuthKey, sha256 } from '../auth/tokens';
import * as v from '../auth/validate';
import type { AccountRow } from '../store/SyncStore';

const BAD_CREDENTIALS = 'Email or key is incorrect';

function authEntry(ctx: ServerContext, req: Request): Record<string, unknown> {
  enforceLimit(ctx.limiter, 'ipAuth', clientIp(req));
  return v.obj(req.body);
}

function limitEmail(ctx: ServerContext, email: string): void {
  enforceLimit(ctx.limiter, 'emailAuth', email);
}

/** SHA-256 of a b64url 32-byte key that `validate.key32` already accepted. */
function keyHash(k: string): Uint8Array {
  return sha256(b64urlToBytes(k)!);
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT'))
    || /UNIQUE constraint failed/.test(String(err?.message ?? ''));
}

export function accountRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { store, opts } = ctx;

  r.get('/info', (_req, res) => {
    const body: Sync.InfoResponse = {
      apiVersion: 1, signupOpen: opts.signupOpen, quotaBytes: opts.quotaBytes,
      minKdf: { m: Crypto.KDF_LIMITS.minM, t: Crypto.KDF_LIMITS.minT }, minAge: opts.minAge,
    };
    if (opts.termsUrl) body.termsUrl = opts.termsUrl;
    if (opts.privacyUrl) body.privacyUrl = opts.privacyUrl;
    res.json(body);
  });

  r.post('/prelogin', handler((req, res) => {
    const body = authEntry(ctx, req);
    const email = v.email(body.email);
    const account = store.accounts.byEmail(email);
    // Always compute the fake salt so both paths do the same work.
    const fake = fakeKdf(opts.serverSecret, email);
    const out: Sync.PreloginResponse = { kdf: account ? canonicalKdf(account.kdf) : fake };
    res.json(out);
  }));

  r.post('/signup', handler(async (req, res) => {
    const body = authEntry(ctx, req);
    if (!opts.signupOpen) throw new ApiHttpError(403, 'signup_closed', 'Sign-up is closed');
    const email = v.email(body.email);
    limitEmail(ctx, email);
    const accountId = v.accountId(body.accountId);
    const material = v.material(body.material);
    const device = v.deviceWire(body.device);
    const consent = v.obj(body.consent, 'consent');
    if (consent.terms !== true || consent.ageConfirmed !== true) v.bad('consent is required');
    const wantToken = v.optBool(body.wantToken, 'wantToken');

    const now = opts.now();
    let account: AccountRow | undefined;
    let session: Sync.SessionResponse | undefined;
    store.transaction(() => {
      if (store.accounts.byEmail(email)) {
        throw new ApiHttpError(409, 'conflict_email', 'An account cannot be created with this email address');
      }
      if (store.accounts.byId(accountId)) throw new ApiHttpError(400, 'bad_request', 'accountId already in use');
      try {
        store.accounts.create({
          id: accountId, email, emailVerified: false, kdf: material.kdf,
          authHash: keyHash(material.authKey), recoveryAuthHash: keyHash(material.recoveryAuthKey),
          wrappedAkPassword: material.wrappedAkPassword, wrappedAkRecovery: material.wrappedAkRecovery,
          wrappedIdk: material.wrappedRecordIdKey, currentEpoch: material.currentEpoch, quotaBytes: null,
          createdAt: now, deleteAfter: now + UNVERIFIED_ACCOUNT_TTL_MS,
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ApiHttpError(409, 'conflict_email', 'An account cannot be created with this email address');
        }
        throw e;
      }
      store.keysets.replaceAll(accountId, material.keysets);
      account = store.accounts.byId(accountId)!;
      session = issueSession(ctx, res, { account, device, kind: 'normal', wantToken, userAgent: req.get('user-agent') });
    });
    opts.log('info', 'sync-server: account created', { accountId });
    for (const listener of ctx.onAccountCreated) {
      try {
        await listener(account!);
      } catch (e) {
        opts.log('warn', 'sync-server: onAccountCreated listener failed', { name: (e as Error)?.name });
      }
    }
    res.status(201).json(session);
  }));

  r.post('/login', handler((req, res) => {
    const body = authEntry(ctx, req);
    const email = v.email(body.email);
    limitEmail(ctx, email);
    const device = v.deviceWire(body.device);
    const wantToken = v.optBool(body.wantToken, 'wantToken');
    const found = store.accounts.byEmail(email);
    const account = found && !(found.deleteAfter != null && found.deleteAfter <= opts.now()) ? found : undefined;
    if (!checkAuthKey(body.authKey, account?.authHash) || !account) {
      throw new ApiHttpError(401, 'unauthorized', BAD_CREDENTIALS);
    }
    const out = store.transaction(() => issueSession(ctx, res, {
      account, device, kind: 'normal', wantToken, userAgent: req.get('user-agent'),
    }));
    res.json(out);
  }));

  r.post('/recover', handler((req, res) => {
    const body = authEntry(ctx, req);
    const email = v.email(body.email);
    limitEmail(ctx, email);
    const device = v.deviceWire(body.device);
    const wantToken = v.optBool(body.wantToken, 'wantToken');
    const found = store.accounts.byEmail(email);
    const account = found && !(found.deleteAfter != null && found.deleteAfter <= opts.now()) ? found : undefined;
    if (!checkAuthKey(body.recoveryAuthKey, account?.recoveryAuthHash) || !account) {
      throw new ApiHttpError(401, 'unauthorized', BAD_CREDENTIALS);
    }
    const out = store.transaction(() => issueSession(ctx, res, {
      account, device, kind: 'recovery', wantToken, userAgent: req.get('user-agent'),
    }));
    res.json(out);
  }));

  // Idempotent: signs out the presented session (if any) and clears the cookie.
  r.post('/logout', handler((req, res) => {
    const auth = resolveSession(ctx, req);
    if (auth) store.deleteSession(auth.account.id, auth.session.tokenHash);
    clearSessionCookie(ctx, res);
    res.status(204).end();
  }));

  r.get('/account', requireSession(ctx), (_req, res) => {
    const { account } = authOf(res);
    const body: Sync.AccountResponse = {
      email: account.email, emailVerified: account.emailVerified, bytesUsed: account.bytesUsed,
      quotaBytes: account.quotaBytes ?? opts.quotaBytes, createdAt: new Date(account.createdAt).toISOString(),
      recordCount: store.records.count(account.id),
    };
    res.json(body);
  });

  r.put('/keys', requireSession(ctx, { allowRecovery: true }), handler((req, res) => {
    const { account, session, viaCookie } = authOf(res);
    const body = v.obj(req.body);
    const kind = body.kind;
    if (kind !== 'password' && kind !== 'recovery' && kind !== 'rotate') v.bad('invalid kind');
    const recovery = session.kind === 'recovery';
    if (recovery && kind !== 'password') {
      throw new ApiHttpError(403, 'forbidden', 'A recovery session may only set a new password');
    }
    if (!recovery) {
      // A signed-in session still proves the current password (limits a stolen session's damage).
      limitEmail(ctx, account.email);
      if (!checkAuthKey(body.currentAuthKey, account.authHash)) {
        throw new ApiHttpError(403, 'forbidden', 'Current key is incorrect');
      }
    }

    if (kind === 'password') {
      const kdf = v.kdf(body.kdf);
      const authKey = v.key32(body.authKey, 'authKey');
      const wrappedAkPassword = v.wrappedKey(body.wrappedAkPassword, 'wrappedAkPassword');
      const signOutOthers = v.bool(body.signOutOthers, 'signOutOthers');
      // After a recovery the used code is spent: the same request must install a new one.
      const newRecovery = recovery
        ? {
            recoveryAuthHash: keyHash(v.key32(body.recoveryAuthKey, 'recoveryAuthKey')),
            wrappedAkRecovery: v.wrappedKey(body.wrappedAkRecovery, 'wrappedAkRecovery'),
          }
        : {};
      store.transaction(() => {
        store.accounts.update(account.id, { kdf, authHash: keyHash(authKey), wrappedAkPassword, ...newRecovery });
        if (recovery) {
          // Recovery suggests the password was lost or compromised: drop every session.
          store.sessions.deleteAllExcept(account.id);
        } else {
          if (signOutOthers) store.sessions.deleteAllExcept(account.id, session.tokenHash);
          // A live recovery session must not outlive a password change.
          store.sessions.deleteRecovery(account.id);
        }
      });
      if (recovery && viaCookie) clearSessionCookie(ctx, res);
    } else if (kind === 'recovery') {
      const recoveryAuthKey = v.key32(body.recoveryAuthKey, 'recoveryAuthKey');
      const wrappedAkRecovery = v.wrappedKey(body.wrappedAkRecovery, 'wrappedAkRecovery');
      store.accounts.update(account.id, { recoveryAuthHash: keyHash(recoveryAuthKey), wrappedAkRecovery });
    } else {
      const m = v.material(body.material);
      if (m.currentEpoch <= account.currentEpoch) v.bad('rotation must advance the epoch');
      const epochs = new Set(m.keysets.map((k) => k.epoch));
      for (const k of store.keysets.list(account.id)) {
        if (!epochs.has(k.epoch)) v.bad('rotation must keep every existing epoch');
      }
      store.transaction(() => {
        store.accounts.update(account.id, {
          kdf: m.kdf, authHash: keyHash(m.authKey), recoveryAuthHash: keyHash(m.recoveryAuthKey),
          wrappedAkPassword: m.wrappedAkPassword, wrappedAkRecovery: m.wrappedAkRecovery,
          wrappedIdk: m.wrappedRecordIdKey, currentEpoch: m.currentEpoch,
        });
        store.keysets.replaceAll(account.id, m.keysets);
        store.sessions.deleteAllExcept(account.id, session.tokenHash);
      });
    }
    opts.log('info', 'sync-server: keys changed', { accountId: account.id, kind });
    res.status(204).end();
  }));

  return r;
}
