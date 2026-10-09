/**
 * Key hierarchy (contracts 0063 §2).
 *
 *   password --Argon2id(salt)--> master --HKDF(kth-auth-v1)--> authKey (server stores SHA-256)
 *                                       \-HKDF(kth-kek-v1)---> KEK  (never leaves the client)
 *   recovery code (160 bits) --HKDF(kth-recovery-wrap-v1)--> recovery wrapping key
 *                            \-HKDF(kth-recovery-auth-v1)--> recoveryAuthKey (server stores SHA-256)
 *   KEK / recovery wrapping key --wrap--> accountKey --wrap--> recordIdKey, dataKey[epoch]
 *
 * Every wrap is AES-256-GCM with a fresh 12-byte nonce; wire form b64url(nonce || ct || tag). No function here logs,
 * and no error message carries a key, password, code or plaintext.
 */
import {
  AuthError, DEFAULT_KDF, argon2id, b64urlEncode, concatBytes, defaultRandom, hexEncode, hkdfSha256,
  kdfParamsToJson, utf8Decode, utf8Encode, validateKdfParams,
} from '../../Crypto';
import type { KdfParams, KdfParamsJson, RandomSource } from '../../Crypto';
import type { AccountId, DeviceId } from '../types';
import { crockfordDecode, crockfordEncode } from './base32';
import { hmacSha256 } from './hmac';
import {
  aad, checkKey32, id16, id8, openB64, sealB64, u32be, unwrapKey, wipe, wrapKey,
} from './internal';
import { LABELS } from './labels';

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

type KdfFn = (password: string, params: KdfParams) => Promise<Uint8Array>;
type KdfCost = Partial<Pick<KdfParams, 'm' | 't' | 'p'>>;

const SALT_LEN = 16;
const RECOVERY_LEN = 20;
const UNLOCK_FAILED = 'Wrong password or damaged keys';
const RECOVERY_FAILED = 'Wrong recovery code or damaged keys';
const EMPTY = new Uint8Array(0);

// ---------------------------------------------------------------------------------------------------------------
// AADs (exported for tests only; not part of the Sync barrel)

export const akAad = (acct: Uint8Array, slot: 'password' | 'recovery'): Uint8Array =>
  aad(LABELS.akWrap, acct, utf8Encode(slot));
export const idkAad = (acct: Uint8Array): Uint8Array => aad(LABELS.idkWrap, acct);
export const dkAad = (acct: Uint8Array, epoch: number): Uint8Array => aad(LABELS.dkWrap, acct, u32be(epoch));
export const deviceNameAad = (acct: Uint8Array, dev: Uint8Array): Uint8Array => aad(LABELS.deviceName, acct, dev);

// ---------------------------------------------------------------------------------------------------------------

/** Password -> Argon2id (validated, NFC) -> HKDF split. `kdf` lets desktop run Argon2id in its worker. */
export async function derivePasswordKeys(
  password: string, params: KdfParams,
  kdf?: (password: string, params: KdfParams) => Promise<Uint8Array>,
): Promise<PasswordKeys> {
  // Refuse weak (or absurd) server-supplied parameters before any work, whichever KDF runs.
  validateKdfParams(params);
  const master = await (kdf ?? argon2id)(password.normalize('NFC'), params);
  try {
    if (!(master instanceof Uint8Array) || master.length < 32) throw new RangeError('KDF output too short');
    const authKey = await hkdfSha256(master, EMPTY, LABELS.auth, 32);
    const kek = await hkdfSha256(master, EMPTY, LABELS.kek, 32);
    return { authKey, kek };
  } finally {
    wipe(master);
  }
}

function kdfParams(cost: KdfCost | undefined, random: RandomSource): KdfParams {
  return {
    id: 'argon2id', v: 19,
    m: cost?.m ?? DEFAULT_KDF.m, t: cost?.t ?? DEFAULT_KDF.t, p: cost?.p ?? DEFAULT_KDF.p,
    salt: random.bytes(SALT_LEN),
  };
}

async function recoveryKeys(code: Uint8Array): Promise<{ wrap: Uint8Array; auth: Uint8Array }> {
  return {
    wrap: await hkdfSha256(code, EMPTY, LABELS.recoveryWrap, 32),
    auth: await hkdfSha256(code, EMPTY, LABELS.recoveryAuth, 32),
  };
}

