import * as fs from 'fs';

// Imported, not read from disk. `resolveJsonModule` makes tsc treat this as a
// program input and emit it to `dist/Data/`, so there is no asset-copy step -
// and unlike a `__dirname`-relative read it still resolves when a consumer
// bundles `@bible/core` into a single file.
import defaultVotdData from '../Data/verse-of-the-day.json';

/** A verse reference: book number, chapter, verse */
export interface VerseRef {
  book: number;
  chapter: number;
  verse: number;
}

/** Holiday definition from the JSON data file */
interface HolidayDef {
  name: string;
  type: 'fixed' | 'easter_relative' | 'computed';
  month?: number;
  day?: number;
  easterOffset?: number;
  computedRule?: string;
  verse: VerseRef;
}

/** Year cycle from the JSON data file */
interface YearCycle {
  year: number;
  verses: VerseRef[];
}

/** Root JSON data structure */
export interface VerseOfTheDayData {
  version: string;
  years: YearCycle[];
  holidays?: HolidayDef[];
}

// --- Date Helpers ------------------------------------------------------

/** Easter calculation (Anonymous Gregorian algorithm) */
function computeEaster(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function sameDay(date: Date, month: number, day: number): boolean {
  return date.getMonth() + 1 === month && date.getDate() === day;
}

function daysFrom(date: Date, month: number, day: number, offset: number): boolean {
  const target = new Date(date.getFullYear(), month - 1, day + offset);
  return date.getMonth() === target.getMonth() && date.getDate() === target.getDate();
}

// --- Service -----------------------------------------------------------

export class VerseOfTheDayService {
  private yearCycles: YearCycle[];
  private holidays: HolidayDef[];

  constructor(data: VerseOfTheDayData) {
    this.yearCycles = data.years;
    this.holidays = data.holidays ?? [];
  }

  /**
   * The default VOTD dataset bundled with `@bible/core`.
   *
   * Replaces the former `defaultFilePath`, which resolved a path from
   * `__dirname` and so was silently unusable once a consumer bundled core.
   */
  static fromDefault(): VerseOfTheDayService {
    return new VerseOfTheDayService(defaultVotdData as VerseOfTheDayData);
  }

  /** Create from a JSON file path. */
  static fromFile(filePath: string): VerseOfTheDayService {
    const json = fs.readFileSync(filePath, 'utf8');
    return VerseOfTheDayService.fromJson(json);
  }

  /** Create from a JSON string. */
  static fromJson(json: string): VerseOfTheDayService {
    const data = JSON.parse(json) as VerseOfTheDayData;
    return new VerseOfTheDayService(data);
  }

  /**
   * Get today's verse of the day reference.
   * Returns { book, chapter, verse, holiday? }
   */
  getToday(date?: Date): { book: number; chapter: number; verse: number; holiday?: string } {
    const d = date ?? new Date();

    // Check for holiday-specific verses first
    const holiday = this.getHolidayVerse(d);
    if (holiday) {
      return { ...holiday.verse, holiday: holiday.name };
    }

    // Find the year-specific cycle, or fall back to year=0 (default)
    const year = d.getFullYear();
    const cycle = this.yearCycles.find(c => c.year === year)
      ?? this.yearCycles.find(c => c.year === 0)
      ?? this.yearCycles[0];

    // Use day-of-year (1-366) to index into daily verses
    const doy = dayOfYear(d);
    const idx = (doy - 1) % cycle.verses.length;
    return { ...cycle.verses[idx] };
  }

  /** Check if a holiday matches the given date. */
  private getHolidayVerse(date: Date): HolidayDef | null {
    const year = date.getFullYear();
    const easter = computeEaster(year);

    for (const holiday of this.holidays) {
      switch (holiday.type) {
        case 'fixed':
          if (holiday.month && holiday.day && sameDay(date, holiday.month, holiday.day)) {
            return holiday;
          }
          break;
        case 'easter_relative':
          if (holiday.easterOffset !== undefined) {
            if (holiday.easterOffset === 0) {
              if (sameDay(date, easter.month, easter.day)) return holiday;
            } else {
              if (daysFrom(date, easter.month, easter.day, holiday.easterOffset)) return holiday;
            }
          }
          break;
        case 'computed':
          if (holiday.computedRule === 'us_thanksgiving') {
            // 4th Thursday in November
            const nov1 = new Date(year, 10, 1);
            const firstThursday = (11 - nov1.getDay()) % 7 + 1;
            const thanksgiving = firstThursday + 21;
            if (sameDay(date, 11, thanksgiving)) return holiday;
          }
          break;
      }
    }

    return null;
  }
}
