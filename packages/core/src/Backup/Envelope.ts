/**
 * The encrypted backup container (`.bbk`), format version 1.
 *
 * ```
 * preamble   16 bytes   magic(8) | major u16 BE | minor u16 BE | headerLength u32 BE
 * header     JSON       key slots and stream parameters (UTF-8, at most 64 KiB)
 * segments   ...        AES-256-GCM, `segmentSize` plaintext bytes each (the last: 0..segmentSize),
 *                       every one followed by its 16-byte tag; no length prefixes
 * ```
 *
 * The plaintext (a ZIP, see `Payload.ts`) is encrypted in independent segments
 * with a counter nonce and a "last segment" flag in the nonce - the STREAM
 * construction used by Tink's AES-GCM-HKDF streaming and by age. Memory stays
 * bounded for any payload size, and truncation, reordering, duplication and
 * splicing from another file all fail authentication.
 *
 * Key hierarchy: a random 32-byte *file key* is wrapped by each key slot. A
 * password slot wraps it under `HKDF(Argon2id(password))`; an account slot under
 * `HKDF(accountKey)` (no KDF, no identifier in the header); a recovery slot under
 * `HKDF(recovery code, salt)`. Other slot types can be added later without
 * changing the format; readers ignore slot types they do not know.
 *
 * Everything here is browser-safe: WebCrypto plus `hash-wasm` for Argon2id.
 */
import {
  AES_TAG_LEN, AuthError, KdfParamsError, aesGcmOpenKey, aesGcmSealKey, argon2id, b64urlDecode, b64urlEncode,
  bytesEqual, concatBytes, defaultRandom, hkdfSha256, importAesKey, kdfParamsFromJson, kdfParamsToJson, sha256,
  utf8Decode, utf8Encode, validateKdfParams, DEFAULT_KDF,
} from '../Crypto';
import type { KdfParams, KdfParamsJson, RandomSource } from '../Crypto';
import { parseStrictJson } from './StrictJson';
import { DamagedError, NewerFormatError, NotABackupError, WrongPasswordError } from './errors';
import type { ByteSource } from './Streams';

/** PNG-style magic: 0x89 catches 7-bit transfers, CR LF and 0x1A catch newline/EOF mangling, "KTHB" is greppable. */
export const MAGIC = Uint8Array.from([0x89, 0x4b, 0x54, 0x48, 0x42, 0x0d, 0x0a, 0x1a]);
export const FORMAT_MAJOR = 1;
export const FORMAT_MINOR = 0;
export const PREAMBLE_LEN = 16;
export const MAX_HEADER_LEN = 65536;
export const DEFAULT_SEGMENT_SIZE = 65536;
export const MIN_SEGMENT_SIZE = 4096;
export const MAX_SEGMENT_SIZE = 4 * 1024 * 1024;
export const MAX_SLOTS = 16;

export const AEAD_ID = 'aes-256-gcm-stream';
export const PAYLOAD_ZIP = 'zip';

const LABEL_KEK = 'kth-backup-kek-v1';
const LABEL_SLOT = 'kth-backup-slot-v1';
const LABEL_STREAM = 'kth-backup-stream-v1';
const LABEL_COMMIT = 'kth-backup-commit-v1';
/**
 * Local copies of Sync's `LABELS.backupAccountSlot` / `LABELS.backupRecoverySlot`: Backup must not import Sync
 * (a test asserts they are equal). Never change them: files in the wild depend on them.
 */
const BACKUP_ACCOUNT_SLOT_LABEL = 'kth-backup-wrap-v1';
const BACKUP_RECOVERY_SLOT_LABEL = 'kth-backup-recovery-v1';
/** A recovery code is 160 bits: 32 Crockford base32 characters. */
const RECOVERY_BYTES = 20;

/** At most this many password slots are tried when opening, so one file cannot demand unbounded key derivations. */
export const MAX_SLOT_ATTEMPTS = 4;

