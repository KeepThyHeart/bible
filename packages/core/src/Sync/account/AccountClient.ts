/**
 * Account client (contracts 0063 §9): sign-up, sign-in, recovery, password and key changes, sign-out.
 *
 * Only wrapped keys and auth keys ever go to the server: the password, the KEK, the account key, the record-id key
 * and the data keys stay in this process (and in the ISecretStore as `sync.unlocked`). Nothing here logs, and no
 * error message carries a key, password, recovery code or token. Crypto failures surface as `AccountError` with a
 * fixed message; the raw crypto error is never attached.
 *
 * Secret storage: `sync.unlocked` holds `serializeUnlocked(u)`; `sync.token` holds the desktop bearer token as UTF-8
 * (only when `wantToken`; web uses the HttpOnly cookie). Both are written to whatever store the host passed: a
 * `'memory'` store (web "remember this device" off) simply does not survive a reload, and the next start is 'locked'.
 * Hosts using bearer auth read the token with `loadSyncToken(secrets)` in their `HttpClientOptions.auth.token`.
 *
 * Browser-safe: no Node imports, nothing runs at module load.
 */
import {
  AuthError, KdfParamsError, b64urlEncode, defaultRandom, kdfParamsFromJson, utf8Decode, utf8Encode, validateKdfParams,
} from '../../Crypto';
import type { KdfParams, RandomSource } from '../../Crypto';
import type { DeviceId } from '../types';
import {
  createAccountMaterial, derivePasswordKeys, newRecoveryWrap, parseRecoveryCode, recoveryAuthKeyFor,
  rewrapForNewPassword, rotateAccountKey, sealDeviceName, unlockWithPassword, unlockWithRecoveryCode,
} from '../crypto/keys';
import type { UnlockedAccount } from '../crypto/keys';
import type { DeviceWire, ResetConfirmRequest, SessionResponse, SignupRequest } from '../api';
import type { SyncApiClient } from '../engine/SyncApiClient';
import { deserializeUnlocked, serializeUnlocked } from '../engine/ISecretStore';
import type { ISecretStore } from '../engine/ISecretStore';
import { SyncHttpError } from '../engine/ISyncTransport';
import type { SyncStatusStore } from '../engine/SyncStatus';
import { emailUserInputs, passwordStrength } from '../password';

type KdfFn = (password: string, params: KdfParams) => Promise<Uint8Array>;

export interface AccountClientDeps {
  api: SyncApiClient; secrets: ISecretStore; status: SyncStatusStore;
  kdf?: (password: string, params: KdfParams) => Promise<Uint8Array>;   // desktop worker
  deviceId: DeviceId; deviceName: () => string; random?: RandomSource;
  /** Minimum password strength 0-4 (default 3) via the lazy estimator in Sync/password.ts. */
  minStrength?: number;
  /**
   * Addition to the contract. Ask the server for a bearer token in the session response (desktop) instead of the
   * cookie (web). The token is stored as `sync.token`. Default false.
   */
  wantToken?: boolean;
  /** Addition to the contract. Argon2id cost for new password slots (default DEFAULT_KDF); tests use the floor. */
  kdfCost?: Partial<Pick<KdfParams, 'm' | 't' | 'p'>>;
  /**
   * Addition to the contract. Called (awaited) whenever a new UnlockedAccount is in effect: after sign-up, sign-in,
   * recovery, resume, start-over and key rotation. Hosts (re)start the SyncEngine here, and should check
   * `needsReencrypt` (see AccountClient) to run a full re-encryption. Errors thrown here propagate to the caller.
   */
  onUnlocked?: (u: UnlockedAccount) => Promise<void> | void;
  /** Addition to the contract. Called (awaited) after sign-out and account deletion. Hosts stop the SyncEngine. */
  onSignedOut?: () => Promise<void> | void;
  /**
   * Addition to the contract. Called (awaited) after `onSignedOut` when local synced data must be wiped:
   * `signOut({ wipeLocal: true })` and `deleteAccount`. Hosts delete the user DB / OPFS / IndexedDB data.
   */
  onWipe?: () => Promise<void>;
}

export class WeakPasswordError extends Error {
  constructor(readonly score: number, readonly feedback: string[]) {
    super('Password is too weak');
    this.name = 'WeakPasswordError';
  }
}

