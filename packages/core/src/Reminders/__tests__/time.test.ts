import { describe, expect, it } from 'vitest';
import {
  addCivilDays,
  civilWeekday,
  formatCivilDate,
  formatWallTime,
  isValidTimeZone,
  minuteOfDay,
  parseCivilDate,
  parseWallTime,
  wallToInstant,
  zonedParts,
  zoneOffset,
} from '../time';

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

describe('time helpers (more cases)', () => {
  it('parseWallTime accepts HH:MM and rejects the rest', () => {
    expect(parseWallTime('00:00')).toBe(0);
    expect(parseWallTime('7:05')).toBe(425);
    expect(parseWallTime(' 23:59 ')).toBe(1439);
    for (const bad of ['24:00', '12:60', '1200', '12:5', 'ab:cd', '', '-1:00']) expect(parseWallTime(bad)).toBeNull();
    expect(parseWallTime(5 as never)).toBeNull();
  });

  it('formatWallTime pads and wraps', () => {
    expect(formatWallTime(425)).toBe('07:05');
    expect(formatWallTime(1440 + 30)).toBe('00:30');
    expect(formatWallTime(-30)).toBe('23:30');
  });

  it('parseCivilDate rejects impossible dates; addCivilDays crosses months and leap days', () => {
    expect(parseCivilDate('2026-02-29')).toBeNull();
    expect(parseCivilDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseCivilDate('2026-2-3')).toBeNull();
    expect(formatCivilDate(addCivilDays({ year: 2026, month: 12, day: 31 }, 1))).toBe('2027-01-01');
    expect(formatCivilDate(addCivilDays({ year: 2028, month: 3, day: 1 }, -1))).toBe('2028-02-29');
  });

  it('zonedParts, civilWeekday and minuteOfDay read the zone, not the machine', () => {
    const t = Date.UTC(2026, 0, 1, 3, 30); // Thursday 03:30Z
    const ny = zonedParts(t, NY);
    expect([ny.year, ny.month, ny.day, ny.hour, ny.minute, ny.weekday]).toEqual([2025, 12, 31, 22, 30, 3]);
    expect(zonedParts(t, 'UTC').weekday).toBe(4);
    expect(civilWeekday({ year: 2026, month: 3, day: 8 })).toBe(0);
    expect(minuteOfDay(t, 'Asia/Kolkata')).toBe(9 * 60);
    // midnight is hour 0, never 24
    expect(zonedParts(Date.UTC(2026, 0, 1, 5, 0), NY).hour).toBe(0);
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('wallToInstant accepts minutes beyond 1440 (next day)', () => {
    expect(iso(wallToInstant({ year: 2026, month: 1, day: 15 }, 1440 + 60, 'UTC'))).toBe('2026-01-16T01:00:00.000Z');
  });
});