export interface PasswordSlotHeader {
  type: 'password';
  kdf: KdfParamsJson;
  nonce: string;
  wrapped: string;
}
/** Wraps the file key under a key derived from the account key (no password prompt; the account key is 32 random bytes). */
export interface AccountSlotHeader {
  type: 'account';
  nonce: string;
  wrapped: string;
}
/** Wraps the file key under a key derived from the 160-bit recovery code and a per-slot salt. No Argon2: the code is random. */
export interface RecoverySlotHeader {
  type: 'recovery';
  salt: string;
  nonce: string;
  wrapped: string;
}
export interface UnknownSlotHeader {
  type: string;
  [k: string]: unknown;
}

export interface EnvelopeHeader {
  payload: string;
  aead: string;
  segmentSize: number;
  streamSalt: string;
  noncePrefix: string;
  /** Key commitment: HKDF(fileKey, streamSalt, "kth-backup-commit-v1"). Binds every slot to one file key. */
  keyCheck: string;
  slots: Array<PasswordSlotHeader | AccountSlotHeader | RecoverySlotHeader | UnknownSlotHeader>;
  [k: string]: unknown;
}

/** Derives the 32-byte master secret from a password. Desktop injects one that runs in a worker thread. */
export type KdfFunction = (password: string, params: KdfParams) => Promise<Uint8Array>;

export interface PasswordSlotInput {
  type: 'password';
  password: string;
  /** Override the default cost (still bounded by the floor and ceiling). */
  kdf?: Partial<Pick<KdfParams, 'm' | 't' | 'p'>>;
}
export interface AccountSlotInput {
  type: 'account';
  /** The 32-byte account key of the signed-in account. */
  accountKey: Uint8Array;
}
export interface RecoverySlotInput {
  type: 'recovery';
  /** The account's recovery code (any case, dashes and spaces ignored; Crockford aliases accepted). */
  code: string;
}
/** A writer needs at least one `password` or `recovery` slot: an account slot alone would make the file unreadable without the account. */
export type KeySlotInput = PasswordSlotInput | AccountSlotInput | RecoverySlotInput;

export interface SealOptions {
  segmentSize?: number;
  random?: RandomSource;
  kdf?: KdfFunction;
}

export interface OpenOptions {
  kdf?: KdfFunction;
}

/** How to open a file: with its password, with the account key, or with the recovery code. */
export type UnlockInput = { password: string } | { accountKey: Uint8Array } | { recoveryCode: string };

export type SniffResult = 'bbk' | 'zip' | 'unknown';

/** Tell an encrypted backup from a plain ZIP export from anything else, given the first bytes of a file. */
export function sniff(first: Uint8Array): SniffResult {
  if (first.length >= MAGIC.length && bytesEqual(first.subarray(0, MAGIC.length), MAGIC)) return 'bbk';
  if (first.length >= 4 && first[0] === 0x50 && first[1] === 0x4b
    && ((first[2] === 0x03 && first[3] === 0x04) || (first[2] === 0x05 && first[3] === 0x06))) return 'zip';
  return 'unknown';
}

// --- helpers -----------------------------------------------------------------

function buildPreamble(headerLen: number): Uint8Array {
  const p = new Uint8Array(PREAMBLE_LEN);
  p.set(MAGIC, 0);
  const dv = new DataView(p.buffer);
  dv.setUint16(8, FORMAT_MAJOR, false);
  dv.setUint16(10, FORMAT_MINOR, false);
  dv.setUint32(12, headerLen, false);
  return p;
}

function segmentNonce(prefix: Uint8Array, index: number, last: boolean): Uint8Array {
  const n = new Uint8Array(12);
  n.set(prefix, 0);
  new DataView(n.buffer).setUint32(7, index, false);
  n[11] = last ? 1 : 0;
  return n;
}

