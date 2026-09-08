/**
 * Unit tests for Commentary Link Processor
 *
 * Tests the functionality of converting Bible references in commentary text
 * into clickable links.
 */
import { describe, it, expect } from 'vitest';
import { processCommentaryLinks, reprocessCommentaryLinks } from './commentaryLinkProcessor';

describe('commentaryLinkProcessor', () => {
  describe('processCommentaryLinks', () => {
    it('should return empty/null content unchanged', () => {
      expect(processCommentaryLinks('')).toBe('');
      expect(processCommentaryLinks(null as unknown as string)).toBe(null);
    });

    it('should convert a single reference to a link', () => {
      const input = 'See John 3:16 for more information.';
      const result = processCommentaryLinks(input);

      expect(result).toContain('<a href="#verse-43003016"');
      expect(result).toContain('class="scripture-link"');
      expect(result).toContain('John 3:16</a>');
    });

    it('should convert multiple references in the same text', () => {
      const input = 'Compare Genesis 1:1 with John 1:1';
      const result = processCommentaryLinks(input);

      // Should have two separate links
      expect(result).toContain('<a href="#verse-1001001"');
      expect(result).toContain('Genesis 1:1</a>');
      expect(result).toContain('<a href="#verse-43001001"');
      expect(result).toContain('John 1:1</a>');
    });

    it('should handle semicolon-separated references as separate links', () => {
      // This is the critical bug - semicolon-separated references should NOT
      // become one big link, but should be separate clickable links
      const input = 'See Rom 8:28; Gen 1:1; John 1:1 for context.';
      const result = processCommentaryLinks(input);

      // Count the number of links - should be 3 separate links
      const linkMatches = result.match(/<a[^>]*class="scripture-link"[^>]*>/g);
      expect(linkMatches).not.toBeNull();
      expect(linkMatches?.length).toBe(3);

      // Each reference should be its own link
      expect(result).toContain('Rom 8:28</a>');
      expect(result).toContain('Gen 1:1</a>');
      expect(result).toContain('John 1:1</a>');

      // The semicolons should be OUTSIDE the links
      expect(result).toMatch(/Rom 8:28<\/a>;\s*<a/);
      expect(result).toMatch(/Gen 1:1<\/a>;\s*<a/);
    });

    it('should handle comma-separated references as separate links', () => {
      const input = 'See Rom 8:28, Gen 1:1, John 1:1 for context.';
      const result = processCommentaryLinks(input);

      const linkMatches = result.match(/<a[^>]*class="scripture-link"[^>]*>/g);
      expect(linkMatches?.length).toBe(3);
    });

    it('should handle verse ranges', () => {
      const input = 'Read Romans 8:28-30 for the full context.';
      const result = processCommentaryLinks(input);

      // KAN-34: Range hrefs now include both start and end verse IDs
      expect(result).toContain('<a href="#verse-45008028-45008030"');
      expect(result).toContain('Romans 8:28-30</a>');
    });

    it('should handle numbered books correctly', () => {
      const input = 'See 1 Corinthians 13:1 and 2 Timothy 3:16';
      const result = processCommentaryLinks(input);

      expect(result).toContain('1 Corinthians 13:1</a>');
      expect(result).toContain('2 Timothy 3:16</a>');
    });

    it('should not link invalid references', () => {
      const input = 'The phrase "chapter 3:16" is not a valid reference.';
      const result = processCommentaryLinks(input);

      // Should not contain any scripture links
      expect(result).not.toContain('scripture-link');
    });

    it('should not double-link existing links', () => {
      const input = 'Already linked: <a href="#verse-43003016">John 3:16</a>';
      const result = processCommentaryLinks(input);

      // Should have exactly one link, not nested
      const linkMatches = result.match(/<a[^>]*>/g);
      expect(linkMatches?.length).toBe(1);
    });

    it('should preserve HTML structure around references', () => {
      const input = '<p>See <strong>John 3:16</strong> for the verse.</p>';
      const result = processCommentaryLinks(input);

      // The link should be inside the strong tag
      expect(result).toContain('<strong>');
      expect(result).toContain('</strong>');
      expect(result).toContain('scripture-link');
    });

    it('should escape HTML in non-reference text', () => {
      const input = 'John 3:16 says "God so loved" & more.';
      const result = processCommentaryLinks(input);

      expect(result).toContain('&amp;');
    });

    it('should use line context for chapter:verse references (KAN-34)', () => {
      // When "Ro 5:5; 8:9-16,26; 1Co 3:16" appears on a line,
      // the "8:9-16" should use Romans (from the same line), not fall back
      // to the global context book
      const input = 'Ro 5:5; 8:9-16,26; 1Co 3:16';
      const result = processCommentaryLinks(input, 50); // 50 = Philippians (global context)

      // Ro 5:5 -> Romans 45005005
      expect(result).toContain('<a href="#verse-45005005"');
      expect(result).toContain('Ro 5:5</a>');

      // 8:9-16 should be Romans 8:9-16 (45008009-45008016), not Philippians 8:9-16
      // KAN-34: Range hrefs now include both start and end verse IDs
      expect(result).toContain('<a href="#verse-45008009-45008016"');
      expect(result).toContain('8:9-16</a>');

      // 26 should be Romans 8:26 (same line context)
      expect(result).toContain('<a href="#verse-45008026"');

      // 1Co 3:16 -> 1 Corinthians 46003016
      expect(result).toContain('<a href="#verse-46003016"');
    });

    it('should use global context when no book on same line (KAN-34)', () => {
      // When only chapter:verse appears without a book on the same line,
      // fall back to the global context
      const input = '1:14,18';
      const result = processCommentaryLinks(input, 43); // 43 = John (global context)

      // 1:14 should use John (global context) -> 43001014
      expect(result).toContain('<a href="#verse-43001014"');
      // 18 should use John 1:18 -> 43001018
      expect(result).toContain('<a href="#verse-43001018"');
    });
  });

  describe('reprocessCommentaryLinks', () => {
    it('should remove existing broken links and re-link correctly', () => {
      // Simulate the bug: one big link for multiple references
      const brokenInput = '<a href="#broken">Rom 8:28; Gen 1:1; John 1:1</a>';
      const result = reprocessCommentaryLinks(brokenInput);

      // Should now have 3 separate links
      const linkMatches = result.match(/<a[^>]*class="scripture-link"[^>]*>/g);
      expect(linkMatches?.length).toBe(3);
    });

    it('should handle content with no links', () => {
      const input = 'Plain text with John 3:16 reference.';
      const result = reprocessCommentaryLinks(input);

      expect(result).toContain('scripture-link');
      expect(result).toContain('John 3:16</a>');
    });
  });
});
