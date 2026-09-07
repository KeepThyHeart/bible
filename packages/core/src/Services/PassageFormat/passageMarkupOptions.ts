/**
 * Validating a stored passage-markup option record.
 *
 * `resolvePassageMarkupOptions` in `passageMarkup.ts` fills gaps in a
 * *typed* partial - the shape a caller holds in memory. This is the other
 * half: coercing whatever came back out of storage, where the value is
 * `unknown` and may be a stale field, an enum value from a build that offered
 * more of them, an array, or `null`. Every field falls back independently, so
 * a bad value costs the user that one setting rather than their whole setup.
 *
 * It lives in core rather than beside each app's storage code because both
 * apps have to agree on what a valid record is; only the *key* differs.
 */

import { readBooleanField, readEnumField } from './copyOptions';
import {
  DEFAULT_PASSAGE_MARKUP_OPTIONS,
  type HeadingLevel,
  type PassageMarkupFormatId,
  type PassageMarkupOptions,
  type PassageReferencePosition,
  type QuoteMarkStyle,
  type VerseNumberStyle,
} from './passageMarkup';

/** Every value the reference-position control offers, in display order. */
export const PASSAGE_REFERENCE_POSITIONS: readonly PassageReferencePosition[] = [
  'before',
  'after',
  'none',
];

/** Every value the verse-number control offers, in display order. */
export const VERSE_NUMBER_STYLES: readonly VerseNumberStyle[] = [
  'parenthetical',
  'superscript',
  'none',
];

/** Every value the quote-mark control offers, in display order. */
export const QUOTE_MARK_STYLES: readonly QuoteMarkStyle[] = ['double', 'single', 'none'];

/** Every heading level `heading-per-verse` will accept. */
export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];

/**
 * Coerce a stored record into one format's options.
 *
 * @param formatId - whose defaults to fall back on; the four formats
 *   deliberately differ (a plain block quote carries no verse numbers, a
 *   numbered one leads with them).
 * @param source - whatever the app read back, in any state.
 */
export function normalizePassageMarkupOptions(
  formatId: PassageMarkupFormatId,
  source: unknown,
): PassageMarkupOptions {
  const defaults = DEFAULT_PASSAGE_MARKUP_OPTIONS[formatId];
  const stored =
    typeof source === 'object' && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : null;

  return {
    displayVersionNumber: readBooleanField(stored, 'displayVersionNumber', defaults.displayVersionNumber),
    wordsOfChristInRed: readBooleanField(stored, 'wordsOfChristInRed', defaults.wordsOfChristInRed),
    referencePosition: readEnumField(stored, 'referencePosition', PASSAGE_REFERENCE_POSITIONS, defaults.referencePosition),
    verseNumbers: readEnumField(stored, 'verseNumbers', VERSE_NUMBER_STYLES, defaults.verseNumbers),
    headingLevel: readEnumField(stored, 'headingLevel', HEADING_LEVELS, defaults.headingLevel),
    quoteMarks: readEnumField(stored, 'quoteMarks', QUOTE_MARK_STYLES, defaults.quoteMarks),
    commentPlaceholders: readBooleanField(stored, 'commentPlaceholders', defaults.commentPlaceholders),
  };
}
