import { describe, it, expect } from 'vitest';
import {
  processCommentaryLinks,
  reprocessCommentaryLinks,
  defaultLinkFormatter,
  LinkProcessorContext,
} from './CommentaryLinkProcessor';

/** Helper to create a context for Romans 5 */
function romansContext(overrides: Partial<LinkProcessorContext> = {}): LinkProcessorContext {
  return { bookNumber: 45, chapter: 5, ...overrides };
}

/** Helper to create a context for Matthew 22 */
function matthewContext(overrides: Partial<LinkProcessorContext> = {}): LinkProcessorContext {
  return { bookNumber: 40, chapter: 22, ...overrides };
}

/** The text a reader actually sees - tags stripped, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/** Every anchor in order, as { href, text }. */
function linksIn(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const pattern = /<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    links.push({ href: match[1], text: textOf(match[2]) });
  }
  return links;
}

// ==========================================================================
// processCommentaryLinks() - Full references
// ==========================================================================

describe('processCommentaryLinks - full references', () => {
  it('should link "John 3:16"', () => {
    const result = processCommentaryLinks('See John 3:16 for details', romansContext());
    expect(result).toContain('class="scripture-link"');
    expect(result).toContain('#verse-43003016');
    expect(result).toContain('John 3:16');
  });

  it('should link numbered books like "1 Cor 13:1"', () => {
    const result = processCommentaryLinks('Read 1 Cor 13:1 carefully', romansContext());
    expect(result).toContain('class="scripture-link"');
    // 1 Corinthians = book 46, chapter 13, verse 1 -> 46013001
    expect(result).toContain('46013001');
  });

  it('should link abbreviated book names like "Ro 5:5"', () => {
    const result = processCommentaryLinks('as in Ro 5:5', romansContext());
    expect(result).toContain('class="scripture-link"');
    // Romans = book 45, ch 5, v 5 -> 45005005
    expect(result).toContain('45005005');
  });

  it('should link verse ranges like "Romans 8:28-39"', () => {
    const result = processCommentaryLinks('See Romans 8:28-39', romansContext());
    expect(result).toContain('#verse-45008028-45008039');
  });

  it('should link comma-separated verses like "1Jo 4:9,10,19"', () => {
    const result = processCommentaryLinks('Read 1Jo 4:9,10,19', romansContext());
    // Should produce multiple links separated by commas
    // 1 John = book 62, ch 4
    expect(result).toContain('62004009');
    expect(result).toContain('62004010');
    expect(result).toContain('62004019');
  });

  it('should link cross-chapter comma references like "Jeremiah 7:16, 14:11"', () => {
    const result = processCommentaryLinks('see Jeremiah 7:16, 14:11', romansContext());
    // Jeremiah = book 24, ch 7 v 16 -> 24007016
    expect(result).toContain('24007016');
    // Jeremiah ch 14 v 11 -> 24014011
    expect(result).toContain('24014011');
  });

  it('should link mixed same-chapter and cross-chapter comma refs "Jeremiah 7:16, 14,14:11"', () => {
    const result = processCommentaryLinks('see Jeremiah 7:16, 14,14:11', romansContext());
    // Jer 7:16
    expect(result).toContain('24007016');
    // Jer 7:14 (verse 14 in same chapter)
    expect(result).toContain('24007014');
    // Jer 14:11 (cross-chapter)
    expect(result).toContain('24014011');
  });

  it('should link multiple references in the same text', () => {
    const result = processCommentaryLinks('Compare John 3:16 and Romans 8:28', romansContext());
    expect(result).toContain('43003016'); // John 3:16
    expect(result).toContain('45008028'); // Romans 8:28
  });

  // Every assertion above checks only that the right verse IDs appear somewhere in the
  // HTML, which the duplication bug satisfied: "Rom 2:5,6,11" rendered as one link over
  // the whole string (pointing at verse 5) followed by correct links for 6 and 11, so
  // the reader saw "Rom 2:5,6,11,6,11". These assert the visible text instead.

  it('should not repeat continuation verses in the visible text of a comma list', () => {
    // Real Wesley text for Romans 2:2.
    const result = processCommentaryLinks('making no exception, Rom 2:5,6,11; and', romansContext());
    expect(textOf(result)).toBe('making no exception, Rom 2:5,6,11; and');
  });

  it('should give each verse of a comma list its own target', () => {
    const result = processCommentaryLinks('Rom 2:5,6,11', romansContext());
    expect(linksIn(result)).toEqual([
      { href: '#verse-45002005', text: 'Rom 2:5' },
      { href: '#verse-45002006', text: '6' },
      { href: '#verse-45002011', text: '11' },
    ]);
  });

  it('should keep the source spacing of a comma list', () => {
    const result = processCommentaryLinks('see Jeremiah 7:16, 14:11 also', romansContext());
    expect(textOf(result)).toBe('see Jeremiah 7:16, 14:11 also');
  });

  it('should not repeat continuation verses for ranges inside a comma list', () => {
    const result = processCommentaryLinks('1Jo 4:9,10-12,19', romansContext());
    expect(textOf(result)).toBe('1Jo 4:9,10-12,19');
    expect(linksIn(result)).toEqual([
      { href: '#verse-62004009', text: '1Jo 4:9' },
      { href: '#verse-62004010-62004012', text: '10-12' },
      { href: '#verse-62004019', text: '19' },
    ]);
  });

  it('should leave a single reference exactly as written', () => {
    expect(textOf(processCommentaryLinks('See John 3:16 now', romansContext())))
      .toBe('See John 3:16 now');
    expect(textOf(processCommentaryLinks('See Romans 8:28-39 now', romansContext())))
      .toBe('See Romans 8:28-39 now');
  });

  it('should handle empty input', () => {
    expect(processCommentaryLinks('', romansContext())).toBe('');
  });

  it('should handle text with no references', () => {
    const input = 'This is commentary with no references.';
    const result = processCommentaryLinks(input, romansContext());
    // Should be HTML-escaped but no links
    expect(result).not.toContain('scripture-link');
    expect(result).toContain('This is commentary with no references.');
  });
});

