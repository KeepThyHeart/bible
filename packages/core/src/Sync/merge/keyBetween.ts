/**
 * Fractional order keys for collections and pinned items (task 0150, W2-B; design "Merge rules per data type":
 * "order by a fractional index string so two inserts never collide").
 *
 * A key is a non-empty string over the 62 digits `0-9A-Za-z` (ASCII order, so plain string comparison, JS `<`
 * and SQLite's BINARY collation all agree) read as a base-62 fraction in (0, 1). A key never ends in `0`, so
 * there is always room below it. Pure, deterministic and browser-safe.
 *
 * Concurrent inserts: two devices inserting between the same neighbours compute the same midpoint `m`; with a
 * `deviceId` the key is `m + tag(deviceId)`, where `tag` is a fixed-width (12 digit) injective encoding of the
 * 16-hex device id that never uses `0`. Distinct devices therefore always get distinct keys, both strictly
 * between the neighbours, and they still sort deterministically (by device id) against each other.
 *
 * Length: `midpoint` stops at the first digit with room, so each insert into the same gap halves it and costs
 * at most log2(62) ~ 5.95 bits; a long run of n inserts at one spot (always at the front, always at the end,
 * or always right after one fixed key) grows keys by about one digit per 6 inserts. The device tag adds a
 * constant 12 digits on top that does not accumulate (the next midpoint stops inside or before it). The
 * documented bound, checked by the tests: after n repeated inserts at one spot starting from bounds of length
 * <= L, every key has length <= L + 1 + ceil(n / 5) + 12 (the 12 only with a device id).
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62
const KEY_RE = /^[0-9A-Za-z]*[1-9A-Za-z]$/;
const DEVICE_RE = /^[0-9a-f]{16}$/;

/** Length of the device tag appended when `keyBetween` is given a device id. */
export const ORDER_KEY_DEVICE_TAG_LENGTH = 12;

/** True for a well-formed order key (base-62 digits, not ending in `0`). */
export function isOrderKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

function digit(c: string): number {
  return DIGITS.indexOf(c);
}

/** Midpoint of the fractions `a` ('' = 0) and `b` (null = 1). Never a prefix of `b`, never ends in `0`. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const dA = a.length > 0 ? digit(a[0]) : 0;
  const dB = b !== null ? digit(b[0]) : BASE;
  if (dB - dA > 1) return DIGITS[Math.round((dA + dB) / 2)];
  // Adjacent digits: keep a's digit and go one level deeper, above the rest of a.
  return DIGITS[dA] + midpoint(a.slice(1), null);
}

/** Injective 12-digit encoding of a 16-hex device id over the digits 1..z (never `0`). */
function deviceTag(deviceId: string): string {
  let out = '';
  for (let i = 0; i < 16; i += 4) {
    const v = parseInt(deviceId.slice(i, i + 4), 16); // 0..65535 < 61^3
    out += DIGITS[1 + Math.floor(v / 3721)] + DIGITS[1 + (Math.floor(v / 61) % 61)] + DIGITS[1 + (v % 61)];
  }
  return out;
}

/**
 * A key strictly between `a` and `b` (`null` = no bound on that side). With `deviceId` (16 lowercase hex, the
 * sync device id) concurrent inserts on different devices never produce equal keys. Throws on malformed keys,
 * on `a >= b` and on a malformed device id.
 */
export function keyBetween(a: string | null, b: string | null, deviceId?: string): string {
  if (a !== null && !isOrderKey(a)) throw new Error('keyBetween: malformed lower key');
  if (b !== null && !isOrderKey(b)) throw new Error('keyBetween: malformed upper key');
  if (a !== null && b !== null && a >= b) throw new Error('keyBetween: lower key must sort before upper key');
  if (deviceId !== undefined && !DEVICE_RE.test(deviceId)) throw new Error('keyBetween: device id must be 16 lowercase hex chars');
  const m = midpoint(a ?? '', b);
  // m is not a prefix of b, so anything appended to m stays below b; and m > a, so it stays above a.
  return deviceId === undefined ? m : m + deviceTag(deviceId);
}
