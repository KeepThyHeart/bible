import { describe, it, expect } from 'vitest';
import { VerseOfTheDayService } from './VerseOfTheDayService';

describe('VerseOfTheDayService', () => {
  // Exercises the same bundled dataset the shipped default uses.
  const service = VerseOfTheDayService.fromDefault();

  // ==========================================================================
  // getToday() - basic behavior
  // ==========================================================================

  describe('getToday', () => {
    it('should return a valid verse reference', () => {
      const result = service.getToday();
      expect(result.book).toBeGreaterThanOrEqual(1);
      expect(result.book).toBeLessThanOrEqual(66);
      expect(result.chapter).toBeGreaterThanOrEqual(1);
      expect(result.verse).toBeGreaterThanOrEqual(1);
    });

    it('should return the same verse for the same date', () => {
      const date = new Date(2025, 5, 15); // June 15, 2025
      const result1 = service.getToday(date);
      const result2 = service.getToday(date);
      expect(result1).toEqual(result2);
    });

    it('should return different verses for different dates', () => {
      const date1 = new Date(2025, 0, 1); // Jan 1
      const date2 = new Date(2025, 0, 2); // Jan 2
      const result1 = service.getToday(date1);
      const result2 = service.getToday(date2);
      // They should differ (different day-of-year and Jan 1 is a holiday)
      expect(result1).not.toEqual(result2);
    });

    it('should accept a Date parameter to override today', () => {
      const specificDate = new Date(2025, 2, 10); // March 10
      const result = service.getToday(specificDate);
      expect(result.book).toBeDefined();
      expect(result.chapter).toBeDefined();
      expect(result.verse).toBeDefined();
    });
  });

  // ==========================================================================
  // Holiday verses
  // ==========================================================================

  describe('holiday verses', () => {
    it('should return Christmas Day verse on Dec 25', () => {
      const christmas = new Date(2025, 11, 25);
      const result = service.getToday(christmas);
      expect(result.holiday).toBe('Christmas Day');
      // Luke 2:11
      expect(result.book).toBe(42);
      expect(result.chapter).toBe(2);
      expect(result.verse).toBe(11);
    });

    it('should return Christmas Eve verse on Dec 24', () => {
      const christmasEve = new Date(2025, 11, 24);
      const result = service.getToday(christmasEve);
      expect(result.holiday).toBe('Christmas Eve');
      // Isaiah 9:6
      expect(result.book).toBe(23);
      expect(result.chapter).toBe(9);
      expect(result.verse).toBe(6);
    });

    it('should return New Year\'s Day verse on Jan 1', () => {
      const newYear = new Date(2025, 0, 1);
      const result = service.getToday(newYear);
      expect(result.holiday).toBe("New Year's Day");
      // Lamentations 3:22
      expect(result.book).toBe(25);
      expect(result.chapter).toBe(3);
      expect(result.verse).toBe(22);
    });

    it('should return Valentine\'s Day verse on Feb 14', () => {
      const valentine = new Date(2025, 1, 14);
      const result = service.getToday(valentine);
      expect(result.holiday).toBe("Valentine's Day");
      // 1 Corinthians 13:4
      expect(result.book).toBe(46);
      expect(result.chapter).toBe(13);
      expect(result.verse).toBe(4);
    });

    it('should return Easter Sunday verse on Easter 2025 (April 20)', () => {
      // Easter 2025 is April 20
      const easter2025 = new Date(2025, 3, 20);
      const result = service.getToday(easter2025);
      expect(result.holiday).toBe('Easter Sunday');
      // Matthew 28:6
      expect(result.book).toBe(40);
      expect(result.chapter).toBe(28);
      expect(result.verse).toBe(6);
    });

    it('should return Good Friday verse 2 days before Easter 2025 (April 18)', () => {
      const goodFriday = new Date(2025, 3, 18);
      const result = service.getToday(goodFriday);
      expect(result.holiday).toBe('Good Friday');
      // Isaiah 53:5
      expect(result.book).toBe(23);
      expect(result.chapter).toBe(53);
      expect(result.verse).toBe(5);
    });

    it('should return Palm Sunday verse 7 days before Easter 2025 (April 13)', () => {
      const palmSunday = new Date(2025, 3, 13);
      const result = service.getToday(palmSunday);
      expect(result.holiday).toBe('Palm Sunday');
      // Matthew 21:9
      expect(result.book).toBe(40);
      expect(result.chapter).toBe(21);
      expect(result.verse).toBe(9);
    });

    it('should return Thanksgiving verse on 4th Thursday of November 2025 (Nov 27)', () => {
      const thanksgiving = new Date(2025, 10, 27);
      const result = service.getToday(thanksgiving);
      expect(result.holiday).toBe('Thanksgiving');
      // Psalm 107:1
      expect(result.book).toBe(19);
      expect(result.chapter).toBe(107);
      expect(result.verse).toBe(1);
    });

    it('should not return a holiday for a normal date', () => {
      // Pick a date unlikely to be a holiday
      const normalDate = new Date(2025, 6, 15); // July 15
      const result = service.getToday(normalDate);
      expect(result.holiday).toBeUndefined();
    });
  });

  // ==========================================================================
  // Easter calculation across years
  // ==========================================================================

  describe('Easter calculation across years', () => {
    // Known Easter dates to validate the algorithm
    const knownEasters: Array<[number, number, number]> = [
      // [year, month (1-based), day]
      [2024, 3, 31],  // March 31, 2024
      [2025, 4, 20],  // April 20, 2025
      [2026, 4, 5],   // April 5, 2026
      [2027, 3, 28],  // March 28, 2027
      [2030, 4, 21],  // April 21, 2030
    ];

    for (const [year, month, day] of knownEasters) {
      it(`should return Easter Sunday for ${year}-${month}-${day}`, () => {
        const easterDate = new Date(year, month - 1, day);
        const result = service.getToday(easterDate);
        expect(result.holiday).toBe('Easter Sunday');
      });
    }
  });

  // ==========================================================================
  // Day-of-year consistency
  // ==========================================================================

  describe('day-of-year consistency', () => {
    it('should cycle through 366 verses over a full year', () => {
      // `seen` was collected and then never asserted on - the body only
      // checked that every day produced a book number in range, which the
      // test's own name says is not the point.
      const seen = new Set<string>();
      for (let i = 0; i < 366; i++) {
        const date = new Date(2025, 0, 1 + i);
        const result = service.getToday(date);
        expect(result.book).toBeGreaterThanOrEqual(1);
        expect(result.book).toBeLessThanOrEqual(66);
        seen.add(`${result.book}:${result.chapter}:${result.verse}`);
      }

      // `getToday` indexes the cycle by day-of-year, so a year walks the whole
      // list. Holidays override the cycle entry for their date and can repeat a
      // verse the cycle also carries, so this asserts a large spread rather
      // than exactly 366 - but a service stuck on one verse, or cycling over a
      // handful, fails it.
      expect(seen.size).toBeGreaterThan(300);
    });

    it('should wrap around for day 367 (same as day 1)', () => {
      // Day of year 1 and day of year 367 should map to same index
      // In practice this is next year's Jan 1, which is a holiday anyway.
      // Test the non-holiday path with two dates a year apart that aren't holidays
      const date1 = new Date(2025, 6, 15);
      const date2 = new Date(2026, 6, 15);
      const result1 = service.getToday(date1);
      const result2 = service.getToday(date2);
      // Same day-of-year = same verse (assuming neither is a holiday)
      expect(result1.book).toBe(result2.book);
      expect(result1.chapter).toBe(result2.chapter);
      expect(result1.verse).toBe(result2.verse);
    });
  });
});