async function kekFromSecret(secret: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(secret, new Uint8Array(0), LABEL_KEK, 32);
}

function slotAad(preambleHash: Uint8Array): Uint8Array {
  return concatBytes(utf8Encode(LABEL_SLOT), preambleHash);
}

/** Account and recovery slots bind their type into the AAD, so a slot cannot be replayed as another type. */
function typedSlotAad(preambleHash: Uint8Array, type: 'account' | 'recovery'): Uint8Array {
  return concatBytes(slotAad(preambleHash), Uint8Array.of(0), utf8Encode(type));
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Parse a recovery code to its 20 bytes: any case, whitespace and dashes ignored, O->0 and I/L->1. Same rules as
 * Sync's `parseRecoveryCode` (a test keeps them equal), reimplemented here because Backup must not import Sync.
 * Throws RangeError (never echoing the input) when it is not exactly 32 valid characters.
 */
function parseBackupRecoveryCode(input: string): Uint8Array {
  const clean = String(input).replace(/[\s-]/g, '').toUpperCase();
  if (clean.length !== RECOVERY_BYTES * 8 / 5) throw new RangeError('A recovery code has 32 characters');
  const out = new Uint8Array(RECOVERY_BYTES);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] === 'O' ? '0' : clean[i] === 'I' || clean[i] === 'L' ? '1' : clean[i];
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) throw new RangeError('Invalid recovery code character');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

async function accountKek(accountKey: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(accountKey, new Uint8Array(0), BACKUP_ACCOUNT_SLOT_LABEL, 32);
}

async function recoveryKek(codeBytes: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  return hkdfSha256(codeBytes, salt, BACKUP_RECOVERY_SLOT_LABEL, 32);
}

const defaultKdf: KdfFunction = (password, params) => argon2id(password, params, 32);

/** Buffered reader over a byte source: read exactly n bytes, or whatever remains. */
class ByteReader {
  private queue: Uint8Array[] = [];
  private queued = 0;
  private done = false;
  private readonly it: AsyncIterator<Uint8Array> | Iterator<Uint8Array>;

  constructor(source: ByteSource) {
    const s = source as AsyncIterable<Uint8Array> & Iterable<Uint8Array>;
    this.it = (s[Symbol.asyncIterator] ? s[Symbol.asyncIterator]() : s[Symbol.iterator]()) as AsyncIterator<Uint8Array>;
  }

  /** Ensure at least `n` bytes are buffered, unless the source ends first. */
  async fill(n: number): Promise<void> {
    while (this.queued < n && !this.done) {
      const r = await this.it.next();
      if (r.done) {
        this.done = true;
        break;
      }
      if (r.value.length > 0) {
        this.queue.push(r.value);
        this.queued += r.value.length;
      }
    }
  }

  get available(): number {
    return this.queued;
  }

  /** Remove and return up to n buffered bytes. */
  take(n: number): Uint8Array {
    const len = Math.min(n, this.queued);
    const out = new Uint8Array(len);
    let o = 0;
    while (o < len) {
      const head = this.queue[0];
      const need = len - o;
      if (head.length <= need) {
        out.set(head, o);
        o += head.length;
        this.queue.shift();
      } else {
        out.set(head.subarray(0, need), o);
        this.queue[0] = head.subarray(need);
        o += need;
      }
    }
    this.queued -= len;
    return out;
  }

  async close(): Promise<void> {
    await this.it.return?.();
  }
}

// --- sealing -----------------------------------------------------------------

/**
 * Encrypt a plaintext stream. Returns a lazy async iterable of file bytes:
 * preamble, header, then segments. Nothing is derived until the first pull.
 *
 * Account keys are copied at call time (and the copies wiped when the stream ends): the caller may wipe its own key
 * (sign-out, lock) before the first pull, and the slot must still be wrapped under the real key, never under zeros.
 */
