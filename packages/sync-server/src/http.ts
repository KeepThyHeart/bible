/**
 * HTTP plumbing shared by every sync route: the server context, ApiError responses, the `kth_sync` session
 * cookie, bearer tokens, the Origin check for cookie-authenticated writes, and the `requireSession` middleware.
 *
 * Secrets (passwords never reach the server; auth keys, tokens, wrapped keys do) are never logged: the error
 * handler logs only an error's name and message for unexpected failures, never request bodies or headers.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Sync } from '@bible/core';
import type { SyncServerOptions } from './types';
import type { AccountRow, SessionRow } from './store/SyncStore';
import type { SqliteSyncStore } from './store/SqliteSyncStore';
import type { RateLimiter } from './rateLimit';
import { hashPresentedToken } from './auth/tokens';

export const COOKIE_NAME = 'kth_sync';
export const COOKIE_PATH = '/api/sync/v1';
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** A session from /recover exists only to set a new password. */
export const RECOVERY_SESSION_TTL_MS = 30 * 60 * 1000;
/** Unverified accounts are purged after this long (W2-D's verify-email clears `deleteAfter`). */
export const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** `last_seen_at` is written at most this often per session. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/** Options with defaults applied. */
export interface ResolvedOptions {
  serverSecret: Uint8Array;
  publicUrl: string;
  email: SyncServerOptions['email'];
  signupOpen: boolean;
  quotaBytes: number;
  minAge: number;
  termsUrl?: string;
  privacyUrl?: string;
  allowedOrigins: ReadonlySet<string>;
  cookieSecure: boolean;
  now: () => number;
  random: (n: number) => Uint8Array;
  log: (level: 'info' | 'warn' | 'error', msg: string, meta?: object) => void;
}

/** Everything a route module needs. W2-C / W2-D route modules take the same context. */
export interface ServerContext {
  store: SqliteSyncStore;
  opts: ResolvedOptions;
  limiter: RateLimiter;
  /** Called after an account is created (W2-D: send the verification email). Failures are logged, not thrown. */
  onAccountCreated: Array<(account: AccountRow) => void | Promise<void>>;
}

/** The authenticated session attached by `requireSession`. */
export interface AuthedLocals { session: SessionRow; account: AccountRow; viaCookie: boolean }

export class ApiHttpError extends Error {
  constructor(readonly status: number, readonly code: Sync.ApiErrorCode, message?: string,
    readonly retryAfterSec?: number) {
    super(message ?? code);
    this.name = 'ApiHttpError';
  }
}

export function sendError(res: Response, status: number, code: Sync.ApiErrorCode, message?: string,
  retryAfterSec?: number): void {
  const body: Sync.ApiError = { error: code };
  if (message) body.message = message;
  if (retryAfterSec !== undefined) {
    body.retryAfterSec = retryAfterSec;
    res.setHeader('Retry-After', String(retryAfterSec));
  }
  res.status(status).json(body);
}

/** Wraps a (possibly async) handler so thrown errors reach the router's error handler. */
export function handler(fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(next);
    } catch (e) {
      next(e);
    }
  };
}

/** Final error handler: ApiHttpError -> its JSON; body-parser errors -> 400/413; anything else -> 500. */
export function errorHandler(ctx: ServerContext) {
  return (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) { next(err); return; }
    if (err instanceof ApiHttpError) {
      sendError(res, err.status, err.code, err.message === err.code ? undefined : err.message, err.retryAfterSec);
      return;
    }
    const e = err as { type?: string; status?: number; name?: string; message?: string };
    if (e && e.type === 'entity.too.large') { sendError(res, 413, 'too_large', 'Request body too large'); return; }
    if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      sendError(res, 400, 'bad_request', 'Malformed request');
      return;
    }
    ctx.opts.log('error', 'sync-server: unhandled error', { name: e?.name, message: e?.message });
    sendError(res, 500, 'server_error');
  };
}

/** Parses the Cookie header by hand (no cookie-parser dependency). Returns the first `kth_sync` value. */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    let v = part.slice(eq + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}

export function readBearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer[ ]+(\S+)\s*$/i.exec(h);
  return m ? m[1] : undefined;
}

function cookieAttributes(ctx: ServerContext): string {
  return `Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax${ctx.opts.cookieSecure ? '; Secure' : ''}`;
}

export function setSessionCookie(ctx: ServerContext, res: Response, token: string, expiresAt: number): void {
  const maxAge = Math.max(0, Math.floor((expiresAt - ctx.opts.now()) / 1000));
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieAttributes(ctx)}; Max-Age=${maxAge}`);
}

export function clearSessionCookie(ctx: ServerContext, res: Response): void {
  res.append('Set-Cookie', `${COOKIE_NAME}=; ${cookieAttributes(ctx)}; Max-Age=0`);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for every non-GET request that does not use a bearer token:
 * - an Origin header that is not in `allowedOrigins` -> 403 (also blocks login CSRF on unauthenticated posts);
 * - no Origin header while a `kth_sync` cookie is sent -> 403 (browsers send Origin on cross-site and fetch POSTs).
 * Bearer requests are exempt: a cross-site page cannot attach an Authorization header without CORS, which the
 * sync API never grants. Desktop clients (bearer, no Origin) and first-time logins without a cookie pass.
 */
export function originCheck(ctx: ServerContext): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || readBearer(req) !== undefined) { next(); return; }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!ctx.opts.allowedOrigins.has(origin)) { sendError(res, 403, 'forbidden', 'Origin not allowed'); return; }
    } else if (readSessionCookie(req) !== undefined) {
      sendError(res, 403, 'forbidden', 'Origin required');
      return;
    }
    next();
  };
}

/** The session behind a request, if any (bearer first, then cookie). Expired or orphaned sessions resolve to none. */
export function resolveSession(ctx: ServerContext, req: Request): AuthedLocals | undefined {
  const bearer = readBearer(req);
  const presented = bearer ?? readSessionCookie(req);
  if (presented === undefined) return undefined;
  const hash = hashPresentedToken(presented);
  if (!hash) return undefined;
  const session = ctx.store.sessions.byTokenHash(hash);
  const now = ctx.opts.now();
  if (!session || session.expiresAt <= now) return undefined;
  const account = ctx.store.accounts.byId(session.accountId);
  if (!account) return undefined;
  if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
    ctx.store.sessions.touch(hash, now);
    session.lastSeenAt = now;
  }
  return { session, account, viaCookie: bearer === undefined };
}

/**
 * Requires a valid session; puts it on `res.locals.auth`. Recovery sessions are refused (403) unless
 * `allowRecovery` is set: the only route that sets it is `PUT keys`, which then allows only `kind: 'password'`.
 */
export function requireSession(ctx: ServerContext, o: { allowRecovery?: boolean } = {}): RequestHandler {
  return handler((req, res, next) => {
    const auth = resolveSession(ctx, req);
    if (!auth) throw new ApiHttpError(401, 'unauthorized', 'Not signed in');
    if (auth.session.kind === 'recovery' && !o.allowRecovery) {
      throw new ApiHttpError(403, 'forbidden', 'A recovery session may only set a new password');
    }
    res.locals.auth = auth;
    next();
  });
}

export function authOf(res: Response): AuthedLocals {
  return res.locals.auth as AuthedLocals;
}

/** Client IP as Express sees it (the host sets `trust proxy`). */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
