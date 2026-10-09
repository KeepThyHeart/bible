/** Session issuing: one session per (account, device); the plain token goes out once, as cookie or JSON. */
import type { Response } from 'express';
import type { Sync } from '@bible/core';
import type { AccountRow, SessionRow } from '../store/SyncStore';
import {
  RECOVERY_SESSION_TTL_MS, SESSION_TTL_MS, setSessionCookie, type ServerContext,
} from '../http';
import { newToken } from './tokens';

const MAX_USER_AGENT = 256;

export interface IssueOptions {
  account: AccountRow;
  device: Sync.DeviceWire;
  kind: SessionRow['kind'];
  wantToken: boolean;
  userAgent: string | undefined;
}

/**
 * Creates the session (replacing any normal session the same device held), registers the device, and answers
 * with the SessionResponse. Desktop (`wantToken`) gets the token in the body and no cookie; web gets the cookie.
 */
export function issueSession(ctx: ServerContext, res: Response, o: IssueOptions): Sync.SessionResponse {
  const now = ctx.opts.now();
  const { token, hash } = newToken(ctx.opts.random);
  const expiresAt = now + (o.kind === 'recovery' ? RECOVERY_SESSION_TTL_MS : SESSION_TTL_MS);
  const { store } = ctx;
  store.devices.upsert({ id: o.device.id, accountId: o.account.id, nameSealed: o.device.nameSealed, createdAt: now });
  // A fresh sign-in on a device replaces that device's old session; a recovery session sits beside it.
  if (o.kind === 'normal') store.sessions.deleteForDevice(o.account.id, o.device.id);
  store.sessions.create({
    tokenHash: hash, accountId: o.account.id, deviceId: o.device.id, kind: o.kind, createdAt: now,
    lastSeenAt: now, expiresAt, userAgent: o.userAgent ? o.userAgent.slice(0, MAX_USER_AGENT) : null,
  });
  const body: Sync.SessionResponse = {
    accountId: o.account.id,
    emailVerified: o.account.emailVerified,
    wrappedAk: o.kind === 'recovery' ? o.account.wrappedAkRecovery : o.account.wrappedAkPassword,
    wrappedRecordIdKey: o.account.wrappedIdk,
    keysets: store.keysets.list(o.account.id),
    currentEpoch: o.account.currentEpoch,
  };
  if (o.wantToken) body.token = token;
  else setSessionCookie(ctx, res, token, expiresAt);
  return body;
}
