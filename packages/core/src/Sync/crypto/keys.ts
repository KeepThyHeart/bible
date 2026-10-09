/** Key hierarchy (contracts 0063 §2; W1-B implements). */
import type { KdfParams, KdfParamsJson, RandomSource } from '../../Crypto';
import type { AccountId, DeviceId } from '../types';
import { notImplemented } from '../notImplemented';

/** Output of Argon2id(password) split by HKDF (salt empty, 32 bytes each). */
export interface PasswordKeys { authKey: Uint8Array; kek: Uint8Array }

/** Everything a signed-in, unlocked device holds in memory. Never serialised except through ISecretStore. */
export interface UnlockedAccount {
  accountId: AccountId;
  accountKey: Uint8Array;                 // 32 B random, created at sign-up (new one only on "rotate")
  recordIdKey: Uint8Array;                // 32 B random, created at sign-up, survives rotation
  dataKeys: Map<number, Uint8Array>;      // epoch -> 32 B data key
  currentEpoch: number;
}

/** Wire form of a wrapped key: b64url(nonce 12 || ciphertext 32 || tag 16). */
export type WrappedKey = string;

export interface KeysetWire { epoch: number; wrappedDataKey: WrappedKey }

/** Material the client sends at sign-up / "start over" (all key fields already wrapped). */
export interface AccountKeyMaterial {
  kdf: KdfParamsJson;
  authKey: string;                 // b64url(32); server stores SHA-256
  wrappedAkPassword: WrappedKey;   // AAD = akWrap || accountId(16) || "password"
  recoveryAuthKey: string;         // b64url(32); server stores SHA-256
  wrappedAkRecovery: WrappedKey;   // AAD = akWrap || accountId(16) || "recovery"
  wrappedRecordIdKey: WrappedKey;  // under accountKey, AAD = idkWrap || accountId(16)
  keysets: KeysetWire[];           // AAD = dkWrap || accountId(16) || u32be(epoch)
  currentEpoch: number;
}

/** Password -> Argon2id (validated, NFC) -> HKDF split. `kdf` lets desktop run Argon2id in its worker. */
export function derivePasswordKeys(
  password: string, params: KdfParams,
  kdf?: (password: string, params: KdfParams) => Promise<Uint8Array>,
): Promise<PasswordKeys> {
  throw notImplemented(password, params, kdf);
}

/** New account: random accountId/accountKey/recordIdKey/epoch-0 data key, a fresh recovery code, and wire material. */
export function createAccountMaterial(opts: {
  password: string; kdfCost?: Partial<Pick<KdfParams, 'm' | 't' | 'p'>>;
  random?: RandomSource; kdf?: (p: string, k: KdfParams) => Promise<Uint8Array>;
}): Promise<{ accountId: AccountId; material: AccountKeyMaterial; unlocked: UnlockedAccount; recoveryCode: string }> {
  throw notImplemented(opts);
}

/** Unwrap after login (password path). Throws AuthError on any tag failure ("wrong password or damaged keys"). */
export function unlockWithPassword(accountId: AccountId, kek: Uint8Array, wrappedAk: WrappedKey,
  wrappedIdk: WrappedKey, keysets: KeysetWire[], currentEpoch: number): Promise<UnlockedAccount> {
  throw notImplemented(accountId, kek, wrappedAk, wrappedIdk, keysets, currentEpoch);
}

/** Unwrap with a recovery code (normalised by parseRecoveryCode first). */
export function unlockWithRecoveryCode(accountId: AccountId, code: string, wrappedAkRecovery: WrappedKey,
  wrappedIdk: WrappedKey, keysets: KeysetWire[], currentEpoch: number): Promise<UnlockedAccount> {
  throw notImplemented(accountId, code, wrappedAkRecovery, wrappedIdk, keysets, currentEpoch);
}

/** Password change: new salt + auth key, re-wrap the SAME account key. */
export function rewrapForNewPassword(u: UnlockedAccount, newPassword: string,
  opts?: { random?: RandomSource; kdf?: (p: string, k: KdfParams) => Promise<Uint8Array> }):
  Promise<{ kdf: AccountKeyMaterial['kdf']; authKey: string; wrappedAkPassword: WrappedKey }> {
  throw notImplemented(u, newPassword, opts);
}

/** New recovery code: re-wrap the account key; old recovery wrap is replaced server-side. */
export function newRecoveryWrap(u: UnlockedAccount, random?: RandomSource):
  Promise<{ recoveryCode: string; recoveryAuthKey: string; wrappedAkRecovery: WrappedKey }> {
  throw notImplemented(u, random);
}

/** Suspected compromise: new account key; ALL old data keys re-wrapped under it plus a new epoch; recordIdKey kept. */
export function rotateAccountKey(u: UnlockedAccount, password: string, random?: RandomSource):
  Promise<{ unlocked: UnlockedAccount; material: AccountKeyMaterial; recoveryCode: string }> {
  throw notImplemented(u, password, random);
}

/** Recovery code: 160 random bits as 32 Crockford base32 chars, shown as 8 groups of 4 ("ABCD-EFGH-..."). */
export function generateRecoveryCode(random?: RandomSource): string {
  throw notImplemented(random);
}
/** Accepts any case, spaces/dashes, and Crockford aliases (O->0, I/L->1); throws RangeError if not 160 bits. */
export function parseRecoveryCode(input: string): Uint8Array {
  throw notImplemented(input);
}

/** Deterministic id for natural-key records (ext KV, reading progress): first 16 B of HMAC-SHA256(recordIdKey, scope || 0x00 || key). */
export function deriveRecordId(recordIdKey: Uint8Array, scope: string, naturalKey: string): Promise<string> {
  throw notImplemented(recordIdKey, scope, naturalKey);
}

/** Device names are encrypted under the account key (AAD = deviceName || accountId || deviceId). */
export function sealDeviceName(u: UnlockedAccount, deviceId: DeviceId, name: string): Promise<string> {
  throw notImplemented(u, deviceId, name);
}
export function openDeviceName(u: UnlockedAccount, deviceId: DeviceId, sealed: string): Promise<string> {
  throw notImplemented(u, deviceId, sealed);
}

/** 0078 floor/ceiling applies; a server offering lower params is refused (KdfParamsError) before any work. */
export { validateKdfParams } from '../../Crypto';
