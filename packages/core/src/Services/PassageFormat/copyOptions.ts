/**
 * Advanced copy options - the shared shape controls behind the copy dialog's
 * "Advanced Options" section.
 *
 * These used to belong to a single "Advanced" *format*. They are now the option
 * set for **Standard** and **Combined** alike: one record, and a format decides
 * which of the options it honours (see `passageCopyRenderer.ts`). The third
 * format, Custom Template, is fully user-controlled and ignores them entirely.
 *
 * They deliberately live *outside* `FormatOptions`. `FormatOptions` is the
 * two-flag set every format understands (translation label, red letter), and it
 * is serialised into note content by the desktop app's verse-expansion mark -
 * widening it would push a blob of shape settings into every saved `.bn` file.
 *
 * **Persistence is the app's, the validation is core's.** Where these are kept
 * differs per app (a localStorage key in the desktop renderer, another in the
 * web client), so reading and writing them stays there;
 * {@link normalizeAdvancedCopyOptions} is the shared half - the per-field
 * fallback that makes a malformed blob, a stale field or an unknown enum value
 * cost the user that one setting rather than all of them.
 */

/** Where the passage reference is placed relative to the text. */
export type ReferencePosition = 'beginning' | 'end' | 'none';

/**
 * How the Standard format presents the passage body.
 *
 * - `blockquote` - set off from the reference above it, as `> ` lines in
 *   Markdown and as an indented block in plain text.
 * - `inline` - the bare text, with nothing wrapped around it.
 */
export type VerseTextFormat = 'blockquote' | 'inline';

export interface AdvancedCopyOptions {
  /** Each verse starts on its own line. **Standard only.** */
  newLinePerVerse: boolean;
  /** How the Standard format presents the passage body. **Standard only.** */
  textFormat: VerseTextFormat;
  /** Blank line wherever the source marks a new paragraph. **Combined only.** */
  paragraphBreaks: boolean;
  /** Prefix each verse with its number, e.g. "(16)". */
  includeVerseNumbers: boolean;
  /** "Chapter N" heading at each chapter boundary (multi-chapter passages only). */
  includeChapterHeadings: boolean;
  /** Reference before the text, after it, or omitted. */
  referencePosition: ReferencePosition;
  /**
   * Emit Markdown for the *structural* pieces - block quotes as `> ` lines,
   * chapter headings as `###`. Verse text passes through untouched: Scripture
   * contains no `*` or `_`, and escaping it would mangle the common case to
   * guard against one that does not arise.
   */
  markdown: boolean;
}

export const DEFAULT_ADVANCED_COPY_OPTIONS: AdvancedCopyOptions = {
  newLinePerVerse: true,
  textFormat: 'blockquote',
  paragraphBreaks: false,
  includeVerseNumbers: true,
  includeChapterHeadings: true,
  referencePosition: 'beginning',
  markdown: false,
};

/** Every value the reference-position control offers, in display order. */
export const REFERENCE_POSITIONS: readonly ReferencePosition[] = ['beginning', 'end', 'none'];

/** Every value the body-format control offers, in display order. */
export const VERSE_TEXT_FORMATS: readonly VerseTextFormat[] = ['blockquote', 'inline'];

/** Read one boolean field, falling back on anything that is not a boolean. */
export function readBooleanField(
  source: Record<string, unknown> | null | undefined,
  field: string,
  fallback: boolean,
): boolean {
  const value = source?.[field];
  return typeof value === 'boolean' ? value : fallback;
}

/** Read one enumerated field, falling back on anything not in `allowed`. */
export function readEnumField<T>(
  source: Record<string, unknown> | null | undefined,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = source?.[field];
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Coerce anything at all into a usable option record.
 *
 * Every field falls back independently, so one bad value cannot discard the
 * rest of the user's settings. Pass whatever `JSON.parse` produced - including
 * `null`, an array, or a number; all of them read as "nothing stored".
 */
export function normalizeAdvancedCopyOptions(source: unknown): AdvancedCopyOptions {
  const stored =
    typeof source === 'object' && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : null;

  return {
    newLinePerVerse: readBooleanField(stored, 'newLinePerVerse', DEFAULT_ADVANCED_COPY_OPTIONS.newLinePerVerse),
    textFormat: readEnumField(stored, 'textFormat', VERSE_TEXT_FORMATS, DEFAULT_ADVANCED_COPY_OPTIONS.textFormat),
    paragraphBreaks: readBooleanField(stored, 'paragraphBreaks', DEFAULT_ADVANCED_COPY_OPTIONS.paragraphBreaks),
    includeVerseNumbers: readBooleanField(stored, 'includeVerseNumbers', DEFAULT_ADVANCED_COPY_OPTIONS.includeVerseNumbers),
    includeChapterHeadings: readBooleanField(stored, 'includeChapterHeadings', DEFAULT_ADVANCED_COPY_OPTIONS.includeChapterHeadings),
    referencePosition: readEnumField(stored, 'referencePosition', REFERENCE_POSITIONS, DEFAULT_ADVANCED_COPY_OPTIONS.referencePosition),
    markdown: readBooleanField(stored, 'markdown', DEFAULT_ADVANCED_COPY_OPTIONS.markdown),
  };
}
