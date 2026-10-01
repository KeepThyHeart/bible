import { describe, expect, it } from 'vitest';
import { wallToInstant, zonedParts, zoneOffset } from '../time';

const NY = 'America/New_York';
const iso = (t: number) => new Date(t).toISOString();

describe('wallToInstant', () => {
  it('maps an ordinary wall time', () => {
    expect(iso(wallToInstant({ year: 2026, month: 1, day: 15 }, 8 * 60, NY))).toBe('2026-01-15T13:00:00.000Z');
    expect(iso(wallToInstant({ year: 2026, month: 7, day: 15 }, 8 * 60, NY))).toBe('2026-07-15T12:00:00.000Z');
  });

  it('resolves a time in the spring-forward gap to the first valid minute after it', () => {
    // 2026-03-08: 02:00 EST -> 03:00 EDT in New York.
    const t = wallToInstant({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, NY);
    expect(iso(t)).toBe('2026-03-08T07:00:00.000Z');
    const p = zonedParts(t, NY);
    expect([p.hour, p.minute]).toEqual([3, 0]);
  });

  it('resolves a repeated time on fall-back to the first occurrence', () => {
    // 2026-11-01: 02:00 EDT -> 01:00 EST; 01:30 happens twice.
    const t = wallToInstant({ year: 2026, month: 11, day: 1 }, 90, NY);
    expect(iso(t)).toBe('2026-11-01T05:30:00.000Z');
  });

  it('handles a zone whose gap is at midnight and a 30-minute DST zone', () => {
    // Santiago: 2026-09-06 00:00 -> 01:00.
    const t = wallToInstant({ year: 2026, month: 9, day: 6 }, 0, 'America/Santiago');
    expect(zonedParts(t, 'America/Santiago').hour).toBe(1);
    // Lord Howe: +10:30 standard, +11 in summer (30-minute shift), 2026-10-04 02:00 -> 02:30.
    const lh = wallToInstant({ year: 2026, month: 10, day: 4 }, 2 * 60 + 10, 'Australia/Lord_Howe');
    const p = zonedParts(lh, 'Australia/Lord_Howe');
    expect([p.hour, p.minute]).toEqual([2, 30]);
  });

  it('zoneOffset reports the offset in ms', () => {
    expect(zoneOffset(Date.UTC(2026, 0, 1), NY)).toBe(-5 * 3600_000);
    expect(zoneOffset(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(5.5 * 3600_000);
  });
});