function formatRecoveryCode(raw: Uint8Array): string {
  return crockfordEncode(raw).match(/.{4}/g)!.join('-');
}

async function passwordSlot(acct: Uint8Array, accountKey: Uint8Array, password: string, cost: KdfCost | undefined,
  random: RandomSource, kdf: KdfFn | undefined,
): Promise<{ kdf: KdfParamsJson; authKey: string; wrappedAkPassword: WrappedKey }> {
  const params = kdfParams(cost, random);
  const { authKey, kek } = await derivePasswordKeys(password, params, kdf);
  try {
    return {
      kdf: kdfParamsToJson(params),
      authKey: b64urlEncode(authKey),
      wrappedAkPassword: await wrapKey(kek, accountKey, akAad(acct, 'password'), random),
    };
  } finally {
    wipe(authKey, kek);
  }
}

async function recoverySlot(acct: Uint8Array, accountKey: Uint8Array, random: RandomSource,
): Promise<{ recoveryCode: string; recoveryAuthKey: string; wrappedAkRecovery: WrappedKey }> {
  const raw = random.bytes(RECOVERY_LEN);
  const { wrap, auth } = await recoveryKeys(raw);
  try {
    return {
      recoveryCode: formatRecoveryCode(raw),
      recoveryAuthKey: b64urlEncode(auth),
      wrappedAkRecovery: await wrapKey(wrap, accountKey, akAad(acct, 'recovery'), random),
    };
  } finally {
    wipe(raw, wrap, auth);
  }
}

/** Full wire material for an unlocked account (sign-up and rotation). Random draw order is part of the vectors. */
async function buildMaterial(u: UnlockedAccount, password: string, cost: KdfCost | undefined, random: RandomSource,
  kdf: KdfFn | undefined,
): Promise<{ material: AccountKeyMaterial; recoveryCode: string }> {
  const acct = id16(u.accountId, 'account id');
  const pw = await passwordSlot(acct, u.accountKey, password, cost, random, kdf);
  const rec = await recoverySlot(acct, u.accountKey, random);
  const wrappedRecordIdKey = await wrapKey(u.accountKey, u.recordIdKey, idkAad(acct), random);
  const keysets: KeysetWire[] = [];
  for (const epoch of [...u.dataKeys.keys()].sort((a, b) => a - b)) {
    keysets.push({ epoch, wrappedDataKey: await wrapKey(u.accountKey, u.dataKeys.get(epoch)!, dkAad(acct, epoch), random) });
  }
  return {
    material: {
      kdf: pw.kdf, authKey: pw.authKey, wrappedAkPassword: pw.wrappedAkPassword,
      recoveryAuthKey: rec.recoveryAuthKey, wrappedAkRecovery: rec.wrappedAkRecovery,
      wrappedRecordIdKey, keysets, currentEpoch: u.currentEpoch,
    },
    recoveryCode: rec.recoveryCode,
  };
}

/** New account: random accountId/accountKey/recordIdKey/epoch-0 data key, a fresh recovery code, and wire material. */
export async function createAccountMaterial(opts: {
  password: string; kdfCost?: Partial<Pick<KdfParams, 'm' | 't' | 'p'>>;
  random?: RandomSource; kdf?: (p: string, k: KdfParams) => Promise<Uint8Array>;
}): Promise<{ accountId: AccountId; material: AccountKeyMaterial; unlocked: UnlockedAccount; recoveryCode: string }> {
  const random = opts.random ?? defaultRandom;
  const accountId = hexEncode(random.bytes(16));
  const unlocked: UnlockedAccount = {
    accountId,
    accountKey: random.bytes(32),
    recordIdKey: random.bytes(32),
    dataKeys: new Map([[0, random.bytes(32)]]),
    currentEpoch: 0,
  };
  const { material, recoveryCode } = await buildMaterial(unlocked, opts.password, opts.kdfCost, random, opts.kdf);
  return { accountId, material, unlocked, recoveryCode };
}

