import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { keyBetween, isOrderKey, ORDER_KEY_DEVICE_TAG_LENGTH } from '../../../Sync/merge/MergePolicy';

const DEV_A = '0000000000000000';
const DEV_B = 'ffffffffffffffff';
const DEV_C = '9f3c0a1b2c3d4e5f';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const device = fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 16, maxLength: 16 })
  .map((xs) => xs.map((x) => x.toString(16)).join(''));
/** Well-formed order keys (base 62, not ending in 0), biased to share prefixes so neighbours are often close. */
const orderKey = fc.tuple(
  fc.array(fc.constantFrom('0', '1', 'V', 'W', 'y', 'z', 'A', 'a'), { maxLength: 5 }),
  fc.integer({ min: 1, max: 61 }),
).map(([xs, last]) => xs.join('') + DIGITS[last]);
/** (a, b) with a < b, either side possibly open. */
const bounds = fc.tuple(fc.option(orderKey, { nil: null }), fc.option(orderKey, { nil: null }))
  .map(([a, b]): [string | null, string | null] => (a !== null && b !== null && b < a ? [b, a] : [a, b]))
  .filter(([a, b]) => a === null || b === null || a !== b);

function between(k: string, a: string | null, b: string | null): boolean {
  return (a === null || a < k) && (b === null || k < b);
}

describe('keyBetween', () => {
  it('handles null bounds', () => {
    const k = keyBetween(null, null);
    expect(isOrderKey(k)).toBe(true);
    expect(between(keyBetween(null, k), null, k)).toBe(true);
    expect(between(keyBetween(k, null), k, null)).toBe(true);
    expect(keyBetween(null, null, DEV_C)).toHaveLength(1 + ORDER_KEY_DEVICE_TAG_LENGTH);
  });

  it('rejects malformed input', () => {
    expect(() => keyBetween('a0', null)).toThrow();
    expect(() => keyBetween('', null)).toThrow();
    expect(() => keyBetween('a-', null)).toThrow();
    expect(() => keyBetween('b', 'a')).toThrow();
    expect(() => keyBetween('a', 'a')).toThrow();
    expect(() => keyBetween(null, null, 'XYZ')).toThrow();
  });

  it('is strictly between, well-formed and deterministic (property)', () => {
    fc.assert(fc.property(bounds, fc.option(device, { nil: undefined }), ([a, b], dev) => {
      const k = keyBetween(a, b, dev);
      expect(isOrderKey(k)).toBe(true);
      expect(between(k, a, b)).toBe(true);
      expect(keyBetween(a, b, dev)).toBe(k);
    }), { numRuns: 500 });
  });

  it('never collides for concurrent inserts by distinct devices (property)', () => {
    fc.assert(fc.property(bounds, device, device, ([a, b], d1, d2) => {
      fc.pre(d1 !== d2);
      const k1 = keyBetween(a, b, d1);
      const k2 = keyBetween(a, b, d2);
      expect(k1).not.toBe(k2);
      expect(between(k1, a, b) && between(k2, a, b)).toBe(true);
      // ...and the next insert between the two concurrent keys still works.
      const [lo, hi] = k1 < k2 ? [k1, k2] : [k2, k1];
      expect(between(keyBetween(lo, hi, d1), lo, hi)).toBe(true);
    }), { numRuns: 500 });
  });

  it('keeps a list strictly sorted under random concurrent inserts', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.nat(), fc.constantFrom(DEV_A, DEV_B, DEV_C)), { minLength: 1, maxLength: 200 }),
      (ops) => {
        const list: string[] = [];
        for (const [pos, dev] of ops) {
          const i = pos % (list.length + 1);
          const k = keyBetween(i > 0 ? list[i - 1] : null, i < list.length ? list[i] : null, dev);
          list.splice(i, 0, k);
        }
        for (let i = 1; i < list.length; i++) expect(list[i - 1] < list[i]).toBe(true);
      },
    ), { numRuns: 200 });
  });

  /**
   * Documented bound (see keyBetween.ts): after n inserts at one spot starting from bounds of length <= L,
   * length <= L + 1 + ceil(n / 5) + 12 (12 only with a device id). Real growth is about n / 6.
   */
  describe('length growth for repeated inserts at one spot', () => {
    const N = 3000;
    const bound = (L: number, n: number, dev: boolean): number => L + 1 + Math.ceil(n / 5) + (dev ? ORDER_KEY_DEVICE_TAG_LENGTH : 0);

    for (const dev of [undefined, DEV_C]) {
      const tag = dev ? 'with device' : 'without device';
      it(`always at the front (${tag})`, () => {
        const start = keyBetween(null, null, dev);
        let first = start;
        for (let n = 1; n <= N; n++) {
          const k = keyBetween(null, first, dev);
          expect(k < first).toBe(true);
          expect(k.length).toBeLessThanOrEqual(bound(start.length, n, !!dev));
          first = k;
        }
        expect(first.length).toBeLessThanOrEqual(Math.ceil(N / 5.9) + 1 + (dev ? ORDER_KEY_DEVICE_TAG_LENGTH : 0));
      });

      it(`always at the end (${tag})`, () => {
        const start = keyBetween(null, null, dev);
        let last = start;
        for (let n = 1; n <= N; n++) {
          const k = keyBetween(last, null, dev);
          expect(k > last).toBe(true);
          expect(k.length).toBeLessThanOrEqual(bound(start.length, n, !!dev));
          last = k;
        }
      });

      it(`always right after one fixed key (${tag})`, () => {
        const a = keyBetween(null, null, dev);
        const b0 = keyBetween(a, null, dev);
        let b = b0;
        for (let n = 1; n <= N; n++) {
          const k = keyBetween(a, b, dev);
          expect(a < k && k < b).toBe(true);
          expect(k.length).toBeLessThanOrEqual(bound(Math.max(a.length, b0.length), n, !!dev));
          b = k;
        }
      });
    }

    it('alternating devices at the same spot stay bounded', () => {
      const devs = [DEV_A, DEV_B, DEV_C];
      const start = keyBetween(null, null, DEV_A);
      let first = start;
      for (let n = 1; n <= N; n++) {
        const k = keyBetween(null, first, devs[n % 3]);
        expect(k < first).toBe(true);
        expect(k.length).toBeLessThanOrEqual(bound(start.length, n, true));
        first = k;
      }
    });
  });
});