export function sealStream(
  plain: ByteSource,
  slots: KeySlotInput[],
  opts: SealOptions = {}
): AsyncGenerator<Uint8Array> {
  const copies: Uint8Array[] = [];
  const own = Array.isArray(slots)
    ? slots.map((s) => {
      if (s && typeof s === 'object' && s.type === 'account' && s.accountKey instanceof Uint8Array) {
        const accountKey = Uint8Array.from(s.accountKey);
        copies.push(accountKey);
        return { ...s, accountKey };
      }
      return s;
    })
    : slots;
  return (async function* wiping(): AsyncGenerator<Uint8Array> {
    try {
      yield* sealStreamImpl(plain, own, opts);
    } finally {
      for (const c of copies) c.fill(0);
    }
  })();
}

async function* sealStreamImpl(
  plain: ByteSource,
  slots: KeySlotInput[],
  opts: SealOptions
): AsyncGenerator<Uint8Array> {
  const random = opts.random ?? defaultRandom;
  const kdf = opts.kdf ?? defaultKdf;
  const segmentSize = opts.segmentSize ?? DEFAULT_SEGMENT_SIZE;
  if (!Number.isInteger(segmentSize) || segmentSize < MIN_SEGMENT_SIZE || segmentSize > MAX_SEGMENT_SIZE) {
    throw new RangeError('segmentSize out of range');
  }
  if (slots.length < 1 || slots.length > MAX_SLOTS) throw new RangeError(`A backup needs between 1 and ${MAX_SLOTS} key slots`);
  let recoverable = false;
  for (const s of slots) {
    const t = (s as { type?: unknown }).type;
    if (s && t === 'password' && typeof (s as PasswordSlotInput).password === 'string' && (s as PasswordSlotInput).password.length > 0) {
      recoverable = true;
    } else if (s && t === 'account' && (s as AccountSlotInput).accountKey instanceof Uint8Array && (s as AccountSlotInput).accountKey.length === 32
      && (s as AccountSlotInput).accountKey.some((b) => b !== 0)) {
      // An all-zero key is a wiped key, never a real one: wrapping under it would let anyone open the file.
      // valid, but not enough on its own
    } else if (s && t === 'recovery' && typeof (s as RecoverySlotInput).code === 'string') {
      parseBackupRecoveryCode((s as RecoverySlotInput).code).fill(0); // RangeError for a malformed code
      recoverable = true;
    } else {
      throw new RangeError('Invalid key slot');
    }
  }
  if (!recoverable) throw new RangeError('A backup needs at least one password or recovery slot');

  // Random draws happen in this fixed order so a deterministic RandomSource yields reproducible golden files.
  const fileKey = random.bytes(32);
  const streamSalt = random.bytes(32);
  const noncePrefix = random.bytes(7);

  type SlotHeader = PasswordSlotHeader | AccountSlotHeader | RecoverySlotHeader;
  const slotHeaders: SlotHeader[] = [];
  /** Derives the slot's KEK and its AAD once the preamble hash is known. */
  const pending: Array<{ header: SlotHeader; nonce: Uint8Array; kek: (preambleHash: Uint8Array) => Promise<{ kek: Uint8Array; aad: Uint8Array }> }> = [];
  for (const s of slots) {
    if (s.type === 'password') {
      const kdfParams: KdfParams = {
        id: 'argon2id', v: 19,
        m: s.kdf?.m ?? DEFAULT_KDF.m, t: s.kdf?.t ?? DEFAULT_KDF.t, p: s.kdf?.p ?? DEFAULT_KDF.p,
        salt: random.bytes(16),
      };
      validateKdfParams(kdfParams);
      const nonce = random.bytes(12);
      const header: PasswordSlotHeader = { type: 'password', kdf: kdfParamsToJson(kdfParams), nonce: b64urlEncode(nonce), wrapped: '' };
      slotHeaders.push(header);
      const password = s.password;
      pending.push({ header, nonce, kek: async (h) => ({ kek: await kekFromSecret(await kdf(password, kdfParams)), aad: slotAad(h) }) });
    } else if (s.type === 'account') {
      const nonce = random.bytes(12);
      const header: AccountSlotHeader = { type: 'account', nonce: b64urlEncode(nonce), wrapped: '' };
      slotHeaders.push(header);
      const accountKey = s.accountKey;
      pending.push({ header, nonce, kek: async (h) => ({ kek: await accountKek(accountKey), aad: typedSlotAad(h, 'account') }) });
    } else {
      const salt = random.bytes(16);
      const nonce = random.bytes(12);
      const header: RecoverySlotHeader = { type: 'recovery', salt: b64urlEncode(salt), nonce: b64urlEncode(nonce), wrapped: '' };
      slotHeaders.push(header);
      const code = s.code;
      pending.push({
        header, nonce,
        kek: async (h) => {
          const bytes = parseBackupRecoveryCode(code);
          try {
            return { kek: await recoveryKek(bytes, salt), aad: typedSlotAad(h, 'recovery') };
          } finally {
            bytes.fill(0);
          }
        },
      });
    }
  }

  // The header (including each wrapped key) is fixed before any segment is written, but the
  // wrapped keys need the preamble hash, and the preamble carries the header length. The wrapped
  // value has a fixed length (48 bytes = 64 base64url chars), so the length is known up front.
  for (const p of pending) p.header.wrapped = 'A'.repeat(64);
  const keyCheck = await hkdfSha256(fileKey, streamSalt, LABEL_COMMIT, 32);
  const headerBase: EnvelopeHeader = {
    payload: PAYLOAD_ZIP,
    aead: AEAD_ID,
    segmentSize,
    streamSalt: b64urlEncode(streamSalt),
    noncePrefix: b64urlEncode(noncePrefix),
    keyCheck: b64urlEncode(keyCheck),
    slots: slotHeaders,
  };
  const headerLen = utf8Encode(JSON.stringify(headerBase)).length;
  if (headerLen > MAX_HEADER_LEN) throw new RangeError('Header too large');
  const preamble = buildPreamble(headerLen);
  const preambleHash = await sha256(preamble);

  for (const p of pending) {
    const { kek, aad: slotAadBytes } = await p.kek(preambleHash);
    const wrapped = await aesGcmSealKey(await importAesKey(kek), p.nonce, fileKey, slotAadBytes);
    p.header.wrapped = b64urlEncode(wrapped);
  }
  const headerBytes = utf8Encode(JSON.stringify(headerBase));
  if (headerBytes.length !== headerLen) throw new Error('internal: header length changed');

  const aad = await sha256(concatBytes(preamble, headerBytes));
  const streamKey = await importAesKey(await hkdfSha256(fileKey, streamSalt, LABEL_STREAM, 32));

  yield preamble;
  yield headerBytes;

  const reader = new ByteReader(plain);
  try {
    let index = 0;
    for (;;) {
      // Hold back one byte beyond a full segment to learn whether this one is the last.
      await reader.fill(segmentSize + 1);
      const last = reader.available <= segmentSize;
      const block = reader.take(segmentSize);
      if (index > 0xffffffff) throw new RangeError('Backup too large');
      yield await aesGcmSealKey(streamKey, segmentNonce(noncePrefix, index, last), block, aad);
      index++;
      if (last) break;
    }
  } finally {
    await reader.close();
  }
}

