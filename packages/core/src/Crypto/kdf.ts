import { KdfParamsError } from './errors';
import { b64urlDecode, b64urlEncode } from './bytes';

/**
 * Argon2id parameters as they appear in files and on the wire. Same shape as the
 * `kdf_params` the sync server stores (task 0063), so one validator serves both.
 */
export interface KdfParams {
  id: 'argon2id';
  /** Argon2 version; only 0x13 (19) exists. */
  v: 19;
  /** Memory in KiB. */
  m: number;
  /** Iterations. */
  t: number;
  /** Parallelism. */
  p: number;
  salt: Uint8Array;
}

/** JSON form of KdfParams (salt as base64url). */
export interface KdfParamsJson {
  id: 'argon2id';
  v: 19;
  m: number;
  t: number;
  p: number;
  salt: string;
}

/** Defaults: 64 MiB, 3 passes, 1 lane. */
export const DEFAULT_KDF = { m: 65536, t: 3, p: 1 } as const;
/** Floor (OWASP minimum for Argon2id: 19 MiB, t=2) and ceiling (denial-of-service guard). */
export const KDF_LIMITS = {
  minM: 19456,
  maxM: 1024 * 1024,
  minT: 2,
  maxT: 10,
  minP: 1,
  maxP: 4,
  minSalt: 16,
  maxSalt: 64,
} as const;

/** Throws `KdfParamsError` unless the parameters are inside the floor and ceiling. Call before any work. */
export function validateKdfParams(p: KdfParams): void {
  if (!p || p.id !== 'argon2id') throw new KdfParamsError('Unsupported KDF');
  if (p.v !== 19) throw new KdfParamsError('Unsupported Argon2 version');
  const int = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
  if (!int(p.m) || !int(p.t) || !int(p.p)) throw new KdfParamsError('KDF parameters must be integers');
  if (p.m < KDF_LIMITS.minM) throw new KdfParamsError('KDF memory below the minimum');
  if (p.m > KDF_LIMITS.maxM) throw new KdfParamsError('KDF memory above the maximum');
  if (p.t < KDF_LIMITS.minT) throw new KdfParamsError('KDF iterations below the minimum');
  if (p.t > KDF_LIMITS.maxT) throw new KdfParamsError('KDF iterations above the maximum');
  if (p.p < KDF_LIMITS.minP || p.p > KDF_LIMITS.maxP) throw new KdfParamsError('KDF parallelism out of range');
  if (!(p.salt instanceof Uint8Array) || p.salt.length < KDF_LIMITS.minSalt || p.salt.length > KDF_LIMITS.maxSalt) {
    throw new KdfParamsError('KDF salt length out of range');
  }
}

export function kdfParamsToJson(p: KdfParams): KdfParamsJson {
  return { id: p.id, v: p.v, m: p.m, t: p.t, p: p.p, salt: b64urlEncode(p.salt) };
}

/** Parse untrusted JSON into KdfParams (does not check the floor; call `validateKdfParams`). */
export function kdfParamsFromJson(j: unknown): KdfParams {
  if (typeof j !== 'object' || j === null) throw new KdfParamsError('Malformed KDF parameters');
  const o = j as Record<string, unknown>;
  if (typeof o.salt !== 'string') throw new KdfParamsError('Malformed KDF salt');
  let salt: Uint8Array;
  try {
    salt = b64urlDecode(o.salt);
  } catch {
    throw new KdfParamsError('Malformed KDF salt');
  }
  return { id: o.id as 'argon2id', v: o.v as 19, m: o.m as number, t: o.t as number, p: o.p as number, salt };
}

/**
 * Argon2id via hash-wasm (WebAssembly; loaded lazily so importing this module
 * costs nothing until a password is actually hashed). Validates first.
 */
export async function argon2id(password: string, p: KdfParams, outLen = 32): Promise<Uint8Array> {
  validateKdfParams(p);
  const { argon2id: hash } = await import('hash-wasm');
  return hash({
    password: password.normalize('NFKC'),
    salt: p.salt,
    parallelism: p.p,
    iterations: p.t,
    memorySize: p.m,
    hashLength: outLen,
    outputType: 'binary',
  });
}

/**
 * Argon2id without the floor: ONLY for known-answer tests against reference
 * vectors that use small parameters. Not exported from the barrel.
 */
export async function argon2idUnchecked(password: Uint8Array | string, salt: Uint8Array, m: number, t: number, p: number, outLen = 32): Promise<Uint8Array> {
  const { argon2id: hash } = await import('hash-wasm');
  return hash({ password, salt, parallelism: p, iterations: t, memorySize: m, hashLength: outLen, outputType: 'binary' });
}
