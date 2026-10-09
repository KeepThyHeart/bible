/** Account client (contracts 0063 §9; W3-B implements). */
import type { KdfParams, RandomSource } from '../../Crypto';
import type { DeviceId } from '../types';
import type { UnlockedAccount } from '../crypto/keys';
import type { SignupRequest } from '../api';
import type { SyncApiClient } from '../engine/SyncApiClient';
import type { ISecretStore } from '../engine/ISecretStore';
import type { SyncStatusStore } from '../engine/SyncStatus';
import { notImplemented } from '../notImplemented';

export interface AccountClientDeps {
  api: SyncApiClient; secrets: ISecretStore; status: SyncStatusStore;
  kdf?: (password: string, params: KdfParams) => Promise<Uint8Array>;   // desktop worker
  deviceId: DeviceId; deviceName: () => string; random?: RandomSource;
  /** Minimum password strength 0-4 (default 3) via the lazy estimator in Sync/password.ts. */
  minStrength?: number;
}
export class WeakPasswordError extends Error {
  constructor(readonly score: number, readonly feedback: string[]) {
    super('Password is too weak');
    this.name = 'WeakPasswordError';
  }
}

export class AccountClient {
  readonly unlocked: UnlockedAccount | null = null;
  constructor(d: AccountClientDeps) {
    throw notImplemented(d);
  }
  /** Returns the recovery code: the UI MUST show it and require re-typing 4 random characters before continuing. */
  signUp(email: string, password: string, consent: SignupRequest['consent']): Promise<{ recoveryCode: string }> {
    throw notImplemented(email, password, consent);
  }
  /** Refuses KDF params below floor. */
  signIn(email: string, password: string): Promise<void> {
    throw notImplemented(email, password);
  }
  /** Sets new password + new code. */
  signInWithRecoveryCode(email: string, code: string, newPassword: string): Promise<{ recoveryCode: string }> {
    throw notImplemented(email, code, newPassword);
  }
  /** Restore a remembered device from ISecretStore; 'locked' if nothing stored. */
  resume(): Promise<UnlockedAccount | null> {
    throw notImplemented();
  }
  changePassword(current: string, next: string, signOutOthers: boolean): Promise<void> {
    throw notImplemented(current, next, signOutOthers);
  }
  regenerateRecoveryCode(currentPassword: string): Promise<{ recoveryCode: string }> {
    throw notImplemented(currentPassword);
  }
  /** Engine then re-encrypts everything. */
  rotateKeys(currentPassword: string): Promise<{ recoveryCode: string }> {
    throw notImplemented(currentPassword);
  }
  /** Reset-by-email path. */
  startOver(token: string, password: string): Promise<{ recoveryCode: string }> {
    throw notImplemented(token, password);
  }
  signOut(opts: { wipeLocal: boolean }): Promise<void> {
    throw notImplemented(opts);
  }
  deleteAccount(password: string): Promise<void> {
    throw notImplemented(password);
  }
}
