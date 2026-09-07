import { describe, it, expect } from 'vitest';
import { VerseReferenceIndexingService, DetectedVerseReference } from './VerseReferenceIndexingService';

describe('VerseReferenceIndexingService', () => {
  const service = new VerseReferenceIndexingService();

  // ==========================================================================
  // extractVerseReferences() - Standard references
  // ==========================================================================

  describe('extractVerseReferences - standard references', () => {
    it('should detect "John 3:16"', () => {
      const refs = service.extractVerseReferences('See John 3:16 for details');
      expect(refs).toHaveLength(1);
      expect(refs[0].verseIdStart).toBe(43003016); // John 3:16
      expect(refs[0].referenceText).toContain('John 3:16');
    });

    it('should detect verse range "Romans 8:28-39"', () => {
      const refs = service.extractVerseReferences('Read Romans 8:28-39');
      expect(refs).toHaveLength(1);
      expect(refs[0].verseIdStart).toBe(45008028);
      expect(refs[0].verseIdEnd).toBe(45008039);
    });

    it('should detect numbered book references like "1 John 3:16"', () => {
      const refs = service.extractVerseReferences('1 John 3:16 says');
      expect(refs).toHaveLength(1);
      expect(refs[0].verseIdStart).toBe(62003016); // 1 John = book 62
    });

    it('should detect multiple references in same text', () => {
      const refs = service.extractVerseReferences('Compare John 3:16 and Genesis 1:1');
      expect(refs).toHaveLength(2);
      expect(refs[0].verseIdStart).toBe(43003016); // John 3:16
      expect(refs[1].verseIdStart).toBe(1001001);  // Genesis 1:1
    });

    it('should detect abbreviated book names', () => {
      const refs = service.extractVerseReferences('See Matt 5:16 and Gen 1:1');
      expect(refs).toHaveLength(2);
      expect(refs[0].verseIdStart).toBe(40005016); // Matthew 5:16
      expect(refs[1].verseIdStart).toBe(1001001);  // Genesis 1:1
    });

    it('should return empty array for text with no references', () => {
      const refs = service.extractVerseReferences('No Bible references here.');
      expect(refs).toHaveLength(0);
    });

    it('should return empty array for empty string', () => {
      const refs = service.extractVerseReferences('');
      expect(refs).toHaveLength(0);
    });

    it('should sort results by position in text', () => {
      const refs = service.extractVerseReferences('First Genesis 1:1 then John 3:16');
      expect(refs).toHaveLength(2);
      expect(refs[0].position).toBeLessThan(refs[1].position);
    });
  });

  // ==========================================================================
  // extractVerseReferences() - Continuation references (v., vs., verse)
  // ==========================================================================

  describe('extractVerseReferences - continuation references', () => {
    it('should detect "verse 16" when currentBook and currentChapter are set', () => {
      const refs = service.extractVerseReferences('see verse 16', {
        currentBook: 43,    // John
        currentChapter: 3,
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].verseIdStart).toBe(43003016); // John 3:16
      expect(refs[0].referenceText).toBe('verse 16');
    });

    it('should detect "v. 5" as continuation reference', () => {
      const refs = service.extractVerseReferences('also v. 5 is relevant', {
        currentBook: 45,    // Romans
        currentChapter: 8,
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].verseIdStart).toBe(45008005);
    });

    it('should detect "vs. 16-17" as a range', () => {
      const refs = service.extractVerseReferences('compare vs. 16-17', {
        currentBook: 43,
        currentChapter: 3,
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].verseIdStart).toBe(43003016);
      expect(refs[0].verseIdEnd).toBe(43003017);
    });

    it('should not detect continuation references without context', () => {
      const refs = service.extractVerseReferences('see verse 16');
      // No currentBook/currentChapter provided
      expect(refs).toHaveLength(0);
    });
  });

  // ==========================================================================
  // extractVerseReferences() - Context extraction
  // ==========================================================================

  describe('extractVerseReferences - context extraction', () => {
    it('should include context by default', () => {
      const text = 'A long preamble before the reference John 3:16 and some text after it.';
      const refs = service.extractVerseReferences(text);
      expect(refs).toHaveLength(1);
      expect(refs[0].context).toBeDefined();
      expect(refs[0].contextBefore).toBeDefined();
      expect(refs[0].contextAfter).toBeDefined();
    });

    it('should not include context when includeContext is false', () => {
      const refs = service.extractVerseReferences('John 3:16', { includeContext: false });
      expect(refs).toHaveLength(1);
      expect(refs[0].context).toBeUndefined();
      expect(refs[0].contextBefore).toBeUndefined();
      expect(refs[0].contextAfter).toBeUndefined();
    });

    it('should add ellipsis when context is truncated', () => {
      const longText = 'x'.repeat(100) + ' John 3:16 ' + 'y'.repeat(100);
      const refs = service.extractVerseReferences(longText, { contextLength: 20 });
      expect(refs).toHaveLength(1);
      expect(refs[0].context).toContain('...');
    });
  });

  // ==========================================================================
  // extractContext()
  // ==========================================================================

  describe('extractContext', () => {
    it('should extract context around a position', () => {
      const text = 'before reference after';
      // "reference" starts at index 7, length 9
      // contextLength=5: startPos = max(0, 7-5) = 2, endPos = min(21, 7+9+5) = 21
      const ctx = service.extractContext(text, 7, 9, 5);
      expect(ctx.contextBefore).toBe('fore ');  // text[2..7]
      expect(ctx.contextAfter).toBe(' afte');   // text[16..21) - 5 chars
      expect(ctx.context).toContain('reference');
    });

    it('should add leading ellipsis when truncated at start', () => {
      const text = 'aaaa bbbb cccc dddd';
      const ctx = service.extractContext(text, 10, 4, 3);
      expect(ctx.context).toMatch(/^\.\.\./);
    });

    it('should add trailing ellipsis when truncated at end', () => {
      const text = 'aaaa bbbb cccc dddd';
      const ctx = service.extractContext(text, 5, 4, 3);
      expect(ctx.context).toMatch(/\.\.\.$/);
    });

    it('should not add ellipsis when context covers full text', () => {
      const text = 'short';
      const ctx = service.extractContext(text, 0, 5, 50);
      expect(ctx.context).toBe('short');
    });
  });

  // ==========================================================================
  // parseReference()
  // ==========================================================================

  describe('parseReference', () => {
    it('should parse a valid reference', () => {
      const result = service.parseReference('John 3:16');
      expect(result).not.toBeNull();
      expect(result!.book).toBe(43);
      expect(result!.chapter).toBe(3);
      expect(result!.verse).toBe(16);
    });

    it('should return null for invalid reference', () => {
      const result = service.parseReference('Not a reference');
      expect(result).toBeNull();
    });

    it('should parse chapter-only reference', () => {
      const result = service.parseReference('Psalm 23');
      expect(result).not.toBeNull();
      expect(result!.book).toBe(19);
      expect(result!.chapter).toBe(23);
    });
  });

  // ==========================================================================
  // toVerseIds()
  // ==========================================================================

  describe('toVerseIds', () => {
    it('should return single ID for single verse', () => {
      const ref: DetectedVerseReference = {
        verseIdStart: 43003016,
        position: 0,
        length: 9,
        referenceText: 'John 3:16',
      };
      expect(service.toVerseIds(ref)).toEqual([43003016]);
    });

    it('should return start and end for range', () => {
      const ref: DetectedVerseReference = {
        verseIdStart: 43003016,
        verseIdEnd: 43003018,
        position: 0,
        length: 12,
        referenceText: 'John 3:16-18',
      };
      expect(service.toVerseIds(ref)).toEqual([43003016, 43003018]);
    });

    it('should return single ID when start equals end', () => {
      const ref: DetectedVerseReference = {
        verseIdStart: 43003016,
        verseIdEnd: 43003016,
        position: 0,
        length: 9,
        referenceText: 'John 3:16',
      };
      expect(service.toVerseIds(ref)).toEqual([43003016]);
    });
  });

  // ==========================================================================
  // formatReference()
  // ==========================================================================

  describe('formatReference', () => {
    it('should format John 3:16 verseId', () => {
      const result = service.formatReference(43003016);
      expect(result).toBe('John 3:16');
    });

    it('should format Genesis 1:1 verseId', () => {
      const result = service.formatReference(1001001);
      expect(result).toBe('Genesis 1:1');
    });

    it('should format Revelation 22:21 verseId', () => {
      const result = service.formatReference(66022021);
      expect(result).toBe('Revelation 22:21');
    });
  });

  // ==========================================================================
  // referencesOverlap()
  // ==========================================================================

  describe('referencesOverlap', () => {
    const makeRef = (start: number, end?: number): DetectedVerseReference => ({
      verseIdStart: start,
      verseIdEnd: end,
      position: 0,
      length: 1,
      referenceText: 'ref',
    });

    it('should detect overlapping ranges', () => {
      const ref1 = makeRef(43003010, 43003020);
      const ref2 = makeRef(43003015, 43003025);
      expect(service.referencesOverlap(ref1, ref2)).toBe(true);
    });

    it('should detect when one range contains the other', () => {
      const ref1 = makeRef(43003010, 43003030);
      const ref2 = makeRef(43003015, 43003020);
      expect(service.referencesOverlap(ref1, ref2)).toBe(true);
    });

    it('should detect non-overlapping ranges', () => {
      const ref1 = makeRef(43003010, 43003015);
      const ref2 = makeRef(43003020, 43003025);
      expect(service.referencesOverlap(ref1, ref2)).toBe(false);
    });

    it('should detect single verse inside range', () => {
      const ref1 = makeRef(43003010, 43003020);
      const ref2 = makeRef(43003015);
      expect(service.referencesOverlap(ref1, ref2)).toBe(true);
    });

    it('should detect identical single verses', () => {
      const ref1 = makeRef(43003016);
      const ref2 = makeRef(43003016);
      expect(service.referencesOverlap(ref1, ref2)).toBe(true);
    });

    it('should detect different single verses as non-overlapping', () => {
      const ref1 = makeRef(43003016);
      const ref2 = makeRef(43003017);
      expect(service.referencesOverlap(ref1, ref2)).toBe(false);
    });
  });

  // ==========================================================================
  // deduplicateReferences()
  // ==========================================================================

  describe('deduplicateReferences', () => {
    const makeRef = (start: number, end: number | undefined, position: number): DetectedVerseReference => ({
      verseIdStart: start,
      verseIdEnd: end,
      position,
      length: 10,
      referenceText: 'ref',
    });

    it('should return empty array for empty input', () => {
      expect(service.deduplicateReferences([])).toEqual([]);
    });

    it('should keep non-overlapping references', () => {
      const refs = [
        makeRef(43003016, undefined, 0),
        makeRef(43004001, undefined, 20),
      ];
      expect(service.deduplicateReferences(refs)).toHaveLength(2);
    });

    it('should remove overlapping references (keeps first by position)', () => {
      const refs = [
        makeRef(43003010, 43003020, 0),  // John 3:10-20
        makeRef(43003015, 43003025, 15), // John 3:15-25 (overlaps)
      ];
      const deduped = service.deduplicateReferences(refs);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].verseIdStart).toBe(43003010);
    });

    it('should handle single reference', () => {
      const refs = [makeRef(43003016, undefined, 0)];
      expect(service.deduplicateReferences(refs)).toHaveLength(1);
    });
  });
});