// --- opening -----------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fixedB64(v: unknown, len: number, what: string): Uint8Array {
  if (typeof v !== 'string') throw new DamagedError(`Malformed header: ${what}`);
  let b: Uint8Array;
  try {
    b = b64urlDecode(v);
  } catch {
    throw new DamagedError(`Malformed header: ${what}`);
  }
  if (b.length !== len) throw new DamagedError(`Malformed header: ${what}`);
  return b;
}

function exactKeys(o: Record<string, unknown>, keys: string[]): void {
  const have = Object.keys(o);
  if (have.length !== keys.length || !keys.every((k) => Object.prototype.hasOwnProperty.call(o, k))) {
    throw new DamagedError('Malformed header: slot');
  }
}

/** Parse and structurally validate a header. Throws `NewerFormatError` for unknown algorithms, `DamagedError` for malformed fields. */
export function parseHeader(bytes: Uint8Array): EnvelopeHeader {
  let json: unknown;
  try {
    json = parseStrictJson(utf8Decode(bytes));
  } catch {
    throw new DamagedError('Malformed header');
  }
  if (!isRecord(json)) throw new DamagedError('Malformed header');
  if (typeof json.aead !== 'string' || typeof json.payload !== 'string') throw new DamagedError('Malformed header');
  if (json.aead !== AEAD_ID) throw new NewerFormatError('This backup uses an encryption method this version does not support.');
  if (json.payload !== PAYLOAD_ZIP) throw new NewerFormatError('This backup has a payload type this version does not support.');
  const seg = json.segmentSize;
  if (typeof seg !== 'number' || !Number.isInteger(seg) || seg < MIN_SEGMENT_SIZE || seg > MAX_SEGMENT_SIZE) {
    throw new DamagedError('Malformed header: segmentSize');
  }
  fixedB64(json.streamSalt, 32, 'streamSalt');
  fixedB64(json.noncePrefix, 7, 'noncePrefix');
  fixedB64(json.keyCheck, 32, 'keyCheck');
  if (!Array.isArray(json.slots) || json.slots.length < 1 || json.slots.length > MAX_SLOTS) {
    throw new DamagedError('Malformed header: slots');
  }
  for (const s of json.slots) {
    if (!isRecord(s) || typeof s.type !== 'string') throw new DamagedError('Malformed header: slot');
  }
  return json as EnvelopeHeader;
}

