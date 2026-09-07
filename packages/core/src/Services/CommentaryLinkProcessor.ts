/**
 * Commentary Link Processor (shared, environment-agnostic)
 *
 * Processes commentary text to convert Bible references into clickable links.
 * Works in both browser and server environments (no DOM dependency).
 *
 * Handles:
 * - Full references: "John 3:16", "1 Cor 13:1", "Ro 5:5"
 * - Context-dependent chapter:verse: "8:9-16,26"
 * - Bare verse numbers: "19", "38" (same chapter as the current verse)
 * - Line-context resolution (KAN-34): "Ro 5:5; 8:9-16" -> 8:9 is Romans
 */

import { ReferenceParser } from './ReferenceParser';

const referenceParser = new ReferenceParser();

/**
 * Formats a scripture link for output. The default implementation produces HTML
 * anchor tags, but non-HTML clients (CLI, mobile, Markdown) can provide their own.
 */
export interface LinkFormatter {
  /**
   * Format a link to a single verse or verse range.
   * @param startVerseId - Calculated verse ID for the start of the reference
   * @param endVerseId - Calculated verse ID for the end of a range, or null for single verse
   * @param displayText - Human-readable text for the link (e.g., "John 3:16")
   */
  formatScriptureLink(startVerseId: number, endVerseId: number | null, displayText: string): string;
}

/**
 * Default link formatter that produces HTML anchor tags with fragment hrefs.
 * Output: `<a href="#verse-43003016" class="scripture-link">John 3:16</a>`
 */
export const defaultLinkFormatter: LinkFormatter = {
  formatScriptureLink(startVerseId: number, endVerseId: number | null, displayText: string): string {
    const href = endVerseId ? `#verse-${startVerseId}-${endVerseId}` : `#verse-${startVerseId}`;
    return `<a href="${href}" class="scripture-link">${escapeHtml(displayText)}</a>`;
  }
};

export interface LinkProcessorContext {
  /** Current book number (1-66) for resolving bare chapter:verse references */
  bookNumber: number;
  /** Current chapter number for resolving bare verse-only references like "19" */
  chapter: number;
  /**
   * Enable matching bare chapter:verse patterns (e.g., "8:9", "3:16-17") using the
   * context book when no book name is present on the line. When false, bare ch:v
   * patterns only resolve when preceded by a full reference on the same line.
   * Default: false
   */
  matchBareChapterVerse?: boolean;
  /**
   * Enable matching bare verse numbers (e.g., "19", "38") as same-chapter references.
   * Only appropriate for TSK-style commentaries where standalone numbers are common.
   * Default: false
   */
  matchBareVerseNumbers?: boolean;
  /**
   * Custom link formatter. If not provided, uses the default HTML anchor formatter.
   */
  linkFormatter?: LinkFormatter;
}

interface ReferenceMatch {
  start: number;
  end: number;
  html: string;
  bookNumber?: number; // Track book for line-context resolution
}

/**
 * Process commentary HTML to add clickable verse links.
 *
 * Strips broken/existing anchor tags from TSK data, then re-links all
 * detected Bible references.
 *
 * @param html - Raw HTML content from commentary
 * @param context - Current book/chapter for resolving bare references
 * @returns Processed HTML with references converted to links
 */
export function processCommentaryLinks(html: string, context: LinkProcessorContext): string {
  if (!html) return html;

  // Strip existing/broken anchor tags from TSK data
  let cleaned = html.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '');
  // Remove orphaned "> fragments from broken anchor tags (e.g., `3:4">Tit`)
  cleaned = cleaned.replace(/\d+(?::\d+)?(?:[,-]\d+)*">/g, '');

  // Split into HTML tags vs text segments; only process text segments
  const segments = cleaned.split(/(<[^>]+>)/);
  const result: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith('<')) {
      // HTML tag - pass through
      result.push(segment);
    } else if (segment.length > 0) {
      // Text node - process references
      result.push(processTextSegment(segment, context, context.linkFormatter ?? defaultLinkFormatter));
    }
  }

  return result.join('');
}

/**
 * Process a plain-text segment to find and link Bible references.
 *
 * Uses three patterns:
 * 1. Full references with book name (e.g., "Ro 5:5")
 * 2. Bare chapter:verse (e.g., "8:9-16,26")
 * 3. Bare verse numbers (e.g., "19", "38")
 *
 * Line-context resolution (KAN-34): bare chapter:verse refs use
 * the most recent book name on the same line, falling back to
 * the global context.
 */
