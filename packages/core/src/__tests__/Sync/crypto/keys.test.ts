/** Key hierarchy (contracts 0063 §2): derivation, wraps, unlock paths, rotation, recovery codes, ids, leak scans. */
import nodeCrypto from 'crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AuthError, KdfParamsError, b64urlDecode, defaultRandom, hexEncode, hkdfSha256, kdfParamsFromJson, utf8Encode,
} from '../../../Crypto';
import type { KdfParams } from '../../../Crypto';
import { crockfordDecode, crockfordEncode } from '../../../Sync/crypto/base32';
import { hmacSha256 } from '../../../Sync/crypto/hmac';
import {
  createAccountMaterial, deriveRecordId, derivePasswordKeys, generateRecoveryCode, newRecoveryWrap, openDeviceName,
  parseRecoveryCode, recoveryAuthKeyFor, rewrapForNewPassword, rotateAccountKey, sealDeviceName, unlockWithPassword,
  unlockWithRecoveryCode,
} from '../../../Sync/crypto/keys';
import type { AccountKeyMaterial, UnlockedAccount } from '../../../Sync/crypto/keys';
import { createRecordCipher } from '../../../Sync/crypto/RecordCipher';
import { FLOOR, PASSWORD, containsBytes, recordingKdf } from './fixtures';

const params = (over: Partial<KdfParams> = {}): KdfParams => ({
  id: 'argon2id', v: 19, ...FLOOR, salt: new Uint8Array(16).fill(7), ...over,
});

async function kekFor(m: AccountKeyMaterial, password: string): Promise<Uint8Array> {
  return (await derivePasswordKeys(password, kdfParamsFromJson(m.kdf))).kek;
}

const unlockPw = async (accountId: string, m: AccountKeyMaterial, password: string) =>
  unlockWithPassword(accountId, await kekFor(m, password), m.wrappedAkPassword, m.wrappedRecordIdKey, m.keysets, m.currentEpoch);

let acct: Awaited<ReturnType<typeof createAccountMaterial>>;
let rec: ReturnType<typeof recordingKdf>;

beforeAll(async () => {
  rec = recordingKdf();
  acct = await createAccountMaterial({ password: PASSWORD, kdfCost: FLOOR, kdf: rec.kdf });
}, 60000);

describe('derivePasswordKeys', () => {
  it.each([
    ['memory below floor', { m: 19455 }],
    ['iterations below floor', { t: 1 }],
    ['short salt', { salt: new Uint8Array(15) }],
    ['memory above ceiling', { m: 1024 * 1024 + 1 }],
    ['wrong algorithm', { id: 'argon2i' as 'argon2id' }],
  ])('refuses %s with KdfParamsError before the KDF runs', async (_n, over) => {
    const kdf = vi.fn(async () => new Uint8Array(32));
    await expect(derivePasswordKeys('pw', params(over as Partial<KdfParams>), kdf)).rejects.toBeInstanceOf(KdfParamsError);
    expect(kdf).not.toHaveBeenCalled();
  });

  it('NFC-normalises, then splits the master key with HKDF (empty salt, auth / kek labels)', async () => {
    const r = recordingKdf();
    const pk = await derivePasswordKeys(PASSWORD, params(), r.kdf);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].password).toBe(PASSWORD.normalize('NFC'));
    const master = r.calls[0].master;
    expect(pk.authKey).toEqual(await hkdfSha256(master, new Uint8Array(0), 'kth-auth-v1', 32));
    expect(pk.kek).toEqual(await hkdfSha256(master, new Uint8Array(0), 'kth-kek-v1', 32));
    expect(hexEncode(pk.authKey)).not.toBe(hexEncode(pk.kek));
    const composed = await derivePasswordKeys(PASSWORD.normalize('NFC'), params());
    expect(composed.kek).toEqual(pk.kek);
  });
});

