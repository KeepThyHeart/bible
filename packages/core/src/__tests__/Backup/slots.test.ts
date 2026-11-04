import { describe, it, expect, vi } from 'vitest';
import nodeCrypto from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sealStream, openStream, parseHeader } from '../../Backup/Envelope';
import type { KeySlotInput, UnlockInput } from '../../Backup/Envelope';
import { DamagedError, WrongPasswordError } from '../../Backup/errors';
import { collect, once } from '../../Backup/Streams';
import { deterministicRandom, utf8Decode } from '../../Crypto';
import type { KdfParams } from '../../Crypto';
import { LABELS } from '../../Sync/crypto/labels';
import { generateRecoveryCode, parseRecoveryCode } from '../../Sync/crypto/keys';
import { b64u, pattern, MAGIC, passwordSlot } from './envelopeSpec';

const PASSWORD = 'correct horse battery';
const FLOOR = { m: 19456, t: 2, p: 1 };
const fastKdf = async (pw: string, _p: KdfParams) => new Uint8Array(nodeCrypto.createHash('sha256').update(pw.normalize('NFC')).digest());
const ACCOUNT_KEY = new Uint8Array(32).map((_, i) => i + 1);
const OTHER_KEY = new Uint8Array(32).map((_, i) => 200 - i);
const CODE = generateRecoveryCode(deterministicRandom(5));
const GOLDEN = join(__dirname, 'fixtures', 'password-account-recovery.bbk');
const GOLDEN_SLOTS: KeySlotInput[] = [
  { type: 'password', password: PASSWORD, kdf: FLOOR },
  { type: 'account', accountKey: ACCOUNT_KEY },
  { type: 'recovery', code: CODE },
];

async function seal(slots: KeySlotInput[], plain = pattern(100), seed = 1): Promise<Uint8Array> {
  return collect(sealStream(once(plain), slots, { segmentSize: 4096, random: deterministicRandom(seed), kdf: fastKdf }));
}
async function open(file: Uint8Array, unlock: UnlockInput) {
  const r = await openStream(once(file), unlock, { kdf: fastKdf });
  return collect(r.plain);
}
const ALL: KeySlotInput[] = [
  { type: 'password', password: PASSWORD, kdf: FLOOR },
  { type: 'account', accountKey: ACCOUNT_KEY },
  { type: 'recovery', code: CODE },
];
function headerOf(file: Uint8Array): any {
  const len = new DataView(file.buffer, file.byteOffset).getUint32(12, false);
  return JSON.parse(utf8Decode(file.subarray(16, 16 + len)));
}