interface SlotCandidate {
  nonce: Uint8Array;
  wrapped: Uint8Array;
  aad: Uint8Array;
  /** Derive the slot's KEK (the only expensive step: Argon2id for a password slot). */
  kek: () => Promise<Uint8Array>;
}

/**
 * Find the file key: try the slots that match the unlock method (at most `MAX_SLOT_ATTEMPTS`), and accept a
 * slot only when the key it unwraps matches the header's `keyCheck`. A slot that fails authentication, or
 * unwraps some other key, simply does not open (it cannot be told apart from a wrong secret).
 */
async function unwrapFileKey(
  header: EnvelopeHeader, unlock: UnlockInput, preambleHash: Uint8Array, streamSalt: Uint8Array, keyCheck: Uint8Array, kdf: KdfFunction,
): Promise<Uint8Array> {
  const u = unlock as { password?: unknown; accountKey?: unknown; recoveryCode?: unknown };
  const method: 'password' | 'account' | 'recovery' =
    typeof u.password === 'string' ? 'password' : u.accountKey instanceof Uint8Array ? 'account' : typeof u.recoveryCode === 'string' ? 'recovery' : (() => { throw new RangeError('Invalid unlock input'); })();

  const wrongMessage = method === 'password' ? 'Wrong password' : method === 'account' ? 'Wrong account key' : 'Wrong recovery code';
  const candidates: SlotCandidate[] = [];
  let recoveryBytes: Uint8Array | null = null;
  try {
    for (const slotHeader of header.slots) {
      const s = slotHeader as Record<string, unknown>;
      if (s.type !== method) continue;
      if (candidates.length >= MAX_SLOT_ATTEMPTS) break;
      if (method === 'password') {
        const kdfJson = s.kdf as Record<string, unknown> | undefined;
        if (!isRecord(kdfJson)) throw new DamagedError('Malformed header: kdf');
        // A KDF this reader does not know is a slot it cannot use (like an unknown slot type), not damage.
        if (kdfJson.id !== 'argon2id' || kdfJson.v !== 19) continue;
        let kdfParams: KdfParams;
        try {
          kdfParams = kdfParamsFromJson(kdfJson);
          validateKdfParams(kdfParams);
        } catch (e) {
          if (e instanceof KdfParamsError) throw new DamagedError(`Invalid key-derivation parameters: ${e.message}`);
          throw e;
        }
        const password = (unlock as { password: string }).password;
        candidates.push({
          nonce: fixedB64(s.nonce, 12, 'slot nonce'),
          wrapped: fixedB64(s.wrapped, 32 + AES_TAG_LEN, 'wrapped key'),
          aad: slotAad(preambleHash),
          kek: async () => kekFromSecret(await kdf(password, kdfParams)),
        });
      } else if (method === 'account') {
        // Shapes are strict, but only for the slots actually being used: an account or recovery slot that is malformed
        // is damage when unlocking with it, and is ignored when unlocking another way (an unknown slot would be too).
        exactKeys(s, ['type', 'nonce', 'wrapped']);
        const accountKey = (unlock as { accountKey: Uint8Array }).accountKey;
        if (accountKey.length !== 32) throw new RangeError('The account key must be 32 bytes');
        candidates.push({
          nonce: fixedB64(s.nonce, 12, 'slot nonce'),
          wrapped: fixedB64(s.wrapped, 32 + AES_TAG_LEN, 'wrapped key'),
          aad: typedSlotAad(preambleHash, 'account'),
          kek: () => accountKek(accountKey),
        });
      } else {
        if (!recoveryBytes) {
          try {
            recoveryBytes = parseBackupRecoveryCode((unlock as { recoveryCode: string }).recoveryCode);
          } catch {
            throw new WrongPasswordError('Wrong recovery code');
          }
        }
        exactKeys(s, ['type', 'salt', 'nonce', 'wrapped']);
        const code = recoveryBytes;
        const salt = fixedB64(s.salt, 16, 'slot salt');
        candidates.push({
          nonce: fixedB64(s.nonce, 12, 'slot nonce'),
          wrapped: fixedB64(s.wrapped, 32 + AES_TAG_LEN, 'wrapped key'),
          aad: typedSlotAad(preambleHash, 'recovery'),
          kek: () => recoveryKek(code, salt),
        });
      }
    }
    if (candidates.length === 0) {
      // Password: none usable and no other way in is known either = a newer format. Otherwise this is simply the wrong
      // way to open this file (an account or recovery unlock on a file without such a slot), which the caller handles
      // like a wrong secret.
      if (method === 'password' && !header.slots.some((s) => s.type === 'account' || s.type === 'recovery')) {
        throw new NewerFormatError('This backup cannot be opened with a password by this version of the app.');
      }
      throw new WrongPasswordError(wrongMessage);
    }
    for (const c of candidates) {
      const kek = await c.kek();
      try {
        const candidate = await aesGcmOpenKey(await importAesKey(kek), c.nonce, c.wrapped, c.aad);
        // A slot must unwrap the very key the header commits to; another key would let one file hold two different plaintexts.
        if (bytesEqual(await hkdfSha256(candidate, streamSalt, LABEL_COMMIT, 32), keyCheck)) return candidate;
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
      }
    }
    throw new WrongPasswordError(wrongMessage);
  } finally {
    recoveryBytes?.fill(0);
  }
}

