/**
 * Typed wrapper for every route in api.ts (contracts 0063 §7/§8; task 0150 W3-A). Browser-safe: `fetch` is looked up
 * when a request is made, never at module load.
 *
 * - URLs are `${baseUrl}${SYNC_API_PREFIX}/<route>`. JSON bodies; byte fields travel as b64url strings.
 * - Auth: `{ kind: 'cookie' }` sends `credentials: 'include'` (the HttpOnly `kth_sync` cookie); `{ kind: 'bearer' }`
 *   sends `Authorization: Bearer <token>` with `credentials: 'omit'` (desktop).
 * - A non-2xx answer throws `SyncHttpError(status, ApiError | null)`; a 401 also calls `onUnauthorized` first.
 *   A request that got no answer throws `SyncNetworkError`; an aborted one rethrows the abort reason.
 *   A 2xx body that does not have the documented shape throws `SyncResponseError` (never handed to callers).
 * - Redirects are refused (`redirect: 'error'`; a redirect surfaces as SyncNetworkError).
 * - No error message ever contains a request body, a token or record content.
 */
import { b64urlDecode, b64urlEncode } from '../../Crypto';
import { SYNC_API_PREFIX } from '../api';
import type {
  AccountResponse, ApiError, ApiErrorCode, DeleteAccountRequest, DeviceNameRequest, DevicesResponse,
  EncryptedRecordWire, InfoResponse, KeysRequest, LoginRequest, PreloginRequest, PreloginResponse, PullResponse,
  PushRecord, PushResponse, RecoverRequest, ResendVerificationRequest, ResetConfirmRequest, ResetRequest,
  ServerExport, SessionResponse, SignupRequest, VerifyEmailRequest,
} from '../api';
import type { DeviceId, EncryptedRecord } from '../types';
import {
  SyncHttpError, SyncNetworkError, SyncResponseError, type HttpClientOptions, type ISyncTransport,
} from './ISyncTransport';

const API_ERROR_CODES: readonly ApiErrorCode[] = [
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict_email', 'email_unverified', 'quota_exceeded',
  'too_large', 'rate_limited', 'signup_closed', 'server_error',
];
const HEX32 = /^[0-9a-f]{32}$/;
const MAX_ERROR_MESSAGE = 300;

// --- response validation ---------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const bad = (what: string): never => { throw new SyncResponseError(`Malformed server response (${what})`); };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function obj(v: unknown, what: string): Obj { return isObj(v) ? v : bad(what); }
function str(o: Obj, k: string, what: string): string { return typeof o[k] === 'string' ? o[k] as string : bad(`${what}.${k}`); }
function optStr(o: Obj, k: string, what: string): void { if (o[k] !== undefined && typeof o[k] !== 'string') bad(`${what}.${k}`); }
function bool(o: Obj, k: string, what: string): boolean { return typeof o[k] === 'boolean' ? o[k] as boolean : bad(`${what}.${k}`); }
function int(o: Obj, k: string, what: string): number {
  const v = o[k];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : bad(`${what}.${k}`);
}
function arr(o: Obj, k: string, what: string): unknown[] { return Array.isArray(o[k]) ? o[k] as unknown[] : bad(`${what}.${k}`); }

function checkKdf(v: unknown, what: string): void {
  const k = obj(v, what);
  for (const f of ['m', 't', 'p', 'v']) int(k, f, what);
  str(k, 'id', what);
  str(k, 'salt', what);
}
function checkKeysets(o: Obj, what: string): void {
  for (const ks of arr(o, 'keysets', what)) {
    const k = obj(ks, `${what}.keysets[]`);
    int(k, 'epoch', `${what}.keysets[]`);
    str(k, 'wrappedDataKey', `${what}.keysets[]`);
  }
}

