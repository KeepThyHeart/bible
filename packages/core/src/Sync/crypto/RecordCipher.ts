/** Record envelope (contracts 0063 §3; W1-B implements). */
import type { RandomSource } from '../../Crypto';
import type { RecordId, RecordPlaintext } from '../types';
import type { UnlockedAccount } from './keys';
import { notImplemented } from '../notImplemented';

/**
 * blob = 0x01 | u32be(epoch) | nonce(12) | AES-256-GCM(dataKey[epoch], padded, aad) (ct || tag16)
 * aad  = utf8("kth-rec-v1") || accountId(16 B) || recordId(16 B) || u32be(epoch)
 * padded = u32be(len(json)) || json || 0x00.. up to the next multiple of 1024 (json <= 64 KiB) or 16384 (larger)
 * Max plaintext json 1 MiB - 4 (RecordTooLargeError above).
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

export function createRecordCipher(u: UnlockedAccount, random?: RandomSource): RecordCipher {
  throw notImplemented(u, random);
}