/** Shared tail of both unlock paths: unwrap the record-id key and every data key under the account key. */
async function unlockRest(accountId: AccountId, acct: Uint8Array, accountKey: Uint8Array, wrappedIdk: WrappedKey,
  keysets: KeysetWire[], currentEpoch: number, message: string,
): Promise<UnlockedAccount> {
  const recordIdKey = await unwrapKey(accountKey, wrappedIdk, idkAad(acct), message);
  const dataKeys = new Map<number, Uint8Array>();
  for (const ks of keysets) {
    if (!Number.isInteger(ks.epoch) || ks.epoch < 0 || ks.epoch > 0xffffffff || dataKeys.has(ks.epoch)) {
      throw new AuthError(message);
    }
    dataKeys.set(ks.epoch, await unwrapKey(accountKey, ks.wrappedDataKey, dkAad(acct, ks.epoch), message));
  }
  if (!dataKeys.has(currentEpoch)) throw new AuthError(message);
  return { accountId, accountKey, recordIdKey, dataKeys, currentEpoch };
}

/** Unwrap after login (password path). Throws AuthError on any tag failure ("wrong password or damaged keys"). */
export async function unlockWithPassword(accountId: AccountId, kek: Uint8Array, wrappedAk: WrappedKey,
  wrappedIdk: WrappedKey, keysets: KeysetWire[], currentEpoch: number): Promise<UnlockedAccount> {
  const acct = id16(accountId, 'account id');
  const accountKey = await unwrapKey(kek, wrappedAk, akAad(acct, 'password'), UNLOCK_FAILED);
  try {
    return await unlockRest(accountId, acct, accountKey, wrappedIdk, keysets, currentEpoch, UNLOCK_FAILED);
  } catch (e) {
    wipe(accountKey);
    throw e;
  }
}

/** Unwrap with a recovery code (normalised by parseRecoveryCode first). */
export async function unlockWithRecoveryCode(accountId: AccountId, code: string, wrappedAkRecovery: WrappedKey,
  wrappedIdk: WrappedKey, keysets: KeysetWire[], currentEpoch: number): Promise<UnlockedAccount> {
  const acct = id16(accountId, 'account id');
  const raw = parseRecoveryCode(code);
  const { wrap, auth } = await recoveryKeys(raw);
  try {
    const accountKey = await unwrapKey(wrap, wrappedAkRecovery, akAad(acct, 'recovery'), RECOVERY_FAILED);
    try {
      return await unlockRest(accountId, acct, accountKey, wrappedIdk, keysets, currentEpoch, RECOVERY_FAILED);
    } catch (e) {
      wipe(accountKey);
      throw e;
    }
  } finally {
    wipe(raw, wrap, auth);
  }
}

/**
 * The recovery auth key for a code, for the `recover` request (server compares its SHA-256).
 * Not in the 0063 contract; AccountClient (W3-B) needs it to log in with a recovery code.
 */
export async function recoveryAuthKeyFor(code: string): Promise<string> {
  const raw = parseRecoveryCode(code);
  const { wrap, auth } = await recoveryKeys(raw);
  try {
    return b64urlEncode(auth);
  } finally {
    wipe(raw, wrap, auth);
  }
}

/**
 * Password change: new salt + auth key, re-wrap the SAME account key.
 * `kdfCost` (addition to the contract, optional) picks the Argon2id cost; default DEFAULT_KDF.
 */
export async function rewrapForNewPassword(u: UnlockedAccount, newPassword: string,
  opts?: { random?: RandomSource; kdf?: (p: string, k: KdfParams) => Promise<Uint8Array>; kdfCost?: KdfCost }):
  Promise<{ kdf: AccountKeyMaterial['kdf']; authKey: string; wrappedAkPassword: WrappedKey }> {
  const acct = id16(u.accountId, 'account id');
  checkKey32(u.accountKey, 'Account key');
  return passwordSlot(acct, u.accountKey, newPassword, opts?.kdfCost, opts?.random ?? defaultRandom, opts?.kdf);
}

/** New recovery code: re-wrap the account key; old recovery wrap is replaced server-side. */
export async function newRecoveryWrap(u: UnlockedAccount, random?: RandomSource):
  Promise<{ recoveryCode: string; recoveryAuthKey: string; wrappedAkRecovery: WrappedKey }> {
  const acct = id16(u.accountId, 'account id');
  checkKey32(u.accountKey, 'Account key');
  return recoverySlot(acct, u.accountKey, random ?? defaultRandom);
}

