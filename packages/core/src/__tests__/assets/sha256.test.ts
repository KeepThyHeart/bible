import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256, isSha256Hex, sha256Hex } from '../../assets/sha256';

const enc = (s: string) => new TextEncoder().encode(s);
const ref = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('Sha256', () => {
  it('matches the standard vectors', () => {
    expect(sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes a million a in 997-byte chunks', () => {
    const all = new Uint8Array(1_000_000).fill(0x61);
    const h = new Sha256();
    for (let i = 0; i < all.length; i += 997) h.update(all.subarray(i, Math.min(i + 997, all.length)));
    expect(h.digestHex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('one-shot, byte-by-byte and every split agree with node:crypto for lengths 0..130', () => {
    for (let len = 0; len <= 130; len++) {
      const data = new Uint8Array(len).map((_, i) => (i * 31 + len) & 0xff);
      const expected = ref(data);
      expect(sha256Hex(data)).toBe(expected);

      const bytes = new Sha256();
      for (let i = 0; i < len; i++) bytes.update(data.subarray(i, i + 1));
      expect(bytes.digestHex()).toBe(expected);

      for (let s = 0; s <= len; s++) {
        const h = new Sha256();
        h.update(data.subarray(0, s));
        h.update(data.subarray(s));
        expect(h.digestHex()).toBe(expected);
      }
    }
  });

  it('throws on a second digest or an update after digest', () => {
    const h = new Sha256();
    h.update(enc('x'));
    h.digestHex();
    expect(() => h.digestHex()).toThrow();
    expect(() => h.update(enc('y'))).toThrow();
  });

  it('isSha256Hex accepts only lowercase 64-hex', () => {
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isSha256Hex('a'.repeat(63))).toBe(false);
    expect(isSha256Hex(5)).toBe(false);
  });
});