function processTextSegment(text: string, context: LinkProcessorContext, formatter: LinkFormatter): string {
  const matches: ReferenceMatch[] = [];
  // Track positions consumed by Pattern 1 (including failed book lookups) so Pattern 2
  // doesn't re-match the chapter:verse portion of "Sirach 11:18-19" or "Nedarim 66:1".
  const consumedRanges: Array<{ start: number; end: number }> = [];

  // Pattern 1: Full references with book name
  // Matches: "John 3:16", "1 Cor 13:1", "1Jo 4:9,10,19", "Ro 5:5", "I John 5:7", "Mt 10:16"
  // Also handles cross-chapter comma refs: "Jeremiah 7:16, 14:11"
  // Also handles abbreviations with trailing period: "2 Tim. 1:7", "Col. 3:16"
  const fullReferencePattern = /\b((?:(?:[123]\s*|I{1,3}\s+)[A-Za-z]+)|[A-Za-z]+)\.?\s+(\d+):(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*(?:\d+:)?\d+(?:\s*[-–]\s*\d+)?)*)\b/g;

  let match;
  while ((match = fullReferencePattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const bookPart = match[1];
    const chapter = parseInt(match[2]);
    const versePart = match[3];
    const startIndex = match.index;

    // Always mark the full match as consumed, even if the book lookup fails.
    // This prevents Pattern 2 from re-matching the chapter:verse portion of
    // non-Bible references like "Sirach 11:18-19" or "Nedarim 66:1".
    consumedRanges.push({ start: startIndex, end: startIndex + fullMatch.length });

    const bookNumber = referenceParser.getBookNumber(bookPart.trim());
    if (!bookNumber) continue;

    const html = buildLinkedReference(bookNumber, chapter, versePart, fullMatch, formatter);
    if (html) {
      matches.push({ start: startIndex, end: startIndex + fullMatch.length, html, bookNumber });
    }
  }

  // Pattern 2: Context-dependent chapter:verse references (no book name)
  // Matches: "1:14,18", "3:16-17", "8:9-16,26", "7:16,14:11"
  const contextReferencePattern = /(?<![A-Za-z])(\d+):(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*(?:\d+:)?\d+(?:\s*[-–]\s*\d+)?)*)\b/g;

  while ((match = contextReferencePattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const chapter = parseInt(match[1]);
    const versePart = match[2];
    const startIndex = match.index;

    if (overlapsExisting(matches, startIndex, fullMatch.length)) continue;

    // KAN-34: Find the most recent book reference on the same line
    const lineBook = resolveLineContextBook(text, startIndex, matches);

    if (lineBook) {
      // Line context takes priority - skip consumed check since the preceding
      // full reference confirms this is a continuation (e.g. "Ro 5:5; 8:9")
    } else if (context.matchBareChapterVerse) {
      // matchBareChapterVerse: allow fallback to global context book even when
      // Pattern 1 consumed the position (e.g. "also 8:9" - "also" isn't a book)
    } else {
      // Default: only link bare ch:v when there's line context, and respect
      // consumed ranges to avoid re-matching "Sirach 11:18"
      if (overlapsConsumed(consumedRanges, startIndex, fullMatch.length)) continue;
      continue; // No line context and option not enabled — skip
    }

    const effectiveBook = lineBook || context.bookNumber;
    if (!effectiveBook) continue;

    const html = buildLinkedReference(effectiveBook, chapter, versePart, null, formatter);
    if (html) {
      matches.push({ start: startIndex, end: startIndex + fullMatch.length, html });
    }
  }

  // Pattern 3: Bare verse numbers (e.g., "19", "38", "23")
  // Only enabled for TSK-style commentaries where standalone numbers are verse refs.
  // Only match numbers preceded by separator context (start of string, semicolon,
  // comma, line break, or whitespace after punctuation) to avoid matching random numbers.
  if (!context.matchBareVerseNumbers) return buildResult(text, matches);
  const bareVersePattern = /(?:^|(?<=;\s*)|(?<=,\s*))(\d{1,3})\b(?!\s*:)(?![-–]\d+:)/g;

  while ((match = bareVersePattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const verseNum = parseInt(match[1]);
    const startIndex = match.index;

    // Skip unreasonable verse numbers (no chapter has 200+ verses)
    if (verseNum < 1 || verseNum > 176) continue;

    if (overlapsExisting(matches, startIndex, fullMatch.length)) continue;

    // Use context book + chapter for bare verse numbers
    const verseId = (context.bookNumber * 1000000) + (context.chapter * 1000) + verseNum;
    const linkHtml = formatter.formatScriptureLink(verseId, null, fullMatch);
    matches.push({ start: startIndex, end: startIndex + fullMatch.length, html: linkHtml });
  }

  return buildResult(text, matches);
}

/** Assemble final HTML from matched references and surrounding text */
function buildResult(text: string, matches: ReferenceMatch[]): string {
  if (matches.length === 0) return escapeHtml(text);

  matches.sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let lastIndex = 0;

  for (const m of matches) {
    if (m.start > lastIndex) {
      parts.push(escapeHtml(text.substring(lastIndex, m.start)));
    }
    parts.push(m.html);
    lastIndex = m.end;
  }

  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.substring(lastIndex)));
  }

  return parts.join('');
}

/** Check if a match position overlaps any existing match */
function overlapsExisting(matches: ReferenceMatch[], start: number, length: number): boolean {
  const end = start + length;
  return matches.some(m =>
    (start >= m.start && start < m.end) ||
    (end > m.start && end <= m.end)
  );
}

