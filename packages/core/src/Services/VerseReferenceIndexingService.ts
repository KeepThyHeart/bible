/**
 * Verse Reference Indexing Service
 *
 * Detects and parses Bible verse references in text content.
 * Used during module import and user content saves to index verse references.
 *
 * Language-configurable: accepts an IReferenceParser and continuation patterns
 * via constructor. English defaults are used when no config is provided.
 * Other Latin-script languages can supply their own book name tables and
 * continuation words (e.g., "versículo" in Spanish) while reusing the same
 * extraction logic. Languages with fundamentally different reference syntax
 * should implement IVerseReferenceIndexingService directly.
 *
 * See docs/queue/languages.md for the full i18n roadmap.
 */

import { IReferenceParser, ReferenceParser, ParsedReference } from './ReferenceParser';
import { VerseIdHelper, VerseId } from '../Data/Core/Types';

/**
 * Detected verse reference with context
 */
export interface DetectedVerseReference {
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  position: number;         // Character position in original text
  length: number;           // Length of matched text
  referenceText: string;    // The matched reference text (e.g., "John 3:16")
  context?: string;         // Surrounding text snippet
  contextBefore?: string;   // Text before the reference
  contextAfter?: string;    // Text after the reference
}

/**
 * Options for extracting verse references
 */
export interface ExtractOptions {
  includeContext?: boolean;       // Whether to extract context snippets
  contextLength?: number;          // Characters before/after for context (default: 50)
  currentBook?: number;            // Current book for continuation references
  currentChapter?: number;         // Current chapter for continuation references
}

/**
 * Interface for verse reference indexing services.
 * Implementations detect and extract Bible verse references from text content.
 * Latin-script languages can reuse VerseReferenceIndexingService with
 * language-specific config; other scripts may need a full implementation.
 */
export interface IVerseReferenceIndexingService {
  extractVerseReferences(content: string, options?: ExtractOptions): DetectedVerseReference[];
  parseReference(referenceText: string): ParsedReference | null;
  extractContext(content: string, position: number, length: number, contextLength?: number): { context: string; contextBefore: string; contextAfter: string };
  toVerseIds(ref: DetectedVerseReference): number[];
  formatReference(verseId: VerseId): string;
  referencesOverlap(ref1: DetectedVerseReference, ref2: DetectedVerseReference): boolean;
  deduplicateReferences(references: DetectedVerseReference[]): DetectedVerseReference[];
}

/**
 * Configuration for VerseReferenceIndexingService.
 * All fields are optional - English defaults are used when omitted.
 */
export interface VerseReferenceIndexingConfig {
  /**
   * Regex pattern for continuation references (e.g., "verse 16", "v. 16", "vs. 16-17").
   * Must have two capture groups: (1) start verse number, (2) optional end verse number.
   * Should use the 'gi' flags.
   */
  continuationPattern?: RegExp;
}

/** English continuation pattern: matches "verse 16", "v. 16", "vs. 16-17" */
export const ENGLISH_CONTINUATION_PATTERN = /\b(?:verse|v\.|vs\.)\s*(\d+)(?:-(\d+))?\b/gi;

/**
 * Service for detecting and extracting verse references from text.
 *
 * Accepts an IReferenceParser for book name resolution and optional
 * language-specific configuration. Falls back to English defaults.
 */
export class VerseReferenceIndexingService implements IVerseReferenceIndexingService {
  private referenceParser: IReferenceParser;
  private continuationPattern: RegExp;

  constructor(referenceParser?: IReferenceParser, config?: VerseReferenceIndexingConfig) {
    this.referenceParser = referenceParser ?? new ReferenceParser();
    this.continuationPattern = config?.continuationPattern ?? ENGLISH_CONTINUATION_PATTERN;
  }