describe('createAccountMaterial / unlock', () => {
  it('produces well-formed material', () => {
    const m = acct.material;
    expect(acct.accountId).toMatch(/^[0-9a-f]{32}$/);
    expect(m.kdf).toMatchObject({ id: 'argon2id', v: 19, ...FLOOR });
    expect(b64urlDecode(m.kdf.salt)).toHaveLength(16);
    expect(b64urlDecode(m.authKey)).toHaveLength(32);
    expect(b64urlDecode(m.recoveryAuthKey)).toHaveLength(32);
    for (const w of [m.wrappedAkPassword, m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets[0].wrappedDataKey]) {
      expect(b64urlDecode(w)).toHaveLength(60);
    }
    expect(m.keysets.map((k) => k.epoch)).toEqual([0]);
    expect(m.currentEpoch).toBe(0);
    expect(acct.unlocked.dataKeys.get(0)).toHaveLength(32);
  });

  it('defaults to DEFAULT_KDF cost when none is given', async () => {
    const kdf = vi.fn(async () => new Uint8Array(32).fill(1));
    const r = await createAccountMaterial({ password: 'x', kdf });
    expect(r.material.kdf).toMatchObject({ m: 65536, t: 3, p: 1 });
  });

  it('round-trips through the password and the recovery code', async () => {
    const m = acct.material;
    const viaPw = await unlockPw(acct.accountId, m, PASSWORD);
    const sloppy = acct.recoveryCode.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const viaRc = await unlockWithRecoveryCode(acct.accountId, sloppy, m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0);
    for (const u of [viaPw, viaRc]) {
      expect(u.accountId).toBe(acct.accountId);
      expect(u.accountKey).toEqual(acct.unlocked.accountKey);
      expect(u.recordIdKey).toEqual(acct.unlocked.recordIdKey);
      expect(u.dataKeys).toEqual(acct.unlocked.dataKeys);
      expect(u.currentEpoch).toBe(0);
    }
    expect(await recoveryAuthKeyFor(sloppy)).toBe(m.recoveryAuthKey);
  });

  it('wrong password, wrong code, wrong account or swapped slots fail with AuthError', async () => {
    const m = acct.material;
    await expect(unlockPw(acct.accountId, m, 'wrong password')).rejects.toBeInstanceOf(AuthError);
    const other = generateRecoveryCode();
    await expect(unlockWithRecoveryCode(acct.accountId, other, m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0))
      .rejects.toBeInstanceOf(AuthError);
    const otherAcct = hexEncode(defaultRandom.bytes(16));
    await expect(unlockPw(otherAcct, m, PASSWORD)).rejects.toBeInstanceOf(AuthError);
    const kek = await kekFor(m, PASSWORD);
    // the recovery wrap presented as the password wrap (AAD slot differs)
    await expect(unlockWithPassword(acct.accountId, kek, m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0))
      .rejects.toBeInstanceOf(AuthError);
    // a data key wrap presented as the record-id key wrap
    await expect(unlockWithPassword(acct.accountId, kek, m.wrappedAkPassword, m.keysets[0].wrappedDataKey, m.keysets, 0))
      .rejects.toBeInstanceOf(AuthError);
    // a keyset relabelled with another epoch
    await expect(unlockWithPassword(acct.accountId, kek, m.wrappedAkPassword, m.wrappedRecordIdKey,
      [{ epoch: 1, wrappedDataKey: m.keysets[0].wrappedDataKey }], 1)).rejects.toBeInstanceOf(AuthError);
    // current epoch missing, duplicate epochs, malformed wire
    await expect(unlockWithPassword(acct.accountId, kek, m.wrappedAkPassword, m.wrappedRecordIdKey, m.keysets, 3))
      .rejects.toBeInstanceOf(AuthError);
    await expect(unlockWithPassword(acct.accountId, kek, m.wrappedAkPassword, m.wrappedRecordIdKey,
      [m.keysets[0], m.keysets[0]], 0)).rejects.toBeInstanceOf(AuthError);
    await expect(unlockWithPassword(acct.accountId, kek, 'not*base64', m.wrappedRecordIdKey, m.keysets, 0))
      .rejects.toBeInstanceOf(AuthError);
    await expect(unlockWithPassword(acct.accountId, kek, m.wrappedAkPassword.slice(0, 40), m.wrappedRecordIdKey, m.keysets, 0))
      .rejects.toBeInstanceOf(AuthError);
  });

  it('every bit flip in a wrapped key is detected', async () => {
    const m = acct.material;
    const kek = await kekFor(m, PASSWORD);
    const raw = b64urlDecode(m.wrappedAkPassword);
    for (const i of [0, 11, 12, 43, 44, 59]) {
      const t = raw.slice();
      t[i] ^= 1;
      await expect(unlockWithPassword(acct.accountId, kek, Buffer.from(t).toString('base64url'),
        m.wrappedRecordIdKey, m.keysets, 0)).rejects.toBeInstanceOf(AuthError);
    }
  });

  it('error messages never contain the password, code or key material', async () => {
    const m = acct.material;
    const errs: string[] = [];
    for (const run of [
      () => unlockPw(acct.accountId, m, 'hunter2-secret'),
      () => unlockWithRecoveryCode(acct.accountId, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZ', m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0),
      () => unlockWithRecoveryCode(acct.accountId, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZU', m.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0),
    ]) {
      errs.push(String(await run().catch((e: Error) => `${e.name}: ${e.message}`)));
    }
    expect(errs[0]).toMatch(/^AuthError/);
    expect(errs[1]).toMatch(/^RangeError/);
    for (const e of errs) {
      expect(e).not.toMatch(/hunter2|ZZZZ|ZZZU/);
      expect(e).not.toContain(m.wrappedAkPassword);
    }
  });
});

describe('leak scan: nothing secret reaches the wire', () => {
  it('AccountKeyMaterial carries no password, master, KEK, account/record-id/data key or raw recovery bytes', async () => {
    const m = acct.material;
    const kek = await kekFor(m, PASSWORD);
    const master = rec.calls[0].master;
    const rawRecovery = parseRecoveryCode(acct.recoveryCode);
    const recoveryWrapKey = await hkdfSha256(rawRecovery, new Uint8Array(0), 'kth-recovery-wrap-v1', 32);
    const secrets: Record<string, Uint8Array> = {
      passwordUtf8: utf8Encode(PASSWORD), passwordNfc: utf8Encode(PASSWORD.normalize('NFC')), master, kek,
      accountKey: acct.unlocked.accountKey, recordIdKey: acct.unlocked.recordIdKey, dataKey0: acct.unlocked.dataKeys.get(0)!,
      rawRecovery, recoveryWrapKey,
    };
    const json = JSON.stringify(m);
    const blobs: Uint8Array[] = [utf8Encode(json)];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        try { blobs.push(b64urlDecode(v)); } catch { /* not b64url */ }
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(m);
    for (const [name, s] of Object.entries(secrets)) {
      for (const b of blobs) expect(containsBytes(b, s), name).toBe(false);
      expect(json.includes(hexEncode(s)), `${name} hex`).toBe(false);
      expect(json.includes(Buffer.from(s).toString('base64url')), `${name} b64url`).toBe(false);
    }
    expect(json).not.toContain(acct.recoveryCode);
    expect(json).not.toContain(acct.recoveryCode.replace(/-/g, ''));
    // the auth keys that do go on the wire are independent of the KEK / recovery wrap key
    expect(m.authKey).not.toBe(Buffer.from(kek).toString('base64url'));
  });

  it('password-change and new-recovery outputs carry no secrets either', async () => {
    const r = recordingKdf();
    const pw = await rewrapForNewPassword(acct.unlocked, 'n3w-password-xyz', { kdfCost: FLOOR, kdf: r.kdf });
    const nr = await newRecoveryWrap(acct.unlocked);
    const json = utf8Encode(JSON.stringify([pw, nr]));
    for (const s of [utf8Encode('n3w-password-xyz'), r.calls[0].master, acct.unlocked.accountKey, parseRecoveryCode(nr.recoveryCode)]) {
      expect(containsBytes(json, s)).toBe(false);
      for (const w of [pw.wrappedAkPassword, nr.wrappedAkRecovery, pw.authKey, nr.recoveryAuthKey]) {
        expect(containsBytes(b64urlDecode(w), s)).toBe(false);
      }
    }
  });
});

describe('rewrapForNewPassword / newRecoveryWrap', () => {
  it('re-wraps the same account key under a new salt', async () => {
    const pw = await rewrapForNewPassword(acct.unlocked, 'second password', { kdfCost: FLOOR });
    expect(pw.kdf.salt).not.toBe(acct.material.kdf.salt);
    expect(pw.authKey).not.toBe(acct.material.authKey);
    const m2: AccountKeyMaterial = { ...acct.material, ...pw };
    const u = await unlockPw(acct.accountId, m2, 'second password');
    expect(u.accountKey).toEqual(acct.unlocked.accountKey);
    await expect(unlockPw(acct.accountId, m2, PASSWORD)).rejects.toBeInstanceOf(AuthError);
  });

  it('a new recovery code unlocks; the old one does not open the new wrap', async () => {
    const nr = await newRecoveryWrap(acct.unlocked);
    expect(nr.recoveryCode).not.toBe(acct.recoveryCode);
    const m = acct.material;
    const u = await unlockWithRecoveryCode(acct.accountId, nr.recoveryCode, nr.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0);
    expect(u.accountKey).toEqual(acct.unlocked.accountKey);
    expect(await recoveryAuthKeyFor(nr.recoveryCode)).toBe(nr.recoveryAuthKey);
    await expect(unlockWithRecoveryCode(acct.accountId, acct.recoveryCode, nr.wrappedAkRecovery, m.wrappedRecordIdKey, m.keysets, 0))
      .rejects.toBeInstanceOf(AuthError);
  });
});

describe('rotateAccountKey', () => {
  it('new account key, all epochs re-wrapped plus one, record-id key kept, old records still open', async () => {
    const cipher0 = createRecordCipher(acct.unlocked);
    const rid = hexEncode(defaultRandom.bytes(16));
    const pt = { t: 'user_note', cv: 1, h: '0192f3a1b2c3:0000:9f3c0a1b2c3d4e5f', dev: '9f3c0a1b2c3d4e5f', d: { x: 1 } };
    const blob0 = await cipher0.seal(rid, pt);

    const r1 = await rotateAccountKey(acct.unlocked, PASSWORD, undefined, { kdfCost: FLOOR });
    const r2 = await rotateAccountKey(r1.unlocked, PASSWORD, undefined, { kdfCost: FLOOR });
    expect(r1.unlocked.currentEpoch).toBe(1);
    expect(r2.unlocked.currentEpoch).toBe(2);
    expect(r2.material.currentEpoch).toBe(2);
    expect(r2.material.keysets.map((k) => k.epoch)).toEqual([0, 1, 2]);
    expect(r2.unlocked.recordIdKey).toEqual(acct.unlocked.recordIdKey);
    expect(r2.unlocked.dataKeys.get(0)).toEqual(acct.unlocked.dataKeys.get(0));
    expect(r2.unlocked.dataKeys.get(1)).toEqual(r1.unlocked.dataKeys.get(1));
    expect(hexEncode(r1.unlocked.accountKey)).not.toBe(hexEncode(acct.unlocked.accountKey));
    expect(hexEncode(r2.unlocked.accountKey)).not.toBe(hexEncode(r1.unlocked.accountKey));
    expect(r2.recoveryCode).not.toBe(r1.recoveryCode);
    // the input is not mutated
    expect(acct.unlocked.currentEpoch).toBe(0);
    expect([...acct.unlocked.dataKeys.keys()]).toEqual([0]);

    const u = await unlockPw(acct.accountId, r2.material, PASSWORD);
    expect(u.accountKey).toEqual(r2.unlocked.accountKey);
    expect(u.dataKeys).toEqual(r2.unlocked.dataKeys);
    const viaRc = await unlockWithRecoveryCode(acct.accountId, r2.recoveryCode, r2.material.wrappedAkRecovery,
      r2.material.wrappedRecordIdKey, r2.material.keysets, 2);
    expect(viaRc.accountKey).toEqual(r2.unlocked.accountKey);
    // old account key cannot open the new keysets: the old wraps are useless after rotation
    await expect(unlockWithPassword(acct.accountId, await kekFor(acct.material, PASSWORD), acct.material.wrappedAkPassword,
      r2.material.wrappedRecordIdKey, r2.material.keysets, 2)).rejects.toBeInstanceOf(AuthError);

    const cipher2 = createRecordCipher(u);
    expect(await cipher2.open(rid, blob0)).toEqual(pt);
    const blob2 = await cipher2.seal(rid, pt);
    expect(new DataView(blob2.buffer).getUint32(1)).toBe(2);
    await expect(createRecordCipher(acct.unlocked).open(rid, blob2)).rejects.toThrow('unknown key epoch');
  }, 60000);
});

describe('recovery codes', () => {
  const ALPHA = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;

  it('generates 8 groups of 4 Crockford chars carrying 160 bits', () => {
    const c = generateRecoveryCode();
    expect(c).toMatch(ALPHA);
    expect(parseRecoveryCode(c)).toHaveLength(20);
    expect(generateRecoveryCode()).not.toBe(c);
  });

  it('accepts dashes, spaces, lowercase and the O / I / L aliases', () => {
    const bytes = defaultRandom.bytes(20);
    const canonical = crockfordEncode(bytes);
    const grouped = canonical.match(/.{4}/g)!.join('-');
    const variants = [
      canonical, grouped, grouped.toLowerCase(), canonical.match(/.{4}/g)!.join(' '),
      ` ${grouped.replace(/-/g, ' - ')}\t`,
      canonical.replace(/0/g, 'O').replace(/1/g, 'I'), canonical.replace(/0/g, 'o').replace(/1/g, 'l'),
    ];
    for (const v of variants) expect(parseRecoveryCode(v)).toEqual(bytes);
    expect(parseRecoveryCode('0000-0000-0000-0000-0000-0000-0000-0000')).toEqual(new Uint8Array(20));
    expect(parseRecoveryCode('oooo-iiii-llll-OOOO-IIII-LLLL-0000-1111')).toEqual(parseRecoveryCode('0000-1111-1111-0000-1111-1111-0000-1111'));
    expect(parseRecoveryCode('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toEqual(new Uint8Array(20).fill(255));
  });

  it('rejects anything but exactly 160 bits, and bad characters (RangeError)', () => {
    const c = crockfordEncode(defaultRandom.bytes(20));
    // 31 chars = 155 bits (159 is not representable: one char short), 33 chars = 165 bits (161: one char long)
    for (const bad of [c.slice(0, 31), `${c}0`, c.slice(0, 24), `${c}00000000`, '', '----']) {
      expect(() => parseRecoveryCode(bad), `len ${bad.length}`).toThrow(RangeError);
    }
    for (const ch of ['U', 'u', '*', '=', 'é', '٠']) {
      expect(() => parseRecoveryCode(c.slice(0, 31) + ch)).toThrow(RangeError);
    }
    try {
      parseRecoveryCode('SECRET-SECRET-SECRET');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SECRET');
    }
  });

  it('crockford round-trips random byte strings and matches a known value', () => {
    for (let n = 0; n <= 40; n += 5) {
      const b = defaultRandom.bytes(n);
      expect(crockfordDecode(crockfordEncode(b))).toEqual(b);
    }
    // "hello" = 0x68656c6c6f -> Crockford (no padding) D1JPRV3F
    expect(crockfordEncode(utf8Encode('hello'))).toBe('D1JPRV3F');
    expect(() => crockfordEncode(new Uint8Array(4))).toThrow(RangeError);
  });
});

describe('deriveRecordId / hmacSha256', () => {
  it('hmacSha256 matches RFC 4231 test case 2 and node:crypto', async () => {
    expect(hexEncode(await hmacSha256(utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?'))))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    const k = defaultRandom.bytes(32);
    const d = defaultRandom.bytes(100);
    expect(Buffer.from(await hmacSha256(k, d))).toEqual(nodeCrypto.createHmac('sha256', k).update(d).digest());
    await expect(hmacSha256(new Uint8Array(0), d)).rejects.toThrow(RangeError);
  });

  it('is the first 16 bytes of HMAC(recordIdKey, label 0 scope 0 key), as lowercase hex', async () => {
    const k = acct.unlocked.recordIdKey;
    const id = await deriveRecordId(k, 'ext.kv', 'com.example/theme');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const expected = nodeCrypto.createHmac('sha256', k).update(Buffer.from('kth-recid-v1\0ext.kv\0com.example/theme')).digest();
    expect(id).toBe(expected.subarray(0, 16).toString('hex'));
    expect(await deriveRecordId(k, 'ext.kv', 'com.example/theme')).toBe(id);
  });

  it('separates scope, key and record-id key; refuses NUL in scope', async () => {
    const k = acct.unlocked.recordIdKey;
    const ids = new Set([
      await deriveRecordId(k, 'a', 'bc'), await deriveRecordId(k, 'ab', 'c'), await deriveRecordId(k, 'abc', ''),
      await deriveRecordId(k, '', 'abc'), await deriveRecordId(defaultRandom.bytes(32), 'a', 'bc'),
    ]);
    expect(ids.size).toBe(5);
    await expect(deriveRecordId(k, 'a\0b', 'c')).rejects.toThrow(RangeError);
    await expect(deriveRecordId(new Uint8Array(16), 'a', 'b')).rejects.toThrow(RangeError);
  });
});

describe('device names', () => {
  it('round-trips and is bound to account and device', async () => {
    const u = acct.unlocked;
    const s = await sealDeviceName(u, '0011223344556677', 'Peter’s phone');
    expect(s).not.toContain('Peter');
    expect(await openDeviceName(u, '0011223344556677', s)).toBe('Peter’s phone');
    await expect(openDeviceName(u, '0011223344556678', s)).rejects.toBeInstanceOf(AuthError);
    const other: UnlockedAccount = { ...u, accountId: hexEncode(defaultRandom.bytes(16)) };
    await expect(openDeviceName(other, '0011223344556677', s)).rejects.toBeInstanceOf(AuthError);
    await expect(openDeviceName(u, '0011223344556677', 'garbage!')).rejects.toBeInstanceOf(AuthError);
    await expect(sealDeviceName(u, 'XYZ', 'x')).rejects.toThrow(RangeError);
  });
});