/**
 * Typed failure of an account flow (addition to the contract). Messages are fixed strings: never the password,
 * a key, a code, a token or the underlying crypto error.
 * - `invalid_credentials`: the server refused the email/password (or recovery code, or current password).
 * - `damaged_keys`: the server accepted the credentials but the wrapped keys did not open (tampering or corruption).
 * - `unsafe_kdf`: the server offered Argon2id parameters below the floor (refused before any Argon2 work).
 * - `invalid_recovery_code`: the recovery code is not 32 base32 characters.
 * - `not_signed_in`: the flow needs an unlocked account and there is none.
 */
export type AccountErrorCode =
  | 'invalid_credentials' | 'damaged_keys' | 'unsafe_kdf' | 'invalid_recovery_code' | 'not_signed_in';

const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorCode, string> = {
  invalid_credentials: 'Email, password or recovery code is incorrect',
  damaged_keys: 'Wrong password or damaged keys',
  unsafe_kdf: 'The server offered unsafe password settings',
  invalid_recovery_code: 'A recovery code has 32 characters',
  not_signed_in: 'Not signed in',
};

export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(ACCOUNT_ERROR_MESSAGES[code]);
    this.name = 'AccountError';
  }
}

/**
 * Sent as `nameSealed` when the account key is not known yet (password and recovery sign-in: the server wants a
 * device before it hands out the wrapped keys). b64url of one zero byte: valid on the wire, never opens. A later
 * request with the real sealed name replaces it. See the W3-B report (open issue: device rename route).
 */
export const UNSEALED_DEVICE_NAME = 'AA';

/** The desktop bearer token stored by AccountClient, for `HttpClientOptions.auth.token`. */
export async function loadSyncToken(secrets: ISecretStore): Promise<string | null> {
  const b = await secrets.get('sync.token');
  if (!b) return null;
  try {
    return utf8Decode(b);
  } catch {
    return null;
  }
}

function httpStatus(e: unknown): number | undefined {
  return e instanceof SyncHttpError ? e.status : undefined;
}

/** 401/403 from an auth route means the credentials (or current password) were refused. */
function mapCredentialError(e: unknown): unknown {
  const s = httpStatus(e);
  return s === 401 || s === 403 ? new AccountError('invalid_credentials') : e;
}

/** Unwrap failures become `damaged_keys`; the AuthError (and its message) is dropped. */
function mapUnlockError(e: unknown): unknown {
  return e instanceof AuthError ? new AccountError('damaged_keys') : e;
}

export class AccountClient {
  private readonly d: AccountClientDeps;
  private readonly random: RandomSource;
  private current: UnlockedAccount | null = null;
  private email: string | null = null;
  private reencrypt = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(d: AccountClientDeps) {
    this.d = d;
    this.random = d.random ?? defaultRandom;
  }

  /** The unlocked account of this device, or null when signed out / locked. */
  get unlocked(): UnlockedAccount | null {
    return this.current;
  }

  /**
   * True after `rotateKeys` (new epoch) or `startOver` (server records wiped) until consumed: the engine must
   * re-encrypt and re-push every local record. In memory only: hosts that need it to survive a restart persist it
   * themselves (or the engine detects records under old epochs).
   */
  get needsReencrypt(): boolean {
    return this.reencrypt;
  }

  /** Returns `needsReencrypt` and clears it. Call when the engine starts the full re-encryption. */
  consumeReencrypt(): boolean {
    const r = this.reencrypt;
    this.reencrypt = false;
    return r;
  }

  /** Returns the recovery code: the UI MUST show it and require re-typing 4 random characters before continuing. */
  signUp(email: string, password: string, consent: SignupRequest['consent']): Promise<{ recoveryCode: string }> {
    return this.serial(async () => {
      const addr = email.trim();
      await this.checkStrength(password, emailUserInputs(addr));
      const { accountId, material, unlocked, recoveryCode } = await createAccountMaterial({
        password, random: this.random, kdf: this.d.kdf, kdfCost: this.d.kdfCost,
      });
      // The server answers an already-registered address exactly like a new one (and mails the owner), so success
      // here does not prove the account exists; the first authenticated call then fails with 401 ('locked').
      const res = await this.d.api.signup({
        email: addr, accountId, material, device: await this.device(unlocked), consent, ...this.tokenFlag(),
      });
      await this.establish(unlocked, addr, res);
      return { recoveryCode };
    });
  }

