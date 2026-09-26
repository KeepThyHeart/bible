/**
 * Known-answer tests for the Crypto primitives. Vectors are committed and must
 * never be regenerated: they are what a future version has to keep reproducing.
 */
import { describe, it, expect } from 'vitest';
import nodeCrypto from 'crypto';
import fc from 'fast-check';
import {
  b64urlEncode, b64urlDecode, hexDecode, hexEncode, hkdfSha256, aesGcmSeal, aesGcmOpen, AuthError,
  validateKdfParams, argon2id, KdfParamsError, deterministicRandom, defaultRandom, utf8Encode, sha256,
} from '../../Crypto';
import type { KdfParams } from '../../Crypto';
import { argon2idUnchecked } from '../../Crypto/kdf';

const seq = (n: number, start = 0) => Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);

describe('base64url', () => {
  it('matches RFC 4648 vectors without padding', () => {
    const cases: Array<[string, string]> = [['', ''], ['f', 'Zg'], ['fo', 'Zm8'], ['foo', 'Zm9v'], ['foob', 'Zm9vYg'], ['fooba', 'Zm9vYmE'], ['foobar', 'Zm9vYmFy']];
    for (const [plain, enc] of cases) {
      expect(b64urlEncode(utf8Encode(plain))).toBe(enc);
      expect(new TextDecoder().decode(b64urlDecode(enc))).toBe(plain);
    }
    expect(b64urlEncode(Uint8Array.from([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });
  it('rejects padding, alphabet violations, bad length and non-canonical tails', () => {
    for (const bad of ['Zg==', 'Zm9v+', 'Zm9v/', 'Z', 'Zh', 'Zm 9v', 'Zm9é']) {
      expect(() => b64urlDecode(bad), bad).toThrow(RangeError);
    }
  });
  it('round-trips arbitrary bytes', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 200 }), (b) => {
      expect(b64urlDecode(b64urlEncode(b))).toEqual(b);
    }));
  });
});

