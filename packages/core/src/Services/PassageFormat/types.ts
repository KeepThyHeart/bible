/**
 * The vocabulary every passage format speaks.
 *
 * `PassageVerse` is deliberately *not* the `BibleVerse` model from the Data
 * layer: the format engine only ever needs the handful of fields a rendered
 * passage is built from, and tying it to the persistence model would drag a
 * class (and its constructor, and its metadata column) into a browser bundle
 * that has no database behind it. The desktop app has re-exported this shape
 * as `BibleVerse` since before the engine moved into core; the two names refer
 * to the same structural type and nothing else.
 */

import type { CopyFormatSettings } from './settings';

/** One verse, as much of it as any format needs. */
export interface PassageVerse {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html?: string;
  is_paragraph_start?: boolean;
}

export interface VerseContext {
  bookName: string;
  /** Abbreviated book name (e.g., "Jn", "Gen"). Falls back to first 3 chars of bookName if not provided. */
  bookAbbreviation?: string;
  chapter: number;
  translation: string;
}

/**
 * The two flags every format understands.
 *
 * Kept to two on purpose: this record is serialised into note content by the
 * desktop app's verse-expansion mark, so anything added here is added to every
 * saved note. Shape controls live in `AdvancedCopyOptions` and
 * `PassageMarkupShapeOptions` instead.
 */
export interface FormatOptions {
  /** Display the version/translation abbreviation (e.g., KJV) */
  displayVersionNumber: boolean;

  /** Preserve Words of Christ in red formatting (if available in source) */
  wordsOfChristInRed: boolean;
}

/**
 * Interface for a copy format template
 */
export interface CopyFormat {
  /** Unique identifier for this format */
  id: string;

  /**
   * English display name.
   *
   * A fallback, not the label to render: the app resolves
   * `copyOptionsDialog.format.<id>.name` from its own locale catalog first.
   * Core owns ids and key names, never translated copy.
   */
  name: string;

  /** Short English description; see {@link CopyFormat.name}. */
  description: string;

  /**
   * Format verses according to this template
   *
   * @param verses - Single verse or array of verses to format
   * @param context - Context information (book name, chapter, translation)
   * @param options - Formatting options
   * @param settings - Stored per-format state; defaults when omitted
   * @returns Formatted text ready for copying
   */
  format(
    verses: PassageVerse | PassageVerse[],
    context: VerseContext,
    options: FormatOptions,
    settings?: CopyFormatSettings
  ): string;

  /**
   * Generate a preview of this format for the format selector
   *
   * @param verses - Single verse or array of verses to preview
   * @param context - Context information
   * @param options - Formatting options
   * @param settings - Stored per-format state; defaults when omitted
   * @returns Preview text (may be truncated)
   */
  preview(
    verses: PassageVerse | PassageVerse[],
    context: VerseContext,
    options: FormatOptions,
    settings?: CopyFormatSettings
  ): string;
}

/**
 * Default format options
 */
export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  displayVersionNumber: true,
  wordsOfChristInRed: true
};