  /** Refuses KDF params below floor (before any Argon2 work). */
  signIn(email: string, password: string): Promise<void> {
    return this.serial(async () => {
      const addr = email.trim();
      const { authKey, kek } = await this.deriveFor(addr, password);
      try {
        let res: SessionResponse;
        try {
          res = await this.d.api.login({
            email: addr, authKey: b64urlEncode(authKey), device: this.placeholderDevice(), ...this.tokenFlag(),
          });
        } catch (e) {
          throw mapCredentialError(e);
        }
        let u: UnlockedAccount;
        try {
          u = await unlockWithPassword(res.accountId, kek, res.wrappedAk, res.wrappedRecordIdKey, res.keysets,
            res.currentEpoch);
        } catch (e) {
          throw mapUnlockError(e);
        }
        await this.establish(u, addr, res);
        // The login had to carry a placeholder name (no account key yet); store the real sealed one. Best effort.
        try { await this.d.api.setDeviceName({ nameSealed: (await this.device(u)).nameSealed }); } catch { /* cosmetic */ }
      } finally {
        authKey.fill(0);
        kek.fill(0);
      }
    });
  }

  /**
   * Recovery: `recover` opens a recovery session, the code unwraps the account key, then ONE `PUT keys` sets the
   * new password and a NEW recovery code (the used code is spent). The server then drops every session of the
   * account (the recovery one too), so we sign in normally with the new password's auth key (no second Argon2).
   */
  signInWithRecoveryCode(email: string, code: string, newPassword: string): Promise<{ recoveryCode: string }> {
    return this.serial(async () => {
      const addr = email.trim();
      try {
        parseRecoveryCode(code).fill(0);
      } catch {
        throw new AccountError('invalid_recovery_code');
      }
      await this.checkStrength(newPassword, emailUserInputs(addr));
      const recoveryAuthKey = await recoveryAuthKeyFor(code);
      let rec: SessionResponse;
      try {
        rec = await this.d.api.recover({
          email: addr, recoveryAuthKey, device: this.placeholderDevice(), ...this.tokenFlag(),
        });
      } catch (e) {
        throw mapCredentialError(e);
      }
      // The bearer client reads the token from the store; the recovery session is only good for PUT keys.
      if (rec.token) await this.d.secrets.set('sync.token', utf8Encode(rec.token));
      let u: UnlockedAccount;
      try {
        u = await unlockWithRecoveryCode(rec.accountId, code, rec.wrappedAk, rec.wrappedRecordIdKey, rec.keysets,
          rec.currentEpoch);
      } catch (e) {
        await this.d.secrets.delete('sync.token');
        throw mapUnlockError(e);
      }
      const pw = await rewrapForNewPassword(u, newPassword, this.kdfOpts());
      const next = await newRecoveryWrap(u, this.random);
      try {
        await this.d.api.keys({
          kind: 'password', currentAuthKey: recoveryAuthKey, kdf: pw.kdf, authKey: pw.authKey,
          wrappedAkPassword: pw.wrappedAkPassword, signOutOthers: true,
          recoveryAuthKey: next.recoveryAuthKey, wrappedAkRecovery: next.wrappedAkRecovery,
        });
      } finally {
        // Spent either way: the server dropped the recovery session on success.
        await this.d.secrets.delete('sync.token');
      }
      let res: SessionResponse;
      try {
        res = await this.d.api.login({
          email: addr, authKey: pw.authKey, device: await this.device(u), ...this.tokenFlag(),
        });
      } catch (e) {
        throw mapCredentialError(e);
      }
      if (res.accountId !== u.accountId) throw new AccountError('damaged_keys');
      await this.establish(u, addr, res);
      return { recoveryCode: next.recoveryCode };
    });
  }

