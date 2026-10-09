/**
 * The accounts module's main-process API (contracts 0063 §13, as refreshed for task 0150): shared by
 * `./index.ts` (a `FeatureMainModule` hosting `DesktopSyncService`, implements it through `ipc.handle`) and the
 * renderer's `createModuleClient<AccountsApi, AccountsEvents>('accounts')`. Channels are `module:accounts:<method>`
 * and `module:accounts:event:<name>`. Type-only imports, so the renderer pulls no main-process code in.
 *
 * Failures: handlers throw `IpcKnownError` (`../../ipc/result.ts`) with the code from `ACCOUNTS_IPC_ERROR_CODES`
 * below and a user-facing message; the renderer client turns the envelope into a rejection.
 */
import type { Sync } from '@bible/core/browser';
import type { IpcErrorCode } from '../../ipc/result';

export interface DesktopSyncSettings {
  serverUrl: string;              // default https://<official>
  askPasswordEachLaunch: boolean;
  secretStoreWeak: boolean;       // linux basic_text
}

/** One signed-in device, name already decrypted. */
export interface AccountDevice {
  id: Sync.DeviceId; name: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean;
}

/** What the preferences section shows besides the status. */
export interface AccountsInfo {
  settings: DesktopSyncSettings;
  /** Null when the server cannot be reached. */
  server: Sync.InfoResponse | null;
  /** Null when signed out or offline. */
  account: Sync.AccountResponse | null;
}

export interface AccountsApi {
  status(): Sync.SyncStatus;
  info(): AccountsInfo;
  signUp(v: { email: string; password: string; consent: Sync.SignupRequest['consent'] }): { recoveryCode: string };
  signIn(v: { email: string; password: string }): void;
  /** Recovery-code sign-in: sets the new password and returns a new recovery code. */
  recover(v: { email: string; code: string; newPassword: string }): { recoveryCode: string };
  signOut(v: { wipeLocal: boolean }): void;
  changePassword(v: { current: string; next: string; signOutOthers: boolean }): void;
  newRecoveryCode(v: { currentPassword: string }): { recoveryCode: string };
  rotate(v: { currentPassword: string }): { recoveryCode: string };
  devices(): AccountDevice[];
  revokeDevice(id: Sync.DeviceId): void;
  syncNow(): Sync.SyncResult;
  setServerUrl(url: string): DesktopSyncSettings;
  deleteAccount(v: { password: string }): void;
  /** Saves the server's ciphertext export through a save dialog; null when the user cancelled. */
  exportServerData(): { path: string } | null;
}

export interface AccountsEvents {
  statusChanged: [status: Sync.SyncStatus];
}

/** Failure classes a handler can raise (the old `SyncIpcResult` codes). */
export type AccountsFailure = Sync.ApiErrorCode | 'weak_password' | 'crypto' | 'network' | 'internal';

/** How each failure maps onto the shared IPC error codes (`internal` is never thrown as `IpcKnownError`). */
export const ACCOUNTS_IPC_ERROR_CODES: Readonly<Record<AccountsFailure, IpcErrorCode>> = {
  bad_request: 'invalid_input',
  unauthorized: 'unauthorized',
  forbidden: 'unauthorized',
  not_found: 'not_found',
  conflict_email: 'conflict',
  email_unverified: 'unauthorized',
  quota_exceeded: 'conflict',
  too_large: 'invalid_input',
  rate_limited: 'unavailable',
  signup_closed: 'unavailable',
  server_error: 'unavailable',
  weak_password: 'invalid_input',
  crypto: 'unauthorized',
  network: 'unavailable',
  internal: 'internal',
};
