/**
 * Crockford base32 for recovery codes. Alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
 * (no I, L, O, U); 32 chars <-> 20 bytes (160 bits).
 */

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Upper-case char code -> 5-bit value, -1 if invalid. Includes the aliases O->0 and I/L->1. */
const LOOKUP: Int8Array = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) t[CROCKFORD_ALPHABET.charCodeAt(i)] = i;
  t['O'.charCodeAt(0)] = 0;
  t['I'.charCodeAt(0)] = 1;
  t['L'.charCodeAt(0)] = 1;
  return t;
})();

/** Encode bytes (length a multiple of 5) as upper-case Crockford base32, no padding, no separators. */
export function crockfordEncode(bytes: Uint8Array): string {
  if (bytes.length % 5 !== 0) throw new RangeError('Crockford encode needs a multiple of 5 bytes');
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_ALPHABET[(acc >>> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/**
 * Decode Crockford base32: any case, whitespace and dashes ignored, aliases O->0 and I/L->1.
 * Throws RangeError on an invalid character or a character count that is not a whole number of 5-byte groups
 * (a multiple of 8 characters), so no partial or padding bits exist. Error messages never echo the input.
 */
export function crockfordDecode(input: string): Uint8Array {
  const clean = String(input).replace(/[\s-]/g, '');
  if (clean.length % 8 !== 0) throw new RangeError('Invalid base32 length');
  const out = new Uint8Array((clean.length / 8) * 5);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    let c = clean.charCodeAt(i);
    if (c >= 97 && c <= 122) c -= 32; // a-z -> A-Z
    const v = c < 128 ? LOOKUP[c] : -1;
    if (v < 0) throw new RangeError('Invalid base32 character');
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
