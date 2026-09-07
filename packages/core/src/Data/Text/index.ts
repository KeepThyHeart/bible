/**
 * Text normalization.
 *
 * Interfaces and types are exported before implementations, per the data-layer
 * convention in `packages/core/src/Data/README.md`.
 */

export type {
  LegacyFormattingData,
  LegacyFormattingRange,
  PoetryLevel,
  PoetryLine,
  VerseBlock,
  VerseFormatting,
  VerseSpan,
  VerseSpanType,
} from './VerseFormatting';

export {
  BLOCK_USFM,
  SPAN_TYPE_USFM,
  VERSE_FORMATTING_VERSION,
  VERSE_SPAN_TYPES,
  buildVerseFormatting,
  createEmptyVerseFormatting,
  isEmptyVerseFormatting,
  isVerseSpanType,
  parseVerseFormatting,
  splitVerseWords,
  stringifyVerseFormatting,
} from './VerseFormatting';

export type { LegacyFormattingInput, NormalizedVerse } from './normalizeVerseText';

export { mergeSpans, normalizeVerseText } from './normalizeVerseText';