describe('HKDF-SHA-256 (RFC 5869)', () => {
  it('A.1 basic', async () => {
    const okm = await hkdfSha256(new Uint8Array(22).fill(0x0b), seq(13), seq(10, 0xf0), 42);
    expect(hexEncode(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });
  it('A.3 empty salt and info', async () => {
    const okm = await hkdfSha256(new Uint8Array(22).fill(0x0b), new Uint8Array(0), new Uint8Array(0), 42);
    expect(hexEncode(okm)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
  });
  it('A.2 long inputs (cross-checked against node:crypto)', async () => {
    const ikm = seq(80), salt = seq(80, 0x60), info = seq(80, 0xb0);
    const okm = await hkdfSha256(ikm, salt, info, 82);
    expect(hexEncode(okm)).toBe('b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87');
    expect(hexEncode(new Uint8Array(nodeCrypto.hkdfSync('sha256', ikm, salt, info, 82)))).toBe(hexEncode(okm));
  });
  it('accepts a string label', async () => {
    const a = await hkdfSha256(seq(32), new Uint8Array(0), 'kth-backup-kek-v1', 32);
    const b = await hkdfSha256(seq(32), new Uint8Array(0), utf8Encode('kth-backup-kek-v1'), 32);
    expect(a).toEqual(b);
  });
});

describe('AES-256-GCM', () => {
  it('NIST GCM spec test case 14 (zero key, zero IV, one zero block)', async () => {
    const ct = await aesGcmSeal(new Uint8Array(32), new Uint8Array(12), new Uint8Array(16));
    expect(hexEncode(ct)).toBe('cea7403d4d606b6e074ec5d3baf39d18' + 'd0d1c8a799996bf0265b98b5d48ab919');
  });
  const key = seq(32), nonce = seq(12, 100), aad = utf8Encode('header');
  const vectors: Array<[string, string]> = [
    ['', '427a3913c8222d0f0ebd95c660f0ce8c'],
    ['a', '297018c3e61080dd57158b3c0e454ba39f'],
    ['hello backup world', '207eb20a16c934ff5d092a98fa12058f2ea64d960fde33fce75986840e4a80e4320c'],
  ];
  it.each(vectors)('seal/open %j with AAD', async (pt, hex) => {
    const sealed = await aesGcmSeal(key, nonce, utf8Encode(pt), aad);
    expect(hexEncode(sealed)).toBe(hex);
    expect(await aesGcmOpen(key, nonce, hexDecode(hex), aad)).toEqual(utf8Encode(pt));
  });
  it('fails closed on every single-bit flip, wrong key, wrong nonce and wrong AAD', async () => {
    const sealed = hexDecode(vectors[2][1]);
    for (let i = 0; i < sealed.length; i++) {
      const bad = sealed.slice();
      bad[i] ^= 1;
      await expect(aesGcmOpen(key, nonce, bad, aad)).rejects.toBeInstanceOf(AuthError);
    }
    await expect(aesGcmOpen(seq(32, 1), nonce, sealed, aad)).rejects.toBeInstanceOf(AuthError);
    await expect(aesGcmOpen(key, seq(12, 101), sealed, aad)).rejects.toBeInstanceOf(AuthError);
    await expect(aesGcmOpen(key, nonce, sealed, utf8Encode('other'))).rejects.toBeInstanceOf(AuthError);
    await expect(aesGcmOpen(key, nonce, sealed.slice(0, 10), aad)).rejects.toBeInstanceOf(AuthError);
  });
  it('validates key and nonce sizes', async () => {
    await expect(aesGcmSeal(new Uint8Array(16), nonce, new Uint8Array(1))).rejects.toThrow(RangeError);
    await expect(aesGcmSeal(key, new Uint8Array(8), new Uint8Array(1))).rejects.toThrow(RangeError);
  });
});

describe('Argon2id', () => {
  it('reference vector from phc-winner-argon2 (m=64 MiB, t=2, p=1, "password"/"somesalt")', async () => {
    const out = await argon2idUnchecked('password', utf8Encode('somesalt'), 65536, 2, 1, 32);
    expect(hexEncode(out)).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
  });
  // Generated with OpenSSL's Argon2id (node:crypto.argon2Sync), an implementation independent of hash-wasm.
  const salt = seq(16);
  it('default parameters 64 MiB / 3 / 1', async () => {
    const p: KdfParams = { id: 'argon2id', v: 19, m: 65536, t: 3, p: 1, salt };
    expect(hexEncode(await argon2id('correct horse battery staple', p))).toBe('0d1a3c6523c8f06e4e0af9c515aa5b5448cfebd6838f2d52c3d8b6ef8ddc3c2e');
  });
  it('floor parameters 19 MiB / 2 / 1', async () => {
    const p: KdfParams = { id: 'argon2id', v: 19, m: 19456, t: 2, p: 1, salt };
    expect(hexEncode(await argon2id('correct horse battery staple', p))).toBe('818259b6310026a8e0dbac5d2e6927abcfdb07b32258fac4f61b18b80f929085');
  });
  it('NFC-normalises the password so composed and decomposed forms agree', async () => {
    const p: KdfParams = { id: 'argon2id', v: 19, m: 19456, t: 2, p: 1, salt };
    expect(await argon2id('café au lait', p)).toEqual(await argon2id('café au lait', p));
  });
});

describe('validateKdfParams', () => {
  const ok: KdfParams = { id: 'argon2id', v: 19, m: 65536, t: 3, p: 1, salt: seq(16) };
  it('accepts the defaults and the floor', () => {
    expect(() => validateKdfParams(ok)).not.toThrow();
    expect(() => validateKdfParams({ ...ok, m: 19456, t: 2 })).not.toThrow();
  });
  it.each([
    ['memory below floor', { m: 19455 }],
    ['memory above ceiling', { m: 1024 * 1024 + 1 }],
    ['iterations below floor', { t: 1 }],
    ['iterations above ceiling', { t: 11 }],
    ['parallelism 0', { p: 0 }],
    ['parallelism above ceiling', { p: 5 }],
    ['non-integer', { m: 65536.5 }],
    ['unknown id', { id: 'scrypt' as never }],
    ['unknown version', { v: 16 as never }],
    ['short salt', { salt: seq(8) }],
    ['huge salt', { salt: seq(65) }],
  ])('rejects %s', (_n, patch) => {
    expect(() => validateKdfParams({ ...ok, ...patch })).toThrow(KdfParamsError);
  });
  it('argon2id() validates before doing any work', async () => {
    await expect(argon2id('x', { ...ok, m: 1024 * 1024 * 8 })).rejects.toBeInstanceOf(KdfParamsError);
  });
});

describe('random sources', () => {
  it('default returns fresh bytes of the requested size, including sizes above 64 KiB', () => {
    expect(defaultRandom.bytes(100000).length).toBe(100000);
    expect(defaultRandom.bytes(16)).not.toEqual(defaultRandom.bytes(16));
  });
  it('deterministic source is reproducible and sequential', () => {
    const a = deterministicRandom(1), b = deterministicRandom(1);
    expect(a.bytes(5)).toEqual(b.bytes(5));
    expect(hexEncode(deterministicRandom(0).bytes(4))).toBe('0d141b22');
    expect(a.bytes(3)).toEqual(deterministicRandom(1).bytes(8).slice(5));
  });
  it('sha256 matches the FIPS "abc" vector', async () => {
    expect(hexEncode(await sha256(utf8Encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
