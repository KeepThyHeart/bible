/** Record envelope (contracts 0063 §3): round trips, AAD binding, epochs, padding buckets, size limit. */
import { describe, expect, it } from 'vitest';
import {
  AuthError, aesGcmSeal, concatBytes, defaultRandom, hexDecode, hexEncode, utf8Encode,
} from '../../../Crypto';
import {
  MAX_RECORD_JSON, RECORD_BLOB_VERSION, RecordTooLargeError, UnknownEpochError, createRecordCipher, paddedLength,
  recordAad,
} from '../../../Sync/crypto/RecordCipher';
import type { UnlockedAccount } from '../../../Sync/crypto/keys';
import type { RecordPlaintext } from '../../../Sync/types';

const rnd = (n: number) => defaultRandom.bytes(n);
const hexId = () => hexEncode(rnd(16));
const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

function account(over: Partial<UnlockedAccount> = {}): UnlockedAccount {
  return {
    accountId: hexId(), accountKey: rnd(32), recordIdKey: rnd(32), dataKeys: new Map([[0, rnd(32)]]), currentEpoch: 0,
    ...over,
  };
}

const PT: RecordPlaintext = {
  t: 'user_note', cv: 1, h: '0192f3a1b2c3:0000:9f3c0a1b2c3d4e5f', dev: '9f3c0a1b2c3d4e5f', d: { body: 'In the beginning' },
};

/** A plaintext whose JSON encoding is exactly `n` bytes. */
function ptOfJsonLength(n: number): RecordPlaintext {
  const base = utf8Encode(JSON.stringify({ ...PT, d: { s: '' } })).length;
  if (n < base) throw new Error('too small');
  const p = { ...PT, d: { s: 'x'.repeat(n - base) } };
  expect(utf8Encode(JSON.stringify(p)).length).toBe(n);
  return p;
}

const OVERHEAD = 1 + 4 + 12 + 16;

