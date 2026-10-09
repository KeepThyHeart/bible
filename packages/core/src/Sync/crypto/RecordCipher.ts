/** Record envelope (contracts 0063 §3). */
import {
  AuthError, aesGcmOpenKey, aesGcmSealKey, concatBytes, defaultRandom, importAesKey, utf8Decode, utf8Encode,
} from '../../Crypto';
import type { AesKey } from '../../Crypto/aesGcm';
import type { RandomSource } from '../../Crypto';
import type { RecordId, RecordPlaintext } from '../types';
import type { UnlockedAccount } from './keys';
import { NONCE_LEN, TAG_LEN, checkKey32, id16, readU32be, u32be } from './internal';
import { LABELS } from './labels';

/**
 * blob = 0x01 | u32be(epoch) | nonce(12) | AES-256-GCM(dataKey[epoch], padded, aad) (ct || tag16)
 * aad  = utf8("kth-rec-v1") || version(1 B, = blob[0]) || accountId(16 B) || recordId(16 B) || u32be(epoch)
 * padded = u32be(len(json)) || json || 0x00.. up to the next multiple of 1024 (json <= 64 KiB) or 16384 (larger)
 * Max plaintext json 1 MiB - 4 (RecordTooLargeError above).
 *
 * The version byte is bound into the AAD (0150 W1-B) so a future envelope version can never be replayed as v1.
 */
export const RECORD_BLOB_VERSION = 1;
export const MAX_RECORD_JSON = 1024 * 1024 - 4;

export class RecordTooLargeError extends Error {}
/** Blob version or epoch this client cannot read (keep the record opaque; do not treat as damage). */
export class UnknownEpochError extends Error {}

export interface RecordCipher {
  seal(id: RecordId, pt: RecordPlaintext): Promise<Uint8Array>;
  /** Throws AuthError on tamper/swap (AAD mismatch), UnknownEpochError, or SyntaxError for bad JSON. */
  open(id: RecordId, blob: Uint8Array): Promise<RecordPlaintext>;
  /** Count of seals under the current epoch this session; engine asks for a new epoch after 2^30. */
  readonly sealsThisEpoch: number;
}

const HEADER_LEN = 1 + 4 + NONCE_LEN;
const SMALL_BUCKET = 1024;
const LARGE_BUCKET = 16384;
const SMALL_LIMIT = 64 * 1024;
const OPEN_FAILED = 'Record could not be decrypted';

/** Exported for tests only (not in the Sync barrel). */
export function recordAad(version: number, acct: Uint8Array, rid: Uint8Array, epoch: number): Uint8Array {
  return concatBytes(utf8Encode(LABELS.record), Uint8Array.of(version), acct, rid, u32be(epoch));
}

/** Padded length for a JSON body of `jsonLen` bytes (exported for tests). */
export function paddedLength(jsonLen: number): number {
  const bucket = jsonLen <= SMALL_LIMIT ? SMALL_BUCKET : LARGE_BUCKET;
  return Math.ceil((4 + jsonLen) / bucket) * bucket;
}

function pad(json: Uint8Array): Uint8Array {
  const out = new Uint8Array(paddedLength(json.length));
  out.set(u32be(json.length), 0);
  out.set(json, 4);
  return out;
}

function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 4) throw new SyntaxError('Malformed record padding');
  const len = readU32be(padded, 0);
  if (len > padded.length - 4 || padded.length !== paddedLength(len)) throw new SyntaxError('Malformed record padding');
  let nz = 0;
  for (let i = 4 + len; i < padded.length; i++) nz |= padded[i];
  if (nz !== 0) throw new SyntaxError('Malformed record padding');
  return padded.subarray(4, 4 + len);
}

function parsePlaintext(json: Uint8Array): RecordPlaintext {
  let v: unknown;
  try {
    v = JSON.parse(utf8Decode(json));
  } catch {
    // JSON.parse / TextDecoder messages quote the input: never let decrypted content reach an error message.
    throw new SyntaxError('Record content is not valid JSON');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SyntaxError('Record content is not an object');
  const o = v as Record<string, unknown>;
  if (typeof o.t !== 'string' || typeof o.cv !== 'number' || typeof o.h !== 'string' || typeof o.dev !== 'string'
    || typeof o.d !== 'object' || o.d === null || Array.isArray(o.d)) {
    throw new SyntaxError('Record content has the wrong shape');
  }
  return o as unknown as RecordPlaintext;
}

export function createRecordCipher(u: UnlockedAccount, random?: RandomSource): RecordCipher {
  const rnd = random ?? defaultRandom;
  const acct = id16(u.accountId, 'account id');
  const keys = new Map<number, Promise<AesKey>>();
  let seals = 0;
  let sealEpoch = u.currentEpoch;

  const keyFor = (epoch: number): Promise<AesKey> | null => {
    let k = keys.get(epoch);
    if (!k) {
      const raw = u.dataKeys.get(epoch);
      if (!raw) return null;
      checkKey32(raw, 'Data key');
      k = importAesKey(raw);
      keys.set(epoch, k);
    }
    return k;
  };

  return {
    get sealsThisEpoch() {
      return sealEpoch === u.currentEpoch ? seals : 0;
    },

    async seal(id: RecordId, pt: RecordPlaintext): Promise<Uint8Array> {
      const rid = id16(id, 'record id');
      const epoch = u.currentEpoch;
      const json = utf8Encode(JSON.stringify(pt));
      if (json.length > MAX_RECORD_JSON) throw new RecordTooLargeError(`Record is ${json.length} bytes; the limit is ${MAX_RECORD_JSON}`);
      const key = keyFor(epoch);
      if (!key) throw new UnknownEpochError('No data key for the current epoch');
      const nonce = rnd.bytes(NONCE_LEN);
      const ct = await aesGcmSealKey(await key, nonce, pad(json), recordAad(RECORD_BLOB_VERSION, acct, rid, epoch));
      if (sealEpoch !== epoch) {
        sealEpoch = epoch;
        seals = 0;
      }
      seals++;
      return concatBytes(Uint8Array.of(RECORD_BLOB_VERSION), u32be(epoch), nonce, ct);
    },

    async open(id: RecordId, blob: Uint8Array): Promise<RecordPlaintext> {
      const rid = id16(id, 'record id');
      if (!(blob instanceof Uint8Array) || blob.length < 1) throw new AuthError(OPEN_FAILED);
      if (blob[0] !== RECORD_BLOB_VERSION) throw new UnknownEpochError('Unsupported record version');
      if (blob.length < HEADER_LEN + TAG_LEN) throw new AuthError(OPEN_FAILED);
      const epoch = readU32be(blob, 1);
      const key = keyFor(epoch);
      if (!key) throw new UnknownEpochError('Record uses an unknown key epoch');
      const nonce = blob.subarray(5, HEADER_LEN);
      const padded = await aesGcmOpenKey(await key, nonce, blob.subarray(HEADER_LEN),
        recordAad(blob[0], acct, rid, epoch));
      return parsePlaintext(unpad(padded));
    },
  };
}