function checkInfo(v: unknown): InfoResponse {
  const o = obj(v, 'info');
  if (o.apiVersion !== 1) bad('info.apiVersion');
  bool(o, 'signupOpen', 'info'); int(o, 'quotaBytes', 'info'); int(o, 'minAge', 'info');
  const k = obj(o.minKdf, 'info.minKdf'); int(k, 'm', 'info.minKdf'); int(k, 't', 'info.minKdf');
  optStr(o, 'termsUrl', 'info'); optStr(o, 'privacyUrl', 'info');
  return o as unknown as InfoResponse;
}
function checkPrelogin(v: unknown): PreloginResponse {
  const o = obj(v, 'prelogin');
  checkKdf(o.kdf, 'prelogin.kdf');
  return o as unknown as PreloginResponse;
}
function checkSession(v: unknown): SessionResponse {
  const o = obj(v, 'session');
  if (!HEX32.test(str(o, 'accountId', 'session'))) bad('session.accountId');
  bool(o, 'emailVerified', 'session'); str(o, 'wrappedAk', 'session'); str(o, 'wrappedRecordIdKey', 'session');
  checkKeysets(o, 'session'); int(o, 'currentEpoch', 'session'); optStr(o, 'token', 'session');
  return o as unknown as SessionResponse;
}
function checkAccount(v: unknown, what = 'account'): AccountResponse {
  const o = obj(v, what);
  str(o, 'email', what); bool(o, 'emailVerified', what); int(o, 'bytesUsed', what); int(o, 'quotaBytes', what);
  str(o, 'createdAt', what); int(o, 'recordCount', what);
  return o as unknown as AccountResponse;
}
function checkDeviceList(list: unknown[], what: string): void {
  for (const d of list) {
    const o = obj(d, what);
    str(o, 'id', what); str(o, 'nameSealed', what); str(o, 'createdAt', what); str(o, 'lastSeenAt', what);
    if (o.userAgent !== null && typeof o.userAgent !== 'string') bad(`${what}.userAgent`);
    bool(o, 'current', what);
  }
}
function checkDevices(v: unknown): DevicesResponse {
  const o = obj(v, 'devices');
  checkDeviceList(arr(o, 'devices', 'devices'), 'devices[]');
  return o as unknown as DevicesResponse;
}
function checkRecordWire(v: unknown, what: string): EncryptedRecordWire {
  const o = obj(v, what);
  if (!HEX32.test(str(o, 'id', what))) bad(`${what}.id`);
  int(o, 'seq', what);
  const deleted = bool(o, 'deleted', what);
  // A tombstone carries its sealed tombstone blob (0150 R1); null only in the synthetic seq-0 answer / legacy rows.
  if (deleted ? o.blob !== null && typeof o.blob !== 'string' : typeof o.blob !== 'string') bad(`${what}.blob`);
  return o as unknown as EncryptedRecordWire;
}
function checkExport(v: unknown): ServerExport {
  const o = obj(v, 'export');
  if (o.format !== 'kth-sync-export' || o.version !== 1) bad('export.format');
  const a = checkAccount(o.account, 'export.account') as unknown as Obj;
  if (!HEX32.test(str(a, 'accountId', 'export.account'))) bad('export.account.accountId');
  checkKdf(a.kdf, 'export.account.kdf');
  checkDeviceList(arr(o, 'devices', 'export'), 'export.devices[]');
  checkKeysets(o, 'export');
  for (const r of arr(o, 'records', 'export')) checkRecordWire(r, 'export.records[]');
  return o as unknown as ServerExport;
}
function checkPull(v: unknown): PullResponse {
  const o = obj(v, 'changes');
  for (const r of arr(o, 'records', 'changes')) checkRecordWire(r, 'changes.records[]');
  int(o, 'next', 'changes'); bool(o, 'more', 'changes');
  return o as unknown as PullResponse;
}
function checkPush(v: unknown): PushResponse {
  const o = obj(v, 'push');
  for (const a of arr(o, 'accepted', 'push')) {
    const x = obj(a, 'push.accepted[]');
    if (!HEX32.test(str(x, 'id', 'push.accepted[]'))) bad('push.accepted[].id');
    int(x, 'seq', 'push.accepted[]');
  }
  for (const c of arr(o, 'conflicts', 'push')) {
    const x = obj(c, 'push.conflicts[]');
    const id = str(x, 'id', 'push.conflicts[]');
    const cur = checkRecordWire(x.current, 'push.conflicts[].current');
    if (cur.id !== id) bad('push.conflicts[].current.id');
  }
  return o as unknown as PushResponse;
}

/** Parse an error body defensively: only a well-formed ApiError with a known code is kept. */
function parseApiError(text: string): ApiError | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!isObj(v) || typeof v.error !== 'string' || !(API_ERROR_CODES as readonly string[]).includes(v.error)) return null;
  const out: ApiError = { error: v.error as ApiErrorCode };
  if (typeof v.message === 'string') out.message = v.message.slice(0, MAX_ERROR_MESSAGE);
  if (typeof v.retryAfterSec === 'number' && Number.isFinite(v.retryAfterSec) && v.retryAfterSec >= 0) {
    out.retryAfterSec = v.retryAfterSec;
  }
  return out;
}

function wireToRecord(w: EncryptedRecordWire): EncryptedRecord {
  let blob: Uint8Array | null = null;
  if (w.blob !== null) {
    try { blob = b64urlDecode(w.blob); } catch { bad('record blob encoding'); }
  }
  return { id: w.id, seq: w.seq, deleted: w.deleted, blob };
}

/** Convert an engine record to its wire form (exported for the fake transport in tests and for hosts). */
export function recordToWire(r: EncryptedRecord): EncryptedRecordWire {
  return { id: r.id, seq: r.seq, deleted: r.deleted, blob: r.blob ? b64urlEncode(r.blob) : null };
}

// --- client ----------------------------------------------------------------------------------------------------

interface RequestOptions<T> {
  body?: unknown;
  /** Validates and types a 2xx JSON body; omitted for routes answered with 204 (any body is ignored). */
  check?: (v: unknown) => T;
  signal?: AbortSignal;
}

