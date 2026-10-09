/**
 * Sync server API (contracts 0063 §7; used by the W1-F server and the W3-A/B client).
 *
 * All under `/api/sync/v1`. JSON bodies; byte fields are b64url strings. Web authenticates with the HttpOnly cookie
 * `kth_sync` (+ Origin check on mutating requests); desktop with `Authorization: Bearer <token>`.
 *
 * Routes: GET info | POST prelogin, signup, login, recover, logout, verify-email, reset, reset/confirm
 *         GET account | PUT keys | GET changes?since=&limit= | POST push | GET devices | DELETE devices/:id
 *         GET export | DELETE account
 */
import type { KdfParamsJson } from '../Crypto';
import type { AccountId, DeviceId, RecordId } from './types';
import type { AccountKeyMaterial, KeysetWire, WrappedKey } from './crypto/keys';

export const SYNC_API_PREFIX = '/api/sync/v1';
export const LIMITS = { maxRecordBytes: 1024 * 1024 + 64, maxPushRecords: 500, maxPushBodyBytes: 8 * 1024 * 1024,
  maxPullLimit: 1000, defaultQuotaBytes: 100 * 1024 * 1024 } as const;

export interface ApiError { error: ApiErrorCode; message?: string; retryAfterSec?: number }
export type ApiErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict_email'
  | 'email_unverified' | 'quota_exceeded' | 'too_large' | 'rate_limited' | 'signup_closed' | 'server_error';

export interface InfoResponse { apiVersion: 1; signupOpen: boolean; quotaBytes: number; minKdf: { m: number; t: number };
  termsUrl?: string; privacyUrl?: string; minAge: number }

export interface DeviceWire { id: DeviceId; nameSealed: string }

export interface PreloginRequest  { email: string }
export interface PreloginResponse { kdf: KdfParamsJson }            // fake but stable for unknown emails

export interface SignupRequest { email: string; accountId: AccountId; material: AccountKeyMaterial; device: DeviceWire;
  consent: { terms: true; ageConfirmed: true }; wantToken?: boolean }
export interface SessionResponse {
  accountId: AccountId; emailVerified: boolean;
  wrappedAk: WrappedKey;              // password wrap on login, recovery wrap on /recover
  wrappedRecordIdKey: WrappedKey; keysets: KeysetWire[]; currentEpoch: number;
  token?: string;                     // only when wantToken (desktop); web gets the cookie
}
export interface LoginRequest   { email: string; authKey: string; device: DeviceWire; wantToken?: boolean }
export interface RecoverRequest { email: string; recoveryAuthKey: string; device: DeviceWire; wantToken?: boolean }
export interface VerifyEmailRequest { token: string }
export interface ResetRequest  { email: string }                                  // always 204
export interface ResetConfirmRequest { token: string; material: AccountKeyMaterial; device: DeviceWire; wantToken?: boolean } // wipes records

export type KeysRequest =
  | { kind: 'password'; currentAuthKey: string; kdf: KdfParamsJson; authKey: string; wrappedAkPassword: WrappedKey; signOutOthers: boolean;
      /** Required (and only used) from a recovery session: the used code is replaced in the same request. */
      recoveryAuthKey?: string; wrappedAkRecovery?: WrappedKey }
  | { kind: 'recovery'; currentAuthKey: string; recoveryAuthKey: string; wrappedAkRecovery: WrappedKey }
  | { kind: 'rotate';   currentAuthKey: string; material: AccountKeyMaterial };    // revokes all other sessions
// 'currentAuthKey' may instead be proof from a recovery session (server accepts a session created by /recover for 'password').

export interface PullResponse { records: EncryptedRecordWire[]; next: number; more: boolean }
export interface EncryptedRecordWire { id: RecordId; seq: number; deleted: boolean; blob: string | null }
export interface PushRecord { id: RecordId; baseSeq: number | null; deleted: boolean; blob: string | null }
export interface PushRequest  { records: PushRecord[] }
export interface PushResponse { accepted: Array<{ id: RecordId; seq: number }>; conflicts: Array<{ id: RecordId; current: EncryptedRecordWire }> }
// Server rule: accept iff (no row and baseSeq === null) or row.seq === baseSeq. Tombstones keep id+seq forever.

export interface AccountResponse { email: string; emailVerified: boolean; bytesUsed: number; quotaBytes: number; createdAt: string; recordCount: number }
export interface DevicesResponse { devices: Array<{ id: DeviceId; nameSealed: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean }> }
export interface DeleteAccountRequest { authKey: string }
export interface ServerExport { format: 'kth-sync-export'; version: 1; account: AccountResponse & { accountId: AccountId; kdf: KdfParamsJson };
  devices: DevicesResponse['devices']; keysets: KeysetWire[]; records: EncryptedRecordWire[] }