// ==========================================================================
// processCommentaryLinks() - Context-dependent chapter:verse
// ==========================================================================

describe('processCommentaryLinks - context-dependent references', () => {
  it('should link bare "8:9" using context book when matchBareChapterVerse is enabled', () => {
    const result = processCommentaryLinks('also 8:9 is relevant', romansContext({ matchBareChapterVerse: true }));
    expect(result).toContain('class="scripture-link"');
    // Romans 8:9 -> 45008009
    expect(result).toContain('45008009');
  });

  it('should NOT link bare "8:9" when matchBareChapterVerse is off (default)', () => {
    const result = processCommentaryLinks('also 8:9 is relevant', romansContext());
    expect(result).not.toContain('scripture-link');
  });

  it('should link bare "3:16-17" with range using context book when matchBareChapterVerse is enabled', () => {
    const result = processCommentaryLinks('see 3:16-17', matthewContext({ matchBareChapterVerse: true }));
    expect(result).toContain('class="scripture-link"');
    // Matthew 3:16-17
    expect(result).toContain('40003016');
    expect(result).toContain('40003017');
  });

  it('should use line-context book for bare ch:v after a full reference (KAN-34)', () => {
    // "Ro 5:5; 8:9-16" - the "8:9-16" should resolve to Romans, not the global context
    const result = processCommentaryLinks('Ro 5:5; 8:9-16', matthewContext());
    // 8:9 should be Romans (45), not Matthew (40)
    expect(result).toContain('45008009');
  });
});

// ==========================================================================
// processCommentaryLinks() - Bare verse numbers
// ==========================================================================