export interface OpenedEnvelope {
  header: EnvelopeHeader;
  /** Format version of the file. */
  version: { major: number; minor: number };
  /** Decrypted plaintext, released segment by segment only after each tag verifies. */
  plain: AsyncGenerator<Uint8Array>;
}

/**
 * Read the preamble and header, unlock a key slot with the password, and return
 * a lazy plaintext stream. Errors: `NotABackupError`, `NewerFormatError`,
 * `WrongPasswordError`, `DamagedError` (also while iterating `plain`; invalid KDF parameters are reported as damage).
 * No KDF work is done before the header has been fully validated, including the KDF bounds.
 */
export async function openStream(
  file: ByteSource,
  unlock: UnlockInput,
  opts: OpenOptions = {}
): Promise<OpenedEnvelope> {
  const kdf = opts.kdf ?? defaultKdf;
  const reader = new ByteReader(file);
  try {
    await reader.fill(PREAMBLE_LEN);
    if (reader.available < PREAMBLE_LEN) {
      // Fewer than 16 bytes: a truncated backup if the magic is all there, otherwise not a backup.
      const head = reader.take(PREAMBLE_LEN);
      if (head.length >= MAGIC.length && bytesEqual(head.subarray(0, MAGIC.length), MAGIC)) {
        throw new DamagedError('The backup file is truncated');
      }
      throw new NotABackupError('Not a backup file');
    }
    const preamble = reader.take(PREAMBLE_LEN);
    if (!bytesEqual(preamble.subarray(0, 8), MAGIC)) throw new NotABackupError('Not a backup file');
    const dv = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
    const major = dv.getUint16(8, false);
    const minor = dv.getUint16(10, false);
    const headerLen = dv.getUint32(12, false);
    if (major > FORMAT_MAJOR) throw new NewerFormatError('This backup was made by a newer version of the app.');
    if (major < FORMAT_MAJOR) throw new NotABackupError('Not a backup file');
    if (headerLen < 2 || headerLen > MAX_HEADER_LEN) throw new DamagedError('Malformed header length');

    await reader.fill(headerLen);
    if (reader.available < headerLen) throw new DamagedError('The backup file is truncated');
    const headerBytes = reader.take(headerLen);
    const header = parseHeader(headerBytes);

    // Choose usable slots and validate their parameters before any expensive work.
    const preambleHash = await sha256(preamble);
    const streamSaltBytes = fixedB64(header.streamSalt, 32, 'streamSalt');
    const keyCheck = fixedB64(header.keyCheck, 32, 'keyCheck');
    const fileKey = await unwrapFileKey(header, unlock, preambleHash, streamSaltBytes, keyCheck, kdf);

    const aad = await sha256(concatBytes(preamble, headerBytes));
    const streamKey = await importAesKey(
      await hkdfSha256(fileKey, streamSaltBytes, LABEL_STREAM, 32)
    );
    const noncePrefix = fixedB64(header.noncePrefix, 7, 'noncePrefix');
    const segLen = header.segmentSize + AES_TAG_LEN;

    let index = 0;
    /** Read, verify and decrypt the next segment. */
    const nextSegment = async (): Promise<{ pt: Uint8Array; last: boolean }> => {
      await reader.fill(segLen + 1);
      const last = reader.available <= segLen;
      const seg = reader.take(segLen);
      if (seg.length < AES_TAG_LEN) throw new DamagedError('The backup file is truncated');
      if (index > 0xffffffff) throw new DamagedError('Backup too large');
      try {
        const pt = await aesGcmOpenKey(streamKey, segmentNonce(noncePrefix, index, last), seg, aad);
        index++;
        return { pt, last };
      } catch (e) {
        if (e instanceof AuthError) throw new DamagedError('The backup file is damaged or incomplete');
        throw e;
      }
    };

    // Verify the first segment before returning, so a tampered header or a spliced
    // file fails here, at unlock time, rather than part-way through a restore.
    const first = await nextSegment();

    async function* plain(): AsyncGenerator<Uint8Array> {
      try {
        let cur = first;
        for (;;) {
          if (cur.pt.length > 0) yield cur.pt;
          if (cur.last) return;
          cur = await nextSegment();
        }
      } finally {
        await reader.close();
      }
    }

    return { header, version: { major, minor }, plain: plain() };
  } catch (e) {
    await reader.close();
    throw e;
  }
}