/**
 * Suspected compromise: new account key; ALL old data keys re-wrapped under it plus a new epoch; recordIdKey kept.
 * A new password slot (fresh salt) and a new recovery code are produced too. `opts` (addition to the contract,
 * optional) lets desktop run Argon2id in its worker and picks the cost; default DEFAULT_KDF.
 */
export async function rotateAccountKey(u: UnlockedAccount, password: string, random?: RandomSource,
  opts?: { kdf?: KdfFn; kdfCost?: KdfCost }):
  Promise<{ unlocked: UnlockedAccount; material: AccountKeyMaterial; recoveryCode: string }> {
  const rnd = random ?? defaultRandom;
  id16(u.accountId, 'account id');
  const epochs = [...u.dataKeys.keys()];
  const next = (epochs.length ? Math.max(...epochs) : -1) + 1;
  if (next > 0xffffffff) throw new RangeError('Epoch space exhausted');
  const dataKeys = new Map<number, Uint8Array>();
  for (const [e, k] of u.dataKeys) dataKeys.set(e, k.slice());
  const accountKey = rnd.bytes(32);
  dataKeys.set(next, rnd.bytes(32));
  const unlocked: UnlockedAccount = {
    accountId: u.accountId, accountKey, recordIdKey: u.recordIdKey.slice(), dataKeys, currentEpoch: next,
  };
  const { material, recoveryCode } = await buildMaterial(unlocked, password, opts?.kdfCost, rnd, opts?.kdf);
  return { unlocked, material, recoveryCode };
}

/** Recovery code: 160 random bits as 32 Crockford base32 chars, shown as 8 groups of 4 ("ABCD-EFGH-..."). */
export function generateRecoveryCode(random?: RandomSource): string {
  const raw = (random ?? defaultRandom).bytes(RECOVERY_LEN);
  try {
    return formatRecoveryCode(raw);
  } finally {
    wipe(raw);
  }
}
/** Accepts any case, spaces/dashes, and Crockford aliases (O->0, I/L->1); throws RangeError if not 160 bits. */
export function parseRecoveryCode(input: string): Uint8Array {
  const raw = crockfordDecode(input);
  if (raw.length !== RECOVERY_LEN) {
    wipe(raw);
    throw new RangeError('A recovery code has 32 characters');
  }
  return raw;
}

/**
 * Deterministic id for natural-key records (ext KV, reading progress): first 16 B of
 * HMAC-SHA256(recordIdKey, "kth-recid-v1" || 0x00 || scope || 0x00 || key). The domain label is prefixed so the
 * record-id key could never be confused with another HMAC use; `scope` must not contain NUL (unambiguous split).
 */
export async function deriveRecordId(recordIdKey: Uint8Array, scope: string, naturalKey: string): Promise<string> {
  checkKey32(recordIdKey, 'Record id key');
  if (scope.includes('\0')) throw new RangeError('Record id scope must not contain NUL');
  const zero = Uint8Array.of(0);
  const mac = await hmacSha256(recordIdKey,
    concatBytes(utf8Encode(LABELS.recordId), zero, utf8Encode(scope), zero, utf8Encode(naturalKey)));
  return hexEncode(mac.subarray(0, 16));
}

/** Device names are encrypted under the account key (AAD = deviceName || accountId || deviceId). */
export async function sealDeviceName(u: UnlockedAccount, deviceId: DeviceId, name: string, random?: RandomSource,
): Promise<string> {
  const ad = deviceNameAad(id16(u.accountId, 'account id'), id8(deviceId, 'device id'));
  return sealB64(u.accountKey, utf8Encode(name), ad, random ?? defaultRandom);
}
export async function openDeviceName(u: UnlockedAccount, deviceId: DeviceId, sealed: string): Promise<string> {
  const ad = deviceNameAad(id16(u.accountId, 'account id'), id8(deviceId, 'device id'));
  const pt = await openB64(u.accountKey, sealed, ad, 'Device name could not be decrypted');
  try {
    return utf8Decode(pt);
  } catch {
    throw new AuthError('Device name could not be decrypted');
  }
}

/** 0078 floor/ceiling applies; a server offering lower params is refused (KdfParamsError) before any work. */
export { validateKdfParams } from '../../Crypto';
