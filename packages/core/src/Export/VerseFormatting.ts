/**
 * The exporter's view of the `bible_verse.formatting` payload.
 *
 * The canonical declarations live in `packages/core/src/Data/Text/` and are
 * re-exported here so that everything the exporter needs can be imported from
 * one place. This module owns no duplicate definitions - only the one heading
 * extension described below.
 */

export type {
  PoetryLevel,
  PoetryLine,
  VerseBlock,
  VerseFormatting,
  VerseSpan,
  VerseSpanType
} from '../Data/Text/VerseFormatting';

export {
  BLOCK_USFM,
  SPAN_TYPE_USFM,
  VERSE_FORMATTING_VERSION,
  VERSE_SPAN_TYPES,
  isVerseSpanType,
  splitVerseWords
} from '../Data/Text/VerseFormatting';

import type { VerseBlock } from '../Data/Text/VerseFormatting';

/**
 * Whether a `block.heading` is an editorial section heading or a canonical
 * superscription.
 *
 * - `section` - USFM `\s`, e.g. "The Beatitudes". The default.
 * - `psalm_title` - USFM `\d`, e.g. "A Psalm of David"; part of the text itself.
 *
 * USFM needs the distinction (the two markers render and validate differently),
 * but the canonical {@link VerseBlock} carries a single `heading` field with no
 * qualifier. Producers that know the difference MAY record it as a `heading_kind`
 * property alongside `heading`; the exporter reads it when present and assumes
 * `section` when absent.
 */
export type HeadingKind = 'section' | 'psalm_title';

/** A {@link VerseBlock} that additionally records the heading's kind. */
export interface VerseBlockWithHeadingKind extends VerseBlock {
  readonly heading_kind?: HeadingKind;
}

/**
 * Read the optional heading kind off a block without widening its type.
 * Returns `'section'` when the property is absent or unrecognized.
 */
export function readHeadingKind(block: VerseBlock | undefined): HeadingKind {
  if (block === undefined) {
    return 'section';
  }
  const value = (block as Record<string, unknown>)['heading_kind'];
  return value === 'psalm_title' ? 'psalm_title' : 'section';
}