/** Check if a position falls within a consumed range (e.g. failed Pattern 1 match) */
function overlapsConsumed(ranges: Array<{ start: number; end: number }>, start: number, length: number): boolean {
  const end = start + length;
  return ranges.some(r =>
    (start >= r.start && start < r.end) ||
    (end > r.start && end <= r.end)
  );
}

/**
 * KAN-34: Find the most recent book reference on the same line before this position
 */
function resolveLineContextBook(text: string, position: number, matches: ReferenceMatch[]): number | null {
  const textBefore = text.substring(0, position);
  const lastNewlineIndex = Math.max(
    textBefore.lastIndexOf('\n'),
    textBefore.lastIndexOf('\r')
  );

  let lineContextBook: number | null = null;
  for (const m of matches) {
    if (m.bookNumber && m.start > lastNewlineIndex && m.end <= position) {
      lineContextBook = m.bookNumber;
    }
  }
  return lineContextBook;
}

/**
 * Build linked HTML for a Bible reference, handling comma-separated verses and ranges.
 *
 * `originalText` is the whole text Pattern 1 matched - e.g. "Rom 2:5,6,11". Only the
 * part of it that precedes `versePart` (the book name and chapter, "Rom 2:") belongs to
 * the first segment; the rest is re-emitted by the later iterations of the loop. Using
 * the whole match as the first link's text duplicated every continuation verse and
 * pointed them all at the first verse ("Rom 2:5,6,11" rendered "Rom 2:5,6,11,6,11").
 *
 * The split keeps its separators so "Jeremiah 7:16, 14:11" comes back out with the
 * spacing the source had, rather than being normalised to a bare comma.
 */
function buildLinkedReference(
  bookNumber: number,
  chapter: number,
  versePart: string,
  originalText: string | null,
  formatter: LinkFormatter
): string | null {
  // Capturing split => [segment, separator, segment, separator, ...].
  const parts = versePart.split(/(\s*,\s*)/);
  const verseSegments: string[] = [];
  const separators: string[] = [];
  for (let p = 0; p < parts.length; p++) {
    if (p % 2 === 0) verseSegments.push(parts[p]);
    else separators.push(parts[p]);
  }

  // Everything in the match ahead of the verse list - the book name and chapter.
  const prefix = originalText && originalText.endsWith(versePart)
    ? originalText.slice(0, originalText.length - versePart.length)
    : null;

  let html = '';
  let emitted = 0;
  let currentChapter = chapter;

  for (let i = 0; i < verseSegments.length; i++) {
    const segment = verseSegments[i].trim();
    let startVerseId: number;
    let endVerseId: number | null;
    let linkText: string;

    // Check for chapter:verse pattern (cross-chapter reference)
    const chapterVerseMatch = segment.match(/^(\d+):(\d+)(?:\s*[-–]\s*(\d+))?$/);
    const rangeMatch = chapterVerseMatch ? null : segment.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);

    if (chapterVerseMatch) {
      currentChapter = parseInt(chapterVerseMatch[1]);
      const startVerse = parseInt(chapterVerseMatch[2]);
      const endVerse = chapterVerseMatch[3] ? parseInt(chapterVerseMatch[3]) : null;
      startVerseId = (bookNumber * 1000000) + (currentChapter * 1000) + startVerse;
      endVerseId = endVerse ? (bookNumber * 1000000) + (currentChapter * 1000) + endVerse : null;
      // Segment 0 carries the book name; later segments already spell out their chapter.
      linkText = i === 0 && prefix ? prefix + segment : segment;
    } else if (rangeMatch) {
      const startVerse = parseInt(rangeMatch[1]);
      const endVerse = rangeMatch[2] ? parseInt(rangeMatch[2]) : null;
      startVerseId = (bookNumber * 1000000) + (currentChapter * 1000) + startVerse;
      endVerseId = endVerse ? (bookNumber * 1000000) + (currentChapter * 1000) + endVerse : null;

      if (i === 0 && prefix) {
        // First segment: prepend the book name and chapter from the original match.
        linkText = prefix + segment;
      } else if (i === 0) {
        // Context-dependent: show as chapter:verse
        linkText = `${currentChapter}:${segment}`;
      } else {
        linkText = segment;
      }
    } else {
      continue;
    }

    if (emitted > 0) html += separators[i - 1] ?? ',';
    html += formatter.formatScriptureLink(startVerseId, endVerseId, linkText);
    emitted++;
  }

  return emitted > 0 ? html : null;
}

/**
 * Remove existing links from commentary content and re-process.
 *
 * Strips all anchor tags (keeping inner text), then runs
 * processCommentaryLinks to re-link valid Bible references.
 *
 * @param html - HTML content potentially containing malformed links
 * @param context - Current book/chapter for resolving bare references
 * @returns Cleaned and re-processed HTML
 */
export function reprocessCommentaryLinks(html: string, context: LinkProcessorContext): string {
  if (!html) return html;
  const stripped = html.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1');
  return processCommentaryLinks(stripped, context);
}

function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
}