  /**
   * Restore a remembered device from ISecretStore without contacting the server. Nothing stored → null and status
   * 'locked'. A damaged blob is deleted (with the token) → null and 'locked'.
   */
  resume(): Promise<UnlockedAccount | null> {
    return this.serial(async () => {
      const blob = await this.d.secrets.get('sync.unlocked');
      if (!blob) {
        this.d.status.set({ state: 'locked', error: undefined });
        return null;
      }
      let u: UnlockedAccount;
      try {
        u = deserializeUnlocked(blob);
      } catch {
        await this.d.secrets.delete('sync.unlocked');
        await this.d.secrets.delete('sync.token');
        this.d.status.set({ state: 'locked', error: undefined });
        return null;
      } finally {
        blob.fill(0);
      }
      this.current = u;
      this.d.status.set({ state: 'idle', error: undefined });
      await this.d.onUnlocked?.(u);
      return u;
    });
  }

  /** Verifies `current` (its auth key goes to the server), re-wraps the SAME account key under `next`. */
  changePassword(current: string, next: string, signOutOthers: boolean): Promise<void> {
    return this.serial(async () => {
      const u = this.requireUnlocked();
      const email = await this.accountEmail();
      await this.checkStrength(next, emailUserInputs(email));
      const currentAuthKey = await this.currentAuthKey(email, current);
      const pw = await rewrapForNewPassword(u, next, this.kdfOpts());
      try {
        await this.d.api.keys({
          kind: 'password', currentAuthKey, kdf: pw.kdf, authKey: pw.authKey, wrappedAkPassword: pw.wrappedAkPassword,
          signOutOthers,
        });
      } catch (e) {
        throw mapCredentialError(e);
      }
    });
  }

  /** New recovery code; the old one stops working. */
  regenerateRecoveryCode(currentPassword: string): Promise<{ recoveryCode: string }> {
    return this.serial(async () => {
      const u = this.requireUnlocked();
      const currentAuthKey = await this.currentAuthKey(await this.accountEmail(), currentPassword);
      const next = await newRecoveryWrap(u, this.random);
      try {
        await this.d.api.keys({
          kind: 'recovery', currentAuthKey, recoveryAuthKey: next.recoveryAuthKey, wrappedAkRecovery: next.wrappedAkRecovery,
        });
      } catch (e) {
        throw mapCredentialError(e);
      }
      return { recoveryCode: next.recoveryCode };
    });
  }

  /**
   * Suspected compromise: new account key and epoch, new password slot (same password, fresh salt) and a new
   * recovery code; the server revokes every other session. Sets `needsReencrypt`: the engine then re-encrypts
   * everything under the new epoch.
   */
  rotateKeys(currentPassword: string): Promise<{ recoveryCode: string }> {
    return this.serial(async () => {
      const u = this.requireUnlocked();
      const currentAuthKey = await this.currentAuthKey(await this.accountEmail(), currentPassword);
      const r = await rotateAccountKey(u, currentPassword, this.random, { kdf: this.d.kdf, kdfCost: this.d.kdfCost });
      try {
        await this.d.api.keys({ kind: 'rotate', currentAuthKey, material: r.material });
      } catch (e) {
        throw mapCredentialError(e);
      }
      this.reencrypt = true;
      await this.persist(r.unlocked);
      this.current = r.unlocked;
      await this.d.onUnlocked?.(r.unlocked);
      return { recoveryCode: r.recoveryCode };
    });
  }

  /**
   * Reset-by-email ("start over"): brand-new keys for the same account; the server wipes its records. Sets
   * `needsReencrypt` so the engine re-uploads this device's data under the new keys.
   */
  startOver(token: string, password: string): Promise<{ recoveryCode: string }> {
    return this.serial(async () => {
      await this.checkStrength(password, this.email ? emailUserInputs(this.email) : []);
      const { accountId, material, unlocked, recoveryCode } = await createAccountMaterial({
        password, random: this.random, kdf: this.d.kdf, kdfCost: this.d.kdfCost,
      });
      // The material is bound (AAD) to the NEW account id, so the request carries it and the server re-keys the
      // account under it (its records are wiped anyway).
      const req: ResetConfirmRequest = {
        token, accountId, material, device: await this.device(unlocked), ...this.tokenFlag(),
      };
      const res = await this.d.api.resetConfirm(req);
      if (res.accountId !== accountId) throw new AccountError('damaged_keys');
      const u = unlocked;
      this.reencrypt = true;
      await this.establish(u, this.email, res);
      return { recoveryCode };
    });
  }