describe('account and recovery key slots', () => {
  it('a file with all three slot types opens with each of them', async () => {
    const file = await seal(ALL);
    expect(await open(file, { password: PASSWORD })).toEqual(pattern(100));
    expect(await open(file, { accountKey: ACCOUNT_KEY })).toEqual(pattern(100));
    expect(await open(file, { recoveryCode: CODE })).toEqual(pattern(100));
  });

  it('the account slot opens with the account key alone: no password, no key derivation', async () => {
    const file = await seal(ALL);
    const kdf = vi.fn(fastKdf);
    const r = await openStream(once(file), { accountKey: ACCOUNT_KEY }, { kdf });
    expect(await collect(r.plain)).toEqual(pattern(100));
    expect(kdf).not.toHaveBeenCalled();
  });

  it('the recovery code is accepted with dashes, spaces, lower case and Crockford aliases', async () => {
    const file = await seal(ALL);
    const plain = CODE.replace(/-/g, '');
    const variants = [plain, plain.toLowerCase(), CODE.toLowerCase(), plain.replace(/(.{4})/g, '$1 ').trim(), plain.replace(/0/g, 'O').replace(/1/g, 'l')];
    for (const v of variants) expect(await open(file, { recoveryCode: v })).toEqual(pattern(100));
  });

  it('the header names no account: the slots hold only the documented fields', async () => {
    const h = headerOf(await seal(ALL));
    expect(h.slots.map((s: any) => Object.keys(s))).toEqual([
      ['type', 'kdf', 'nonce', 'wrapped'], ['type', 'nonce', 'wrapped'], ['type', 'salt', 'nonce', 'wrapped'],
    ]);
    expect(JSON.stringify(h)).not.toMatch(/account[A-Za-z]*"\s*:/);
  });

  it('wrong account key, wrong code, a malformed code and the wrong kind of unlock all read as a wrong secret', async () => {
    const file = await seal(ALL);
    await expect(open(file, { accountKey: OTHER_KEY })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(open(file, { recoveryCode: generateRecoveryCode(deterministicRandom(99)) })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(open(file, { recoveryCode: 'not a code' })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(open(file, { password: 'nope' })).rejects.toBeInstanceOf(WrongPasswordError);
    const passwordOnly = await seal([ALL[0]]);
    await expect(open(passwordOnly, { accountKey: ACCOUNT_KEY })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(open(passwordOnly, { recoveryCode: CODE })).rejects.toBeInstanceOf(WrongPasswordError);
    const recoveryOnly = await seal([ALL[2]]);
    await expect(open(recoveryOnly, { password: PASSWORD })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await open(recoveryOnly, { recoveryCode: CODE })).toEqual(pattern(100));
  });

  it('error messages never contain the secret', async () => {
    const file = await seal(ALL);
    const bad = generateRecoveryCode(deterministicRandom(77));
    for (const u of [{ recoveryCode: bad }, { password: 'hunter2-secret' }] as UnlockInput[]) {
      const e = (await open(file, u).catch((x) => x)) as Error;
      expect(String(e.message)).not.toContain('hunter2');
      expect(String(e.message)).not.toContain(bad);
    }
  });

  it('the writer needs a password or recovery slot, and checks each slot', async () => {
    await expect(seal([{ type: 'account', accountKey: ACCOUNT_KEY }])).rejects.toThrow(RangeError);
    await expect(seal([{ type: 'account', accountKey: new Uint8Array(31) }, ALL[0]])).rejects.toThrow(RangeError);
    await expect(seal([{ type: 'recovery', code: 'ABCD' }])).rejects.toThrow(RangeError);
    await expect(seal([{ type: 'password', password: '' }])).rejects.toThrow(RangeError);
    await expect(seal([{ type: 'token' } as unknown as KeySlotInput, ALL[0]])).rejects.toThrow(RangeError);
    // account + recovery is enough (no password at all)
    const file = await seal([{ type: 'account', accountKey: ACCOUNT_KEY }, ALL[2]]);
    expect(await open(file, { accountKey: ACCOUNT_KEY })).toEqual(pattern(100));
  });

  it('the account key is copied when the stream is created: wiping it before the first pull does not weaken the slot', async () => {
    const key = Uint8Array.from(ACCOUNT_KEY);
    const stream = sealStream(once(pattern(100)), [{ type: 'account', accountKey: key }, ALL[0]],
      { segmentSize: 4096, random: deterministicRandom(1), kdf: fastKdf });
    key.fill(0); // e.g. sign-out wipes the unlocked keys while the backup is queued
    const file = await collect(stream);
    expect(await open(file, { accountKey: ACCOUNT_KEY })).toEqual(pattern(100));
    await expect(open(file, { accountKey: new Uint8Array(32) })).rejects.toThrow(WrongPasswordError);
  });

  it('an all-zero (wiped) account key is refused by the writer', async () => {
    await expect(seal([{ type: 'account', accountKey: new Uint8Array(32) }, ALL[0]])).rejects.toThrow(RangeError);
  });

  it('is deterministic for a deterministic random source (password-only output is unchanged by the new slot types)', async () => {
    expect(await seal(ALL, pattern(10), 3)).toEqual(await seal(ALL, pattern(10), 3));
  });
});

describe('golden file with all three slot types (must open forever)', () => {
  const make = () => collect(sealStream(once(pattern(5000)), GOLDEN_SLOTS, { segmentSize: 4096, random: deterministicRandom(11) }));
  if (process.env.UPDATE_GOLDEN === '1' && !existsSync(GOLDEN)) {
    it('writes the golden file (by hand, once; commit it as a NEW file)', async () => {
      writeFileSync(GOLDEN, await make());
    });
  }
  it('opens with the password, the account key and the recovery code', async () => {
    const file = new Uint8Array(readFileSync(GOLDEN));
    for (const u of [{ password: PASSWORD }, { accountKey: ACCOUNT_KEY }, { recoveryCode: CODE }] as UnlockInput[]) {
      const r = await openStream(once(file), u);
      expect(await collect(r.plain)).toEqual(pattern(5000));
    }
  });
  it('sealing with the same random source reproduces it byte for byte', async () => {
    expect(await make()).toEqual(new Uint8Array(readFileSync(GOLDEN)));
  });
});

// --- an independent builder (node:crypto only), also the proof that the labels match Sync's -------------------------

const hkdf = (ikm: Buffer, salt: Buffer, info: string) => Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), 32));
const sha = (...p: Buffer[]) => nodeCrypto.createHash('sha256').update(Buffer.concat(p)).digest();
function gcm(key: Buffer, nonce: Buffer, pt: Buffer, aad: Buffer): Buffer {
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(aad);
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}
interface SlotMaker { (preamble: Buffer, fileKey: Buffer): any }
const typedAad = (preamble: Buffer, type: string) => Buffer.concat([Buffer.from('kth-backup-slot-v1'), sha(preamble), Buffer.from([0]), Buffer.from(type)]);
const accountSlot = (key: Buffer, opts: { aadType?: string; fileKey?: Buffer; nonce?: Buffer } = {}): SlotMaker => (pre, fk) => ({
  type: 'account', nonce: b64u(opts.nonce ?? Buffer.alloc(12, 1)),
  wrapped: b64u(gcm(hkdf(key, Buffer.alloc(0), LABELS.backupAccountSlot), opts.nonce ?? Buffer.alloc(12, 1), opts.fileKey ?? fk, typedAad(pre, opts.aadType ?? 'account'))),
});
const recoverySlot = (code: string): SlotMaker => (pre, fk) => {
  const salt = Buffer.alloc(16, 4);
  const nonce = Buffer.alloc(12, 2);
  return { type: 'recovery', salt: b64u(salt), nonce: b64u(nonce), wrapped: b64u(gcm(hkdf(Buffer.from(parseRecoveryCode(code)), salt, LABELS.backupRecoverySlot), nonce, fk, typedAad(pre, 'recovery'))) };
};
const pwSlot = (pw: string): SlotMaker => (pre, fk) => passwordSlot({
  password: pw, m: 19456, t: 2, p: 1, salt: Buffer.alloc(16, 3), nonce: Buffer.alloc(12, 5), fileKey: fk, preamble: pre,
  fastKdf: (p) => nodeCrypto.createHash('sha256').update(p.normalize('NFC')).digest(),
});

function buildFile(slots: SlotMaker[], plaintext: Uint8Array, mutate?: (slots: any[]) => void): Buffer {
  const fileKey = Buffer.alloc(32, 7), streamSalt = Buffer.alloc(32, 9), noncePrefix = Buffer.from([1, 2, 3, 4, 5, 6, 7]);
  const head = (sl: any[]) => ({
    payload: 'zip', aead: 'aes-256-gcm-stream', segmentSize: 4096, streamSalt: b64u(streamSalt), noncePrefix: b64u(noncePrefix),
    keyCheck: b64u(hkdf(fileKey, streamSalt, 'kth-backup-commit-v1')), slots: sl,
  });
  // The header length is in the preamble, which the slots' AAD covers: build once to learn the length, then again.
  let preamble = Buffer.alloc(16);
  MAGIC.copy(preamble, 0);
  preamble.writeUInt16BE(1, 8);
  const make = () => {
    const sl = slots.map((m) => m(preamble, fileKey));
    mutate?.(sl);
    return Buffer.from(JSON.stringify(head(sl)));
  };
  let bytes = make();
  preamble.writeUInt32BE(bytes.length, 12);
  bytes = make();
  if (bytes.length !== preamble.readUInt32BE(12)) throw new Error('header length unstable');
  const sk = hkdf(fileKey, streamSalt, 'kth-backup-stream-v1');
  const nonce = Buffer.alloc(12);
  noncePrefix.copy(nonce, 0);
  nonce[11] = 1;
  return Buffer.concat([preamble, bytes, gcm(sk, nonce, Buffer.from(plaintext), sha(preamble, bytes))]);
}

describe('independently built files (node:crypto, Sync labels)', () => {
  it('the labels in Backup equal the ones in Sync: Sync-labelled account and recovery slots open', async () => {
    expect(LABELS.backupAccountSlot).toBe('kth-backup-wrap-v1');
    expect(LABELS.backupRecoverySlot).toBe('kth-backup-recovery-v1');
    const file = new Uint8Array(buildFile([pwSlot(PASSWORD), accountSlot(Buffer.from(ACCOUNT_KEY)), recoverySlot(CODE)], pattern(50)));
    expect(await open(file, { accountKey: ACCOUNT_KEY })).toEqual(pattern(50));
    expect(await open(file, { recoveryCode: CODE })).toEqual(pattern(50));
    expect(await open(file, { password: PASSWORD })).toEqual(pattern(50));
  });

  it('recovery code parsing equals Sync parseRecoveryCode for assorted spellings', async () => {
    const file = new Uint8Array(buildFile([recoverySlot(CODE)], pattern(5)));
    const raw = CODE.replace(/-/g, '');
    for (const v of [CODE, raw.toLowerCase(), ` ${raw.slice(0, 16)}  ${raw.slice(16)} `, raw.replace(/0/g, 'o').replace(/1/g, 'I')]) {
      expect(parseRecoveryCode(v)).toEqual(parseRecoveryCode(CODE));
      expect(await open(file, { recoveryCode: v })).toEqual(pattern(5));
    }
  });

  it('a slot that unwraps a different key than keyCheck commits to does not open (mixed-up slot)', async () => {
    const other = Buffer.alloc(32, 99);
    const file = new Uint8Array(buildFile([pwSlot(PASSWORD), accountSlot(Buffer.from(ACCOUNT_KEY), { fileKey: other })], pattern(20)));
    await expect(open(file, { accountKey: ACCOUNT_KEY })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await open(file, { password: PASSWORD })).toEqual(pattern(20));
  });

  it('the slot type is bound into the AAD: an account slot sealed as a recovery slot does not open', async () => {
    const file = new Uint8Array(buildFile([pwSlot(PASSWORD), accountSlot(Buffer.from(ACCOUNT_KEY), { aadType: 'recovery' })], pattern(20)));
    await expect(open(file, { accountKey: ACCOUNT_KEY })).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('a malformed account slot is damage when unlocking with it, and ignored when unlocking another way', async () => {
    for (const mutate of [
      (s: any[]) => { s[1].extra = 1; },
      (s: any[]) => { s[1].nonce = b64u(Buffer.alloc(11)); },
      (s: any[]) => { s[1].wrapped = b64u(Buffer.alloc(47)); },
      (s: any[]) => { delete s[1].nonce; },
    ]) {
      const file = new Uint8Array(buildFile([pwSlot(PASSWORD), accountSlot(Buffer.from(ACCOUNT_KEY))], pattern(20), mutate));
      await expect(open(file, { accountKey: ACCOUNT_KEY })).rejects.toBeInstanceOf(DamagedError);
    }
    const bad = new Uint8Array(buildFile([pwSlot(PASSWORD), recoverySlot(CODE)], pattern(20), (s) => { s[1].salt = b64u(Buffer.alloc(15)); }));
    await expect(open(bad, { recoveryCode: CODE })).rejects.toBeInstanceOf(DamagedError);
    expect(await open(bad, { password: PASSWORD })).toEqual(pattern(20));
  });

  it('tries at most 4 account slots', async () => {
    const wrong = Array.from({ length: 4 }, (_, i) => accountSlot(Buffer.alloc(32, 50 + i), { nonce: Buffer.alloc(12, 10 + i) }));
    const right = accountSlot(Buffer.from(ACCOUNT_KEY), { nonce: Buffer.alloc(12, 40) });
    const five = new Uint8Array(buildFile([pwSlot(PASSWORD), ...wrong, right], pattern(9)));
    await expect(open(five, { accountKey: ACCOUNT_KEY })).rejects.toBeInstanceOf(WrongPasswordError);
    const four = new Uint8Array(buildFile([pwSlot(PASSWORD), ...wrong.slice(0, 3), right], pattern(9)));
    expect(await open(four, { accountKey: ACCOUNT_KEY })).toEqual(pattern(9));
  });

  it('parseHeader still accepts files whose account slots a reader would skip', async () => {
    const file = buildFile([pwSlot(PASSWORD), accountSlot(Buffer.from(ACCOUNT_KEY))], pattern(5));
    const len = file.readUInt32BE(12);
    expect(parseHeader(new Uint8Array(file.subarray(16, 16 + len))).slots).toHaveLength(2);
  });
});
