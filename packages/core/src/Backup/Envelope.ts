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
 * password slot wraps it under `HKDF(Argon2id(password))`. Other slot types can
 * be added later without changing the format; readers ignore slot types they do
 * not know.
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

export interface PasswordSlotHeader {
  type: 'password';
  kdf: KdfParamsJson;
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
  slots: Array<PasswordSlotHeader | UnknownSlotHeader>;
  [k: string]: unknown;
}

/** Derives the 32-byte master secret from a password. Desktop injects one that runs in a worker thread. */
export type KdfFunction = (password: string, params: KdfParams) => Promise<Uint8Array>;

export interface KeySlotInput {
  type: 'password';
  password: string;
  /** Override the default cost (still bounded by the floor and ceiling). */
  kdf?: Partial<Pick<KdfParams, 'm' | 't' | 'p'>>;
}

export interface SealOptions {
  segmentSize?: number;
  random?: RandomSource;
  kdf?: KdfFunction;
}

export interface OpenOptions {
  kdf?: KdfFunction;
}

export interface UnlockInput {
  password: string;
}

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
 */
export async function* sealStream(
  plain: ByteSource,
  slots: KeySlotInput[],
  opts: SealOptions = {}
): AsyncGenerator<Uint8Array> {
  const random = opts.random ?? defaultRandom;
  const kdf = opts.kdf ?? defaultKdf;
  const segmentSize = opts.segmentSize ?? DEFAULT_SEGMENT_SIZE;
  if (!Number.isInteger(segmentSize) || segmentSize < MIN_SEGMENT_SIZE || segmentSize > MAX_SEGMENT_SIZE) {
    throw new RangeError('segmentSize out of range');
  }
  if (slots.length < 1 || slots.length > MAX_SLOTS) throw new RangeError(`A backup needs between 1 and ${MAX_SLOTS} key slots`);
  for (const s of slots) {
    if (s.type !== 'password' || typeof s.password !== 'string' || s.password.length === 0) {
      throw new RangeError('Invalid key slot');
    }
  }

  // Random draws happen in this fixed order so a deterministic RandomSource yields reproducible golden files.
  const fileKey = random.bytes(32);
  const streamSalt = random.bytes(32);
  const noncePrefix = random.bytes(7);

  const slotHeaders: PasswordSlotHeader[] = [];
  const pending: Array<{ header: PasswordSlotHeader; kdfParams: KdfParams; password: string; nonce: Uint8Array }> = [];
  for (const s of slots) {
    const kdfParams: KdfParams = {
      id: 'argon2id', v: 19,
      m: s.kdf?.m ?? DEFAULT_KDF.m, t: s.kdf?.t ?? DEFAULT_KDF.t, p: s.kdf?.p ?? DEFAULT_KDF.p,
      salt: random.bytes(16),
    };
    validateKdfParams(kdfParams);
    const nonce = random.bytes(12);
    const header: PasswordSlotHeader = { type: 'password', kdf: kdfParamsToJson(kdfParams), nonce: b64urlEncode(nonce), wrapped: '' };
    slotHeaders.push(header);
    pending.push({ header, kdfParams, password: s.password, nonce });
  }

  // The header (including each wrapped key) is fixed before any segment is written, but the
  // wrapped keys need the preamble hash, and the preamble carries the header length. The wrapped
  // value has a fixed length (48 bytes = 64 base64url chars), so the length is known up front.
  for (const p of pending) p.header.wrapped = 'A'.repeat(64);
  const headerBase: EnvelopeHeader = {
    payload: PAYLOAD_ZIP,
    aead: AEAD_ID,
    segmentSize,
    streamSalt: b64urlEncode(streamSalt),
    noncePrefix: b64urlEncode(noncePrefix),
    slots: slotHeaders,
  };
  const headerLen = utf8Encode(JSON.stringify(headerBase)).length;
  if (headerLen > MAX_HEADER_LEN) throw new RangeError('Header too large');
  const preamble = buildPreamble(headerLen);
  const preambleHash = await sha256(preamble);

  for (const p of pending) {
    const kek = await kekFromSecret(await kdf(p.password, p.kdfParams));
    const wrapped = await aesGcmSealKey(await importAesKey(kek), p.nonce, fileKey, slotAad(preambleHash));
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
  if (!Array.isArray(json.slots) || json.slots.length < 1 || json.slots.length > MAX_SLOTS) {
    throw new DamagedError('Malformed header: slots');
  }
  for (const s of json.slots) {
    if (!isRecord(s) || typeof s.type !== 'string') throw new DamagedError('Malformed header: slot');
  }
  return json as EnvelopeHeader;
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
 * `WrongPasswordError`, `DamagedError` (also while iterating `plain`), `KdfParamsError`.
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

    // Choose usable slots and validate their KDF bounds before any expensive work.
    const preambleHash = await sha256(preamble);
    const candidates: Array<{ kdfParams: KdfParams; nonce: Uint8Array; wrapped: Uint8Array }> = [];
    for (const s of header.slots) {
      if (s.type !== 'password') continue;
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
      candidates.push({
        kdfParams,
        nonce: fixedB64(s.nonce, 12, 'slot nonce'),
        wrapped: fixedB64(s.wrapped, 32 + AES_TAG_LEN, 'wrapped key'),
      });
    }
    if (candidates.length === 0) {
      throw new NewerFormatError('This backup cannot be opened with a password by this version of the app.');
    }

    let fileKey: Uint8Array | null = null;
    for (const c of candidates) {
      const kek = await kekFromSecret(await kdf(unlock.password, c.kdfParams));
      try {
        fileKey = await aesGcmOpenKey(await importAesKey(kek), c.nonce, c.wrapped, slotAad(preambleHash));
        break;
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
      }
    }
    if (!fileKey) throw new WrongPasswordError('Wrong password');

    const aad = await sha256(concatBytes(preamble, headerBytes));
    const streamKey = await importAesKey(
      await hkdfSha256(fileKey, fixedB64(header.streamSalt, 32, 'streamSalt'), LABEL_STREAM, 32)
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