  /** Best-effort server logout, then forget the keys and token on this device. */
  signOut(opts: { wipeLocal: boolean }): Promise<void> {
    return this.serial(async () => {
      try {
        await this.d.api.logout();
      } catch {
        // Offline or already signed out: local sign-out still proceeds.
      }
      await this.forget(opts.wipeLocal);
    });
  }

  /** Deletes the account on the server (password re-checked there), then wipes this device. */
  deleteAccount(password: string): Promise<void> {
    return this.serial(async () => {
      const authKey = await this.currentAuthKey(await this.accountEmail(), password);
      try {
        await this.d.api.deleteAccount({ authKey });
      } catch (e) {
        throw mapCredentialError(e);
      }
      await this.forget(true);
    });
  }

  // ---------------------------------------------------------------------------------------------------------------

  /** One flow at a time: a sign-out during a sign-in must not interleave with it. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private tokenFlag(): { wantToken?: true } {
    return this.d.wantToken ? { wantToken: true } : {};
  }

  private kdfOpts(): { random: RandomSource; kdf?: KdfFn; kdfCost?: AccountClientDeps['kdfCost'] } {
    return { random: this.random, kdf: this.d.kdf, kdfCost: this.d.kdfCost };
  }

  private requireUnlocked(): UnlockedAccount {
    if (!this.current) throw new AccountError('not_signed_in');
    return this.current;
  }

  /** Before any Argon2 work. */
  private async checkStrength(password: string, userInputs: string[]): Promise<void> {
    const min = this.d.minStrength ?? 3;
    const { score, feedback } = await passwordStrength(password, userInputs);
    if (score < min) throw new WeakPasswordError(score, feedback);
  }

  private async device(u: UnlockedAccount): Promise<DeviceWire> {
    return { id: this.d.deviceId, nameSealed: await sealDeviceName(u, this.d.deviceId, this.d.deviceName(), this.random) };
  }

  private placeholderDevice(): DeviceWire {
    return { id: this.d.deviceId, nameSealed: UNSEALED_DEVICE_NAME };
  }

  /** prelogin → parse + floor check (KdfParamsError → unsafe_kdf, before Argon2) → derive. */
  private async deriveFor(email: string, password: string): Promise<{ authKey: Uint8Array; kek: Uint8Array }> {
    const { kdf } = await this.d.api.prelogin({ email });
    let params: KdfParams;
    try {
      params = kdfParamsFromJson(kdf);
      validateKdfParams(params);
    } catch (e) {
      if (e instanceof KdfParamsError) throw new AccountError('unsafe_kdf');
      throw e;
    }
    return derivePasswordKeys(password, params, this.d.kdf);
  }

  /** The current password's auth key (b64url) for `currentAuthKey` / `deleteAccount`; the KEK is discarded. */
  private async currentAuthKey(email: string, password: string): Promise<string> {
    const { authKey, kek } = await this.deriveFor(email, password);
    try {
      return b64urlEncode(authKey);
    } finally {
      authKey.fill(0);
      kek.fill(0);
    }
  }

  /** Cached from sign-in/up; after `resume` it is fetched once from the server. */
  private async accountEmail(): Promise<string> {
    this.email ??= (await this.d.api.account()).email;
    return this.email;
  }

  private async persist(u: UnlockedAccount): Promise<void> {
    const blob = serializeUnlocked(u);
    try {
      await this.d.secrets.set('sync.unlocked', blob);
    } finally {
      blob.fill(0);
    }
  }

  /** Store keys (+ token), publish status, notify the host. */
  private async establish(u: UnlockedAccount, email: string | null, res: SessionResponse): Promise<void> {
    await this.persist(u);
    if (res.token) await this.d.secrets.set('sync.token', utf8Encode(res.token));
    this.current = u;
    this.email = email;
    this.d.status.set({ state: 'idle', accountEmail: email ?? undefined, error: undefined });
    await this.d.onUnlocked?.(u);
  }

  private async forget(wipeLocal: boolean): Promise<void> {
    await this.d.secrets.delete('sync.unlocked');
    await this.d.secrets.delete('sync.token');
    this.current = null;
    this.email = null;
    this.reencrypt = false;
    this.d.status.set({ state: 'signed-out', accountEmail: undefined, lastSyncedAt: undefined, error: undefined, pending: 0, opaque: 0 });
    await this.d.onSignedOut?.();
    if (wipeLocal) await this.d.onWipe?.();
  }
}

