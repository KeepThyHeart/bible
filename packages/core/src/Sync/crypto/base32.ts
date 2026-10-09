/**
 * Crockford base32 for recovery codes (W1-B implements). Alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
 * (no I, L, O, U); 32 chars <-> 20 bytes (160 bits).
 */
import { notImplemented } from '../notImplemented';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Encode bytes (length a multiple of 5) as upper-case Crockford base32, no padding, no separators. */
export function crockfordEncode(bytes: Uint8Array): string {
  throw notImplemented(bytes);
}

/**
 * Decode Crockford base32: any case, spaces and dashes ignored, aliases O->0 and I/L->1.
 * Throws RangeError on an invalid character or a bit length that is not a multiple of 8 bytes' worth.
 */
export function crockfordDecode(input: string): Uint8Array {
  throw notImplemented(input);
}
