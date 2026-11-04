/**
 * Hybrid logical clock (contracts 0063 §4, task 0150 W1-C).
 */
import { describe, it, expect } from 'vitest';
import { createHlc, compareHlc, parseHlc } from '../../../Sync/tracking/Hlc';

const DEV_A = '00000000000000aa';
const DEV_B = '00000000000000bb';
const DAY = 24 * 60 * 60 * 1000;

describe('HLC', () => {
  it('formats fixed-width lowercase hex and parses back', () => {
    const clock = createHlc(DEV_A);
    const h = clock.tick(0x192f3a1b2c3);
    expect(h).toBe('0192f3a1b2c3:0000:00000000000000aa');
    expect(parseHlc(h)).toEqual({ ms: 0x192f3a1b2c3, counter: 0, deviceId: DEV_A });
    expect(clock.last).toBe(h);
  });

  it('rejects malformed input', () => {
    expect(() => parseHlc('192f3a1b2c3:0000:00000000000000aa')).toThrow();
    expect(() => parseHlc('0192F3A1B2C3:0000:00000000000000aa')).toThrow();
    expect(() => createHlc('xyz')).toThrow();
  });

  it('is monotonic when the wall clock goes back', () => {
    const clock = createHlc(DEV_A);
    const seen: string[] = [];
    for (const wall of [1000, 1000, 2000, 1500, 500, 500, 2000, 2001, 10]) seen.push(clock.tick(wall));
    for (let i = 1; i < seen.length; i++) expect(compareHlc(seen[i - 1], seen[i])).toBeLessThan(0);
    expect(parseHlc(seen[3])).toMatchObject({ ms: 2000, counter: 1 });
    expect(parseHlc(seen[7])).toMatchObject({ ms: 2001, counter: 0 });
  });

  it('resumes from a persisted last value', () => {
    const a = createHlc(DEV_A);
    a.tick(5000);
    const b = createHlc(DEV_A, a.last);
    expect(compareHlc(b.tick(100), a.last)).toBeGreaterThan(0);
  });

  it('carries counter overflow into the millisecond field', () => {
    const clock = createHlc(DEV_A, '000000000064:ffff:00000000000000aa');
    expect(clock.tick(50)).toBe('000000000065:0000:00000000000000aa');
  });

  it('receive moves past both the remote and the local clock', () => {
    const clock = createHlc(DEV_A);
    clock.tick(1000);
    const remote = '0000000007d0:0005:00000000000000bb'; // ms 2000
    const merged = clock.receive(remote, 1500);
    expect(parseHlc(merged)).toEqual({ ms: 2000, counter: 6, deviceId: DEV_A });
    expect(compareHlc(merged, remote)).toBeGreaterThan(0);
    expect(compareHlc(clock.tick(1500), merged)).toBeGreaterThan(0);
    // Equal ms on both sides: max counter + 1.
    const c2 = createHlc(DEV_A, '0000000007d0:0009:00000000000000aa');
    expect(parseHlc(c2.receive('0000000007d0:0003:00000000000000bb', 100)).counter).toBe(10);
    // Wall clock ahead of both: counter resets.
    expect(parseHlc(c2.receive('0000000007d0:0003:00000000000000bb', 9000))).toMatchObject({ ms: 9000, counter: 0 });
  });

  it('receive rejects a remote clock more than 24 h ahead, and leaves the clock unchanged', () => {
    const clock = createHlc(DEV_A);
    const before = clock.tick(1_000_000);
    const far = `${(1_000_000 + DAY + 1).toString(16).padStart(12, '0')}:0000:${DEV_B}`;
    expect(() => clock.receive(far, 1_000_000)).toThrow(/ahead/);
    expect(clock.last).toBe(before);
    const near = `${(1_000_000 + DAY).toString(16).padStart(12, '0')}:0000:${DEV_B}`;
    expect(() => clock.receive(near, 1_000_000)).not.toThrow();
    const strict = createHlc(DEV_A, undefined, 10);
    expect(() => strict.receive(`${(111).toString(16).padStart(12, '0')}:0000:${DEV_B}`, 100)).toThrow();
  });

  it('string order equals field order', () => {
    const values = [
      '000000000000:0000:00000000000000aa',
      '000000000001:0000:00000000000000aa',
      '00000000000f:0000:00000000000000aa',
      '000000000010:0000:00000000000000aa',
      '000000000010:0001:00000000000000aa',
      '000000000010:000a:00000000000000aa',
      '000000000010:0010:00000000000000aa',
      '000000000010:0010:00000000000000bb',
      '0192f3a1b2c3:0000:0000000000000000',
      'ffffffffffff:ffff:ffffffffffffffff',
    ];
    const byFields = (a: string, b: string): number => {
      const x = parseHlc(a);
      const y = parseHlc(b);
      return x.ms - y.ms || x.counter - y.counter || (x.deviceId < y.deviceId ? -1 : x.deviceId > y.deviceId ? 1 : 0);
    };
    for (const a of values) {
      for (const b of values) expect(Math.sign(compareHlc(a, b))).toBe(Math.sign(byFields(a, b)));
    }
    expect([...values].reverse().sort(compareHlc)).toEqual(values);
  });
});
