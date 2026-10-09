/**
 * Request validation for the account routes. Each check throws `ApiHttpError('bad_request')` with a short,
 * secret-free message (never echoing the offending value).
 */
import { Crypto, type Sync } from '@bible/core';
import { ApiHttpError } from '../http';
import { b64urlToBytes } from './tokens';
import { canonicalKdf } from './prelogin';

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
/** b64url(nonce 12 || ciphertext 32 || tag 16). */
const WRAPPED_KEY_BYTES = 60;
const MAX_NAME_SEALED = 1024;
const MAX_KEYSETS = 256;
const MAX_EMAIL = 254;

export function bad(message: string): never {
  throw new ApiHttpError(400, 'bad_request', message);
}

export function obj(v: unknown, what = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(`${what} must be an object`);
  return v as Record<string, unknown>;
}

/** Lower-cased, NFC, trimmed. Undefined when it does not look like an email address. */
export function normaliseEmail(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const e = v.trim().normalize('NFC').toLowerCase();
  if (e.length < 3 || e.length > MAX_EMAIL) return undefined;
  if (!/^[^\s@]+@[^\s@]+$/u.test(e)) return undefined;
  return e;
}

export function email(v: unknown): string {
  return normaliseEmail(v) ?? bad('invalid email');
}

export function accountId(v: unknown): string {
  return typeof v === 'string' && HEX32.test(v) ? v : bad('invalid accountId');
}

export function deviceWire(v: unknown): Sync.DeviceWire {
  const d = obj(v, 'device');
  if (typeof d.id !== 'string' || !HEX16.test(d.id)) bad('invalid device id');
  if (typeof d.nameSealed !== 'string' || d.nameSealed.length === 0 || d.nameSealed.length > MAX_NAME_SEALED
    || !b64urlToBytes(d.nameSealed)) bad('invalid device name');
  return { id: d.id as string, nameSealed: d.nameSealed as string };
}

/** b64url of exactly 32 bytes (auth keys). */
export function key32(v: unknown, what: string): string {
  const b = b64urlToBytes(v);
  return b && b.length === 32 ? (v as string) : bad(`invalid ${what}`);
}

export function wrappedKey(v: unknown, what: string): string {
  const b = b64urlToBytes(v);
  return b && b.length === WRAPPED_KEY_BYTES ? (v as string) : bad(`invalid ${what}`);
}

export function kdf(v: unknown): Sync.KdfParamsJson {
  try {
    const parsed = Crypto.kdfParamsFromJson(v);
    Crypto.validateKdfParams(parsed);
    return canonicalKdf(Crypto.kdfParamsToJson(parsed));
  } catch {
    return bad('invalid kdf parameters');
  }
}

function epoch(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : bad('invalid epoch');
}

export function keysets(v: unknown, currentEpoch: number): Sync.KeysetWire[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_KEYSETS) bad('invalid keysets');
  const seen = new Set<number>();
  const out = (v as unknown[]).map((k) => {
    const o = obj(k, 'keyset');
    const e = epoch(o.epoch);
    if (seen.has(e)) bad('duplicate keyset epoch');
    seen.add(e);
    return { epoch: e, wrappedDataKey: wrappedKey(o.wrappedDataKey, 'wrappedDataKey') };
  });
  if (!seen.has(currentEpoch)) bad('keysets lack the current epoch');
  return out.sort((a, b) => a.epoch - b.epoch);
}

export function material(v: unknown): Sync.AccountKeyMaterial {
  const m = obj(v, 'material');
  const currentEpoch = epoch(m.currentEpoch);
  return {
    kdf: kdf(m.kdf),
    authKey: key32(m.authKey, 'authKey'),
    wrappedAkPassword: wrappedKey(m.wrappedAkPassword, 'wrappedAkPassword'),
    recoveryAuthKey: key32(m.recoveryAuthKey, 'recoveryAuthKey'),
    wrappedAkRecovery: wrappedKey(m.wrappedAkRecovery, 'wrappedAkRecovery'),
    wrappedRecordIdKey: wrappedKey(m.wrappedRecordIdKey, 'wrappedRecordIdKey'),
    keysets: keysets(m.keysets, currentEpoch),
    currentEpoch,
  };
}

export function bool(v: unknown, what: string): boolean {
  return typeof v === 'boolean' ? v : bad(`invalid ${what}`);
}

export function optBool(v: unknown, what: string): boolean {
  return v === undefined ? false : bool(v, what);
}