describe('RecordCipher', () => {
  it('round-trips and uses a fresh nonce per seal', async () => {
    const u = account();
    const c = createRecordCipher(u);
    const id = hexId();
    const a = await c.seal(id, PT);
    const b = await c.seal(id, PT);
    expect(a[0]).toBe(RECORD_BLOB_VERSION);
    expect(hexEncode(a.subarray(5, 17))).not.toBe(hexEncode(b.subarray(5, 17)));
    expect(await c.open(id, a)).toEqual(PT);
    expect(await createRecordCipher(u).open(id, b)).toEqual(PT);
    expect(c.sealsThisEpoch).toBe(2);
    expect(Buffer.from(a).includes(Buffer.from('beginning'))).toBe(false);
  });

  it('binds the account id', async () => {
    const u = account();
    const id = hexId();
    const blob = await createRecordCipher(u).seal(id, PT);
    const other = { ...u, accountId: hexId() };
    await expect(createRecordCipher(other).open(id, blob)).rejects.toBeInstanceOf(AuthError);
  });

  it('binds the record id (a blob swapped onto another record fails)', async () => {
    const u = account();
    const c = createRecordCipher(u);
    const blob = await c.seal(hexId(), PT);
    await expect(c.open(hexId(), blob)).rejects.toBeInstanceOf(AuthError);
  });

  it('binds the epoch (header epoch rewritten to another known epoch with the same key)', async () => {
    const k = rnd(32);
    const u = account({ dataKeys: new Map([[0, k], [1, k]]), currentEpoch: 0 });
    const c = createRecordCipher(u);
    const id = hexId();
    const blob = await c.seal(id, PT);
    const t = blob.slice();
    t.set(u32(1), 1);
    await expect(c.open(id, t)).rejects.toBeInstanceOf(AuthError);
  });

  it('binds the version byte: a header version other than 1 is unreadable, and AAD carries the version', async () => {
    const u = account();
    const c = createRecordCipher(u);
    const id = hexId();
    const blob = await c.seal(id, PT);
    for (const v of [0, 2, 255]) {
      const t = blob.slice();
      t[0] = v;
      await expect(c.open(id, t)).rejects.toBeInstanceOf(UnknownEpochError);
    }
    // A blob whose AAD was built for version 2 but whose header claims version 1 fails authentication.
    const padded = new Uint8Array(1024);
    const json = utf8Encode(JSON.stringify(PT));
    padded.set(u32(json.length), 0);
    padded.set(json, 4);
    const nonce = rnd(12);
    const acct = hexDecode(u.accountId);
    const rid = hexDecode(id);
    const forged = concatBytes(Uint8Array.of(1), u32(0), nonce,
      await aesGcmSeal(u.dataKeys.get(0)!, nonce, padded, recordAad(2, acct, rid, 0)));
    await expect(c.open(id, forged)).rejects.toBeInstanceOf(AuthError);
    const honest = concatBytes(Uint8Array.of(1), u32(0), nonce,
      await aesGcmSeal(u.dataKeys.get(0)!, nonce, padded, recordAad(1, acct, rid, 0)));
    expect(await c.open(id, honest)).toEqual(PT);
  });

  it('detects ciphertext / tag / nonce tampering and truncation', async () => {
    const c = createRecordCipher(account());
    const id = hexId();
    const blob = await c.seal(id, PT);
    for (const i of [5, 16, 17, 500, blob.length - 1]) {
      const t = blob.slice();
      t[i] ^= 0x80;
      await expect(c.open(id, t)).rejects.toBeInstanceOf(AuthError);
    }
    for (const len of [1, 5, 17, OVERHEAD - 1, blob.length - 1]) {
      await expect(c.open(id, blob.slice(0, len))).rejects.toBeInstanceOf(AuthError);
    }
    await expect(c.open(id, new Uint8Array(0))).rejects.toBeInstanceOf(AuthError);
  });

  it('unknown epochs are UnknownEpochError (opaque, not damage)', async () => {
    const k = rnd(32);
    const newer = account({ dataKeys: new Map([[0, rnd(32)], [5, k]]), currentEpoch: 5 });
    const older = { ...newer, dataKeys: new Map([[0, newer.dataKeys.get(0)!]]), currentEpoch: 0 };
    const id = hexId();
    const blob = await createRecordCipher(newer).seal(id, PT);
    await expect(createRecordCipher(older).open(id, blob)).rejects.toBeInstanceOf(UnknownEpochError);
    const broken = { ...newer, currentEpoch: 9 };
    await expect(createRecordCipher(broken).seal(id, PT)).rejects.toBeInstanceOf(UnknownEpochError);
  });

  it('uses the current epoch for new seals, opens every known epoch, and resets the seal count on change', async () => {
    const u = account({ dataKeys: new Map([[0, rnd(32)]]), currentEpoch: 0 });
    const c = createRecordCipher(u);
    const id = hexId();
    const b0 = await c.seal(id, PT);
    await c.seal(id, PT);
    expect(c.sealsThisEpoch).toBe(2);
    u.dataKeys.set(1, rnd(32));
    u.currentEpoch = 1;
    expect(c.sealsThisEpoch).toBe(0);
    const b1 = await c.seal(id, PT);
    expect(c.sealsThisEpoch).toBe(1);
    expect(new DataView(b1.buffer).getUint32(1)).toBe(1);
    expect(await c.open(id, b0)).toEqual(PT);
    expect(await c.open(id, b1)).toEqual(PT);
  });

  it('pads to 1024-byte buckets up to 64 KiB of JSON, then 16384-byte buckets', async () => {
    expect(paddedLength(0)).toBe(1024);
    expect(paddedLength(1020)).toBe(1024);
    expect(paddedLength(1021)).toBe(2048);
    expect(paddedLength(65532)).toBe(65536);
    expect(paddedLength(65533)).toBe(66560);
    expect(paddedLength(65536)).toBe(66560);
    expect(paddedLength(65537)).toBe(81920);
    expect(paddedLength(MAX_RECORD_JSON)).toBe(1024 * 1024);

    const c = createRecordCipher(account());
    const id = hexId();
    for (const [n, padded] of [[1020, 1024], [1021, 2048], [65532, 65536], [65536, 66560], [65537, 81920]] as const) {
      const p = ptOfJsonLength(n);
      const blob = await c.seal(id, p);
      expect(blob.length, `json ${n}`).toBe(OVERHEAD + padded);
      expect(await c.open(id, blob)).toEqual(p);
    }
  });

  it('accepts MAX_RECORD_JSON and refuses one byte more with RecordTooLargeError', async () => {
    const c = createRecordCipher(account());
    const id = hexId();
    const max = await c.seal(id, ptOfJsonLength(MAX_RECORD_JSON));
    expect(max.length).toBe(OVERHEAD + 1024 * 1024);
    const err = await c.seal(id, ptOfJsonLength(MAX_RECORD_JSON + 1)).catch((e) => e);
    expect(err).toBeInstanceOf(RecordTooLargeError);
    expect(String(err.message)).not.toContain('xxxx');
  });

  it('authenticated but malformed content is a SyntaxError that does not quote the plaintext', async () => {
    const u = account();
    const c = createRecordCipher(u);
    const id = hexId();
    const acct = hexDecode(u.accountId);
    const rid = hexDecode(id);
    const seal = async (padded: Uint8Array) => {
      const nonce = rnd(12);
      return concatBytes(Uint8Array.of(1), u32(0), nonce,
        await aesGcmSeal(u.dataKeys.get(0)!, nonce, padded, recordAad(1, acct, rid, 0)));
    };
    const body = (s: Uint8Array, padTo = 1024, lenOverride?: number) => {
      const p = new Uint8Array(padTo);
      p.set(u32(lenOverride ?? s.length), 0);
      p.set(s, 4);
      return p;
    };
    const cases = [
      body(utf8Encode('{"t":"secret-plaintext-xyz"')),           // bad JSON
      body(utf8Encode('["secret-plaintext-xyz"]')),              // not an object
      body(utf8Encode('{"t":"secret-plaintext-xyz","cv":1}')),   // wrong shape
      body(Uint8Array.of(0xff, 0xfe, 0x73)),                     // bad UTF-8
      body(utf8Encode('{}'), 1024, 5000),                        // length beyond buffer
      body(utf8Encode('{}'), 2048),                              // non-canonical bucket
      (() => { const p = body(utf8Encode(JSON.stringify(PT))); p[1000] = 1; return p; })(), // non-zero padding
    ];
    for (const padded of cases) {
      const err = await c.open(id, await seal(padded)).catch((e) => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(String(err.message)).not.toContain('secret');
    }
  });

  it('rejects malformed record ids', async () => {
    const c = createRecordCipher(account());
    await expect(c.seal('ABC', PT)).rejects.toThrow(RangeError);
    await expect(c.seal('00112233445566778899AABBCCDDEEFF', PT)).rejects.toThrow(RangeError);
  });
});