  /**
   * Extract all verse references from text content
   * Returns array of detected references with optional context
   */
  extractVerseReferences(content: string, options: ExtractOptions = {}): DetectedVerseReference[] {
    const {
      includeContext = true,
      contextLength = 50,
      currentBook,
      currentChapter
    } = options;

    const references: DetectedVerseReference[] = [];

    // Pattern 1: Standard references (e.g., "John 3:16", "Romans 8:28-39")
    const standardPattern = /\b([123]?\s*[a-zA-Z]+)\s+(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?\b/g;

    let match: RegExpExecArray | null;

    while ((match = standardPattern.exec(content)) !== null) {
      const fullMatch = match[0];
      const position = match.index;

      // Parse the reference using ReferenceParser
      const parsed = this.referenceParser.parse(fullMatch);

      if (parsed.isValid && parsed.book && parsed.chapter) {
        // Calculate verse IDs
        const startVerse = parsed.verse ?? 1;
        const verseIdStart = VerseIdHelper.calculate(parsed.book, parsed.chapter, startVerse);

        let verseIdEnd: VerseId | undefined;
        if (parsed.endVerse !== undefined) {
          const endChapter = parsed.endChapter ?? parsed.chapter;
          verseIdEnd = VerseIdHelper.calculate(parsed.book, endChapter, parsed.endVerse);
        } else if (parsed.endChapter !== undefined) {
          // Chapter range without specific verse (e.g., "John 3-5")
          // Set to end of end chapter (verse 999 as max placeholder)
          verseIdEnd = VerseIdHelper.calculate(parsed.book, parsed.endChapter, 999);
        }

        const verseRef: DetectedVerseReference = {
          verseIdStart,
          verseIdEnd,
          position,
          length: fullMatch.length,
          referenceText: fullMatch
        };

        // Extract context if requested
        if (includeContext) {
          const contextInfo = this.extractContext(content, position, fullMatch.length, contextLength);
          verseRef.context = contextInfo.context;
          verseRef.contextBefore = contextInfo.contextBefore;
          verseRef.contextAfter = contextInfo.contextAfter;
        }

        references.push(verseRef);
      }
    }

    // Pattern 2: Continuation references (e.g., "verse 16", "v. 16", "vs. 16-17")
    // Only process if we have current book/chapter context
    if (currentBook && currentChapter) {
      // Reset lastIndex for reuse across calls
      this.continuationPattern.lastIndex = 0;

      while ((match = this.continuationPattern.exec(content)) !== null) {
        const fullMatch = match[0];
        const position = match.index;
        const verse = parseInt(match[1]);
        const endVerse = match[2] ? parseInt(match[2]) : undefined;

        const verseIdStart = VerseIdHelper.calculate(currentBook, currentChapter, verse);
        const verseIdEnd = endVerse
          ? VerseIdHelper.calculate(currentBook, currentChapter, endVerse)
          : undefined;

        const verseRef: DetectedVerseReference = {
          verseIdStart,
          verseIdEnd,
          position,
          length: fullMatch.length,
          referenceText: fullMatch
        };

        // Extract context if requested
        if (includeContext) {
          const contextInfo = this.extractContext(content, position, fullMatch.length, contextLength);
          verseRef.context = contextInfo.context;
          verseRef.contextBefore = contextInfo.contextBefore;
          verseRef.contextAfter = contextInfo.contextAfter;
        }

        references.push(verseRef);
      }
    }

    // Sort by position in text
    references.sort((a, b) => a.position - b.position);

    return references;
  }

  /**
   * Parse a single reference string to verse ID(s)
   * Uses existing ReferenceParser
   */
  parseReference(referenceText: string): ParsedReference | null {
    const parsed = this.referenceParser.parse(referenceText);
    return parsed.isValid ? parsed : null;
  }

  /**
   * Extract surrounding context for a reference position
   * Returns +/-contextLength characters around the reference
   */
  extractContext(
    content: string,
    position: number,
    length: number,
    contextLength: number = 50
  ): {
    context: string;
    contextBefore: string;
    contextAfter: string;
  } {
    // Calculate boundaries
    const startPos = Math.max(0, position - contextLength);
    const endPos = Math.min(content.length, position + length + contextLength);

    // Extract context segments
    const contextBefore = content.substring(startPos, position);
    const referenceText = content.substring(position, position + length);
    const contextAfter = content.substring(position + length, endPos);

    // Build full context
    let context = contextBefore + referenceText + contextAfter;

    // Add ellipsis if truncated
    if (startPos > 0) {
      context = '...' + context;
    }
    if (endPos < content.length) {
      context = context + '...';
    }

    return {
      context,
      contextBefore,
      contextAfter
    };
  }

  /**
   * Convert a DetectedVerseReference to verse ID(s)
   * Useful for database queries
   */
  toVerseIds(ref: DetectedVerseReference): number[] {
    if (!ref.verseIdEnd || ref.verseIdEnd === ref.verseIdStart) {
      return [ref.verseIdStart];
    }

    // For ranges, return both start and end
    // Note: For actual verse-by-verse iteration, use a separate utility
    return [ref.verseIdStart, ref.verseIdEnd];
  }

  /**
   * Format a verse reference for display
   */
  formatReference(verseId: VerseId): string {
    const parsed = VerseIdHelper.parse(verseId);
    const bookName = this.referenceParser.getBookName(parsed.bookNumber);
    return `${bookName} ${parsed.chapter}:${parsed.verse}`;
  }

  /**
   * Check if two references overlap
   */
  referencesOverlap(ref1: DetectedVerseReference, ref2: DetectedVerseReference): boolean {
    const ref1End = ref1.verseIdEnd ?? ref1.verseIdStart;
    const ref2End = ref2.verseIdEnd ?? ref2.verseIdStart;

    return !(ref1End < ref2.verseIdStart || ref2End < ref1.verseIdStart);
  }

  /**
   * Deduplicate overlapping references
   * Keeps the longer/more specific reference
   */
  deduplicateReferences(references: DetectedVerseReference[]): DetectedVerseReference[] {
    if (references.length === 0) return [];

    const sorted = [...references].sort((a, b) => a.position - b.position);
    const deduplicated: DetectedVerseReference[] = [];

    for (const ref of sorted) {
      // Check if this reference overlaps with any already added
      const overlaps = deduplicated.some(existing =>
        this.referencesOverlap(ref, existing)
      );

      if (!overlaps) {
        deduplicated.push(ref);
      }
    }

    return deduplicated;
  }
}
