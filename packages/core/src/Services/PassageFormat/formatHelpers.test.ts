import { describe, it, expect } from 'vitest';
import { getVerseTextWithRed, stripHtml, getCleanVerseText, buildReference, truncateForPreview } from './formatHelpers';
import { PassageVerse, VerseContext } from './types';

describe('formatHelpers', () => {
  describe('stripHtml', () => {
    it('should remove HTML tags', () => {
      expect(stripHtml('<b>bold</b> text')).toBe('bold text');
    });

    it('should handle nested tags', () => {
      expect(stripHtml('<div><span>nested</span></div>')).toBe('nested');
    });

    it('should collapse whitespace', () => {
      expect(stripHtml('  multiple   spaces  ')).toBe('multiple spaces');
    });

    it('should remove paragraph markers', () => {
      expect(stripHtml('¶ For God so loved the world')).toBe('For God so loved the world');
    });

    it('should not leave a double space where a paragraph marker was removed', () => {
      expect(stripHtml('one ¶ two')).toBe('one two');
    });
  });

  describe('getVerseTextWithRed (KAN-47)', () => {
    it('should convert christ-words class spans to inline red style', () => {
      const verse: PassageVerse = {
        verse_id: 43003016,
        book_number: 43,
        chapter: 3,
        verse: 16,
        text: 'For God so loved the world',
        text_html: 'For God so loved the world, that he gave his only begotten Son, that whosoever <span class="christ-words">believeth in him should not perish</span>, but have everlasting life.',
      };

      const result = getVerseTextWithRed(verse);
      expect(result).toContain('style="color: #B71C1C;"');
      expect(result).toContain('believeth in him should not perish');
      expect(result).not.toContain('class="christ-words"');
    });

    it('should handle case-insensitive christ-words class', () => {
      const verse: PassageVerse = {
        verse_id: 1001001,
        book_number: 1,
        chapter: 1,
        verse: 1,
        text: 'test',
        text_html: '<span CLASS="Christ-Words">test words</span>',
      };

      const result = getVerseTextWithRed(verse);
      expect(result).toContain('style="color: #B71C1C;"');
    });

    it('should convert legacy font red tags to inline style', () => {
      const verse: PassageVerse = {
        verse_id: 1001001,
        book_number: 1,
        chapter: 1,
        verse: 1,
        text: 'test',
        text_html: '<font color="red">red text</font>',
      };

      const result = getVerseTextWithRed(verse);
      expect(result).toContain('style="color: #B71C1C;"');
      expect(result).toContain('red text');
    });

    it('should handle text without red letter markup', () => {
      const verse: PassageVerse = {
        verse_id: 1001001,
        book_number: 1,
        chapter: 1,
        verse: 1,
        text: 'In the beginning God created the heaven and the earth.',
        text_html: 'In the beginning God created the heaven and the earth.',
      };

      const result = getVerseTextWithRed(verse);
      expect(result).not.toContain('color');
      expect(result).toContain('In the beginning');
    });

    it('should fall back to text field when text_html is missing', () => {
      const verse: PassageVerse = {
        verse_id: 1001001,
        book_number: 1,
        chapter: 1,
        verse: 1,
        text: 'plain text only',
      };

      const result = getVerseTextWithRed(verse);
      expect(result).toBe('plain text only');
    });

    it('should remove paragraph markers, matching getCleanVerseText', () => {
      // The red-letter toggle must not decide whether a pilcrow appears: these
      // two extraction paths read different source fields, so both have to strip.
      const verse: PassageVerse = {
        verse_id: 43003016,
        book_number: 43,
        chapter: 3,
        verse: 16,
        text: '¶ For God so loved the world',
        text_html: '¶ For God so loved the <span class="christ-words">world</span>',
      };

      expect(getVerseTextWithRed(verse)).not.toContain('¶');
      expect(getCleanVerseText(verse)).not.toContain('¶');
      expect(getVerseTextWithRed(verse)).toContain('style="color: #B71C1C;"');
    });
  });

  describe('getCleanVerseText', () => {
    it('should strip HTML from text field', () => {
      const verse: PassageVerse = {
        verse_id: 1001001,
        book_number: 1,
        chapter: 1,
        verse: 1,
        text: '<b>In</b> the beginning',
      };
      expect(getCleanVerseText(verse)).toBe('In the beginning');
    });
  });

  describe('buildReference', () => {
    const context: VerseContext = {
      bookName: 'John',
      chapter: 3,
      translation: 'KJV',
    };

    it('should build single verse reference', () => {
      const verses: PassageVerse[] = [{
        verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: '',
      }];
      expect(buildReference(verses, context, true)).toBe('John 3:16 (KJV)');
    });

    it('should build verse range reference', () => {
      const verses: PassageVerse[] = [
        { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: '' },
        { verse_id: 43003017, book_number: 43, chapter: 3, verse: 17, text: '' },
      ];
      expect(buildReference(verses, context, true)).toBe('John 3:16-17 (KJV)');
    });

    it('should omit translation when not requested', () => {
      const verses: PassageVerse[] = [{
        verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: '',
      }];
      expect(buildReference(verses, context, false)).toBe('John 3:16');
    });

    it('should return empty string for empty verses array', () => {
      expect(buildReference([], context, true)).toBe('');
    });

    it('should append the version with a comma in "appended" style', () => {
      // Combined/Inline wrap the reference in parentheses themselves, so the
      // version must not bring its own pair: "(John 3:16, KJV)", never
      // "(John 3:16 (KJV))".
      const verses: PassageVerse[] = [{
        verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: '',
      }];
      expect(buildReference(verses, context, true, 'appended')).toBe('John 3:16, KJV');
    });

    it('should omit the version in "appended" style when not requested', () => {
      const verses: PassageVerse[] = [{
        verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: '',
      }];
      expect(buildReference(verses, context, false, 'appended')).toBe('John 3:16');
    });
  });

  describe('truncateForPreview', () => {
    it('should not truncate short text', () => {
      expect(truncateForPreview('short', 100)).toBe('short');
    });

    it('should truncate long text with ellipsis', () => {
      const long = 'a'.repeat(200);
      const result = truncateForPreview(long, 50);
      expect(result.length).toBe(53); // 50 + '...'
      expect(result.endsWith('...')).toBe(true);
    });
  });
});