describe('processCommentaryLinks - bare verse numbers', () => {
  it('should not link bare verse numbers when matchBareVerseNumbers is false (default)', () => {
    const result = processCommentaryLinks('see verse 19 and 38', romansContext());
    // "19" and "38" should NOT be linked as bare numbers by default
    // (though "verse 19" wouldn't match the bare pattern anyway - it has letters)
    expect(result).not.toContain('scripture-link');
  });

  it('should link bare verse numbers when matchBareVerseNumbers is true', () => {
    const ctx = romansContext({ matchBareVerseNumbers: true });
    const result = processCommentaryLinks('19; 38', ctx);
    // Romans 5:19 -> 45005019, Romans 5:38 -> 45005038
    expect(result).toContain('scripture-link');
    expect(result).toContain('45005019');
  });

  it('should skip unreasonable verse numbers (>176)', () => {
    const ctx = romansContext({ matchBareVerseNumbers: true });
    const result = processCommentaryLinks('200', ctx);
    expect(result).not.toContain('scripture-link');
  });
});

// ==========================================================================
// processCommentaryLinks() - HTML handling
// ==========================================================================

describe('processCommentaryLinks - HTML handling', () => {
  it('should strip existing broken anchor tags from TSK data', () => {
    const input = '<a href="broken">John 3:16</a>';
    const result = processCommentaryLinks(input, romansContext());
    // Old anchor stripped, new one created
    expect(result).not.toContain('href="broken"');
    expect(result).toContain('scripture-link');
    expect(result).toContain('43003016');
  });

  it('should preserve non-anchor HTML tags', () => {
    const input = '<b>Bold</b> John 3:16 <i>italic</i>';
    const result = processCommentaryLinks(input, romansContext());
    expect(result).toContain('<b>');
    expect(result).toContain('</b>');
    expect(result).toContain('<i>');
    expect(result).toContain('</i>');
  });

  it('should pass through text without references unchanged', () => {
    const input = 'A < B & C > D';
    const result = processCommentaryLinks(input, romansContext());
    // No references in the input, so text passes through as-is
    expect(result).toBe(input);
  });
});

// ==========================================================================
// reprocessCommentaryLinks()
// ==========================================================================

describe('reprocessCommentaryLinks', () => {
  it('should strip existing links and re-process', () => {
    const input = '<a href="old">John 3:16</a>';
    const result = reprocessCommentaryLinks(input, romansContext());
    expect(result).not.toContain('href="old"');
    expect(result).toContain('scripture-link');
    expect(result).toContain('43003016');
  });

  it('should handle empty input', () => {
    expect(reprocessCommentaryLinks('', romansContext())).toBe('');
  });

  it('should preserve inner text when stripping links', () => {
    const input = 'See <a href="#">this reference John 3:16</a> here';
    const result = reprocessCommentaryLinks(input, romansContext());
    expect(result).toContain('43003016');
  });
});

// ==========================================================================
// defaultLinkFormatter
// ==========================================================================

describe('defaultLinkFormatter', () => {
  it('should produce single-verse anchor', () => {
    const result = defaultLinkFormatter.formatScriptureLink(43003016, null, 'John 3:16');
    expect(result).toBe('<a href="#verse-43003016" class="scripture-link">John 3:16</a>');
  });

  it('should produce range anchor', () => {
    const result = defaultLinkFormatter.formatScriptureLink(43003016, 43003017, 'John 3:16-17');
    expect(result).toBe('<a href="#verse-43003016-43003017" class="scripture-link">John 3:16-17</a>');
  });

  it('should escape HTML in display text', () => {
    const result = defaultLinkFormatter.formatScriptureLink(43003016, null, '<script>alert("x")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

// ==========================================================================
// Custom LinkFormatter
// ==========================================================================

describe('custom LinkFormatter', () => {
  it('should use custom formatter when provided', () => {
    const customFormatter = {
      formatScriptureLink(startVerseId: number, _endVerseId: number | null, displayText: string): string {
        return `[${displayText}](${startVerseId})`;
      },
    };
    const ctx = romansContext({ linkFormatter: customFormatter });
    const result = processCommentaryLinks('John 3:16', ctx);
    expect(result).toContain('[John 3:16](43003016)');
    expect(result).not.toContain('scripture-link');
  });
});
