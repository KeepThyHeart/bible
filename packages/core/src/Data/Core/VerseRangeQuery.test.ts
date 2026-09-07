import { describe, it, expect } from 'vitest';
import {
  verseRangeContainsPoint,
  verseRangeOverlapsRange,
  verseRangeMatchesPoint,
} from './VerseRangeQuery';

describe('VerseRangeQuery', () => {
  describe('verseRangeContainsPoint', () => {
    it('should generate SQL and params for point containment', () => {
      const result = verseRangeContainsPoint('verse_id_start', 'verse_id_end', 43003016);
      expect(result.sql).toBe('(verse_id_start <= ? AND (verse_id_end IS NULL OR verse_id_end >= ?))');
      expect(result.params).toEqual([43003016, 43003016]);
    });

    it('should use custom column names', () => {
      const result = verseRangeContainsPoint('start_id', 'end_id', 1001001);
      expect(result.sql).toContain('start_id');
      expect(result.sql).toContain('end_id');
    });
  });

  describe('verseRangeOverlapsRange', () => {
    it('should generate SQL and params for range overlap', () => {
      const result = verseRangeOverlapsRange('verse_id_start', 'verse_id_end', 43003016, 43003020);
      expect(result.sql).toBe(
        '((verse_id_start BETWEEN ? AND ?) OR (verse_id_end BETWEEN ? AND ?) OR (verse_id_start <= ? AND verse_id_end >= ?))'
      );
      expect(result.params).toEqual([43003016, 43003020, 43003016, 43003020, 43003016, 43003020]);
    });

    it('should handle single-verse range', () => {
      const result = verseRangeOverlapsRange('s', 'e', 1001001, 1001001);
      expect(result.params).toEqual([1001001, 1001001, 1001001, 1001001, 1001001, 1001001]);
    });
  });

  describe('verseRangeMatchesPoint', () => {
    it('should generate SQL and params for point matching', () => {
      const result = verseRangeMatchesPoint('verse_id_start', 'verse_id_end', 43003016);
      expect(result.sql).toBe('(verse_id_start = ? OR (verse_id_start <= ? AND verse_id_end >= ?))');
      expect(result.params).toEqual([43003016, 43003016, 43003016]);
    });
  });
});
