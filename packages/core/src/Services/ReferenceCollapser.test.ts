import { collapseReferences, getBookName } from './ReferenceCollapser';
import { VerseIdHelper } from '../Data/Core/Types';

// Helper to build verse IDs concisely
function vid(book: number, chapter: number, verse: number): number {
  return VerseIdHelper.calculate(book, chapter, verse);
}

describe('ReferenceCollapser', () => {
  describe('collapseReferences', () => {
    it('returns empty string for empty array', () => {
      expect(collapseReferences([])).toBe('');
    });

    it('formats a single verse', () => {
      expect(collapseReferences([vid(43, 3, 16)])).toBe('John 3:16');
    });

    it('collapses consecutive verses into a range', () => {
      const ids = [vid(44, 1, 4), vid(44, 1, 5), vid(44, 1, 6)];
      expect(collapseReferences(ids)).toBe('Acts 1:4-6');
    });

    it('separates non-consecutive verses with commas', () => {
      const ids = [vid(44, 1, 2), vid(44, 1, 5)];
      expect(collapseReferences(ids)).toBe('Acts 1:2, 5');
    });

    it('mixes ranges and individual verses', () => {
      const ids = [vid(44, 1, 2), vid(44, 1, 4), vid(44, 1, 5)];
      expect(collapseReferences(ids)).toBe('Acts 1:2, 4-5');
    });

    it('handles multiple chapters in the same book', () => {
      const ids = [vid(45, 2, 3), vid(45, 4, 5)];
      expect(collapseReferences(ids)).toBe('Romans 2:3, 4:5');
    });

    it('separates different books with semicolons', () => {
      const ids = [
        vid(44, 1, 2), vid(44, 1, 4), vid(44, 1, 5),
        vid(45, 2, 3), vid(45, 4, 5)
      ];
      expect(collapseReferences(ids)).toBe('Acts 1:2, 4-5; Romans 2:3, 4:5');
    });

    it('uses short format', () => {
      const ids = [
        vid(44, 1, 2), vid(44, 1, 4), vid(44, 1, 5),
        vid(45, 2, 3), vid(45, 4, 5)
      ];
      expect(collapseReferences(ids, { format: 'short' })).toBe('Ac 1:2, 4-5; Ro 2:3, 4:5');
    });

    it('uses medium format', () => {
      const ids = [vid(46, 13, 4), vid(46, 13, 5), vid(46, 13, 6)];
      expect(collapseReferences(ids, { format: 'medium' })).toBe('1 Cor 13:4-6');
    });

    it('sorts unsorted input', () => {
      const ids = [vid(45, 4, 5), vid(44, 1, 2), vid(45, 2, 3)];
      expect(collapseReferences(ids)).toBe('Acts 1:2; Romans 2:3, 4:5');
    });

    it('deduplicates identical verse IDs', () => {
      const ids = [vid(43, 3, 16), vid(43, 3, 16), vid(43, 3, 16)];
      expect(collapseReferences(ids)).toBe('John 3:16');
    });

    it('handles many books', () => {
      const ids = [vid(1, 1, 1), vid(19, 23, 1), vid(66, 22, 21)];
      expect(collapseReferences(ids)).toBe('Genesis 1:1; Psalms 23:1; Revelation 22:21');
    });

    it('handles many books in short format', () => {
      const ids = [vid(1, 1, 1), vid(19, 23, 1), vid(66, 22, 21)];
      expect(collapseReferences(ids, { format: 'short' })).toBe('Ge 1:1; Ps 23:1; Re 22:21');
    });

    it('collapses a long consecutive run', () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => vid(43, 1, v));
      expect(collapseReferences(ids)).toBe('John 1:1-10');
    });

    it('handles multiple ranges in same chapter', () => {
      const ids = [vid(43, 1, 1), vid(43, 1, 2), vid(43, 1, 5), vid(43, 1, 6), vid(43, 1, 10)];
      expect(collapseReferences(ids)).toBe('John 1:1-2, 5-6, 10');
    });

    it('handles custom separators', () => {
      const ids = [vid(44, 1, 2), vid(45, 3, 4)];
      expect(collapseReferences(ids, { bookSeparator: ' | ', verseSeparator: ',' }))
        .toBe('Acts 1:2 | Romans 3:4');
    });

    it('skips invalid verse IDs', () => {
      const ids = [0, vid(43, 3, 16), -1];
      expect(collapseReferences(ids)).toBe('John 3:16');
    });

    it('handles numbered books correctly', () => {
      const ids = [vid(62, 4, 8), vid(62, 4, 9)];
      expect(collapseReferences(ids)).toBe('1 John 4:8-9');
      expect(collapseReferences(ids, { format: 'short' })).toBe('1Jn 4:8-9');
    });

    it('omits chapter for single-chapter books', () => {
      // Jude (65), Obadiah (31), Philemon (57), 2 John (63), 3 John (64)
      expect(collapseReferences([vid(65, 1, 3)])).toBe('Jude 3');
      expect(collapseReferences([vid(65, 1, 3), vid(65, 1, 4), vid(65, 1, 5)])).toBe('Jude 3-5');
      expect(collapseReferences([vid(31, 1, 1), vid(31, 1, 4)])).toBe('Obadiah 1, 4');
      expect(collapseReferences([vid(57, 1, 6)], { format: 'short' })).toBe('Phm 6');
      expect(collapseReferences([vid(63, 1, 10)], { format: 'medium' })).toBe('2 John 10');
    });

    it('handles same chapter appearing in non-contiguous groups', () => {
      // Acts 1:2, Romans 3:5, Acts 1:7 - Acts should merge
      const ids = [vid(44, 1, 2), vid(45, 3, 5), vid(44, 1, 7)];
      // After sorting, Acts comes first, then Romans
      expect(collapseReferences(ids)).toBe('Acts 1:2, 7; Romans 3:5');
    });
  });

  describe('getBookName', () => {
    it('returns long names by default', () => {
      expect(getBookName(1)).toBe('Genesis');
      expect(getBookName(66)).toBe('Revelation');
    });

    it('returns medium names', () => {
      expect(getBookName(1, 'medium')).toBe('Gen');
      expect(getBookName(46, 'medium')).toBe('1 Cor');
    });

    it('returns short names', () => {
      expect(getBookName(1, 'short')).toBe('Ge');
      expect(getBookName(44, 'short')).toBe('Ac');
      expect(getBookName(45, 'short')).toBe('Ro');
    });

    it('returns fallback for invalid book number', () => {
      expect(getBookName(99)).toBe('Book 99');
    });
  });
});