export class SyncApiClient {
  private readonly root: string;

  constructor(private readonly o: HttpClientOptions) {
    if (typeof o.baseUrl !== 'string') throw new TypeError('SyncApiClient: baseUrl is required');
    this.root = o.baseUrl.replace(/\/+$/, '') + SYNC_API_PREFIX;
  }

  info(): Promise<InfoResponse> { return this.request('GET', '/info', { check: checkInfo }); }
  prelogin(r: PreloginRequest): Promise<PreloginResponse> { return this.request('POST', '/prelogin', { body: r, check: checkPrelogin }); }
  signup(r: SignupRequest): Promise<SessionResponse> { return this.request('POST', '/signup', { body: r, check: checkSession }); }
  login(r: LoginRequest): Promise<SessionResponse> { return this.request('POST', '/login', { body: r, check: checkSession }); }
  recover(r: RecoverRequest): Promise<SessionResponse> { return this.request('POST', '/recover', { body: r, check: checkSession }); }
  logout(): Promise<void> { return this.request('POST', '/logout', { body: {} }); }
  verifyEmail(r: VerifyEmailRequest): Promise<void> { return this.request('POST', '/verify-email', { body: r }); }
  resendVerification(r: ResendVerificationRequest): Promise<void> { return this.request('POST', '/resend-verification', { body: r }); }
  reset(r: ResetRequest): Promise<void> { return this.request('POST', '/reset', { body: r }); }
  resetConfirm(r: ResetConfirmRequest): Promise<SessionResponse> { return this.request('POST', '/reset/confirm', { body: r, check: checkSession }); }
  account(): Promise<AccountResponse> { return this.request('GET', '/account', { check: (v) => checkAccount(v) }); }
  keys(r: KeysRequest): Promise<void> { return this.request('PUT', '/keys', { body: r }); }
  devices(): Promise<DevicesResponse> { return this.request('GET', '/devices', { check: checkDevices }); }
  setDeviceName(r: DeviceNameRequest): Promise<void> { return this.request('PUT', '/devices/current', { body: r }); }
  revokeDevice(id: DeviceId): Promise<void> {
    if (!/^[0-9a-f]{16}$/.test(id)) return Promise.reject(new TypeError('Invalid device id'));
    return this.request('DELETE', `/devices/${id}`);
  }
  exportAll(): Promise<ServerExport> { return this.request('GET', '/export', { check: checkExport }); }
  deleteAccount(r: DeleteAccountRequest): Promise<void> { return this.request('DELETE', '/account', { body: r }); }

  /** Record transport over `GET changes` / `POST push`, converting b64url blobs to bytes. */
  transport(): ISyncTransport {
    return {
      pull: async (since, limit, signal) => {
        const q = `?since=${encodeURIComponent(String(Math.max(0, Math.floor(since))))}&limit=${encodeURIComponent(String(Math.max(1, Math.floor(limit))))}`;
        const r = await this.request('GET', `/changes${q}`, { check: checkPull, signal });
        return { records: r.records.map(wireToRecord), next: r.next, more: r.more };
      },
      push: async (records: PushRecord[], signal) => {
        const r = await this.request('POST', '/push', { body: { records }, check: checkPush, signal });
        return {
          accepted: r.accepted.map((a) => ({ id: a.id, seq: a.seq })),
          conflicts: r.conflicts.map((c) => ({ id: c.id, current: wireToRecord(c.current) })),
        };
      },
    };
  }

  private async request<T = void>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const auth = this.o.auth;
    if (auth.kind === 'bearer') {
      const token = await auth.token();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    // `cache` is a standard fetch option; typed loosely because the server package type-checks this file without the DOM lib.
    // `redirect: 'error'` (0150 R1): a 307/308 must never re-send an auth key or key material to another URL.
    const init: RequestInit & { cache?: string } = {
      method, headers, credentials: auth.kind === 'cookie' ? 'include' : 'omit', cache: 'no-store', redirect: 'error',
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    if (opts.signal) init.signal = opts.signal;

    const doFetch = this.o.fetch ?? globalThis.fetch;
    if (typeof doFetch !== 'function') throw new SyncNetworkError('fetch is not available');
    let res: Response;
    try {
      res = await doFetch(this.root + path, init);
    } catch (e) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? e;
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw new SyncNetworkError();
    }

    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? e;
      throw new SyncNetworkError('Network error while reading the response');
    }

    if (!res.ok) {
      if (res.status === 401) {
        try { this.o.onUnauthorized?.(); } catch { /* a host callback must not mask the HTTP error */ }
      }
      throw new SyncHttpError(res.status, parseApiError(text));
    }
    if (!opts.check) return undefined as T;
    let v: unknown;
    try { v = JSON.parse(text); } catch { throw new SyncResponseError('Malformed server response (not JSON)'); }
    return opts.check(v);
  }
}
