/**
 * The text beside a verse in the Bible pane: just the number (default), `chapter:verse`, or an
 * abbreviated `Book chapter:verse`. Pure, so the standard, study and parallel surfaces share one rule.
 */
import type { Localizer } from '@bible/core';
import type { VerseLabelMode } from '../stores/usePreferencesStore';

/** Abbreviated book names (index = book number - 1) in the locale, English where the locale has none. */
export function shortBookName(localizer: Localizer | undefined, book: number): string {
  const cfg = localizer?.referenceParserConfig;
  return cfg?.shortNames?.[book - 1] ?? cfg?.displayNames?.[book - 1] ?? `Book ${book}`;
}

export function verseLabelText(
  mode: VerseLabelMode,
  verse: { book: number; chapter: number; verse: number },
  localizer: Localizer | undefined,
): string {
  switch (mode) {
    case 'chapterVerse':
      return `${verse.chapter}:${verse.verse}`;
    case 'bookChapterVerse':
      return `${shortBookName(localizer, verse.book)} ${verse.chapter}:${verse.verse}`;
    case 'number':
    default:
      return String(verse.verse);
  }
}

export type VerseLabelSurface = 'standard' | 'study' | 'parallel';

/**
 * Width and alignment of the label column.
 *
 * Verse numbers keep a fixed, right-aligned gutter, so 9 and 10 line up on their last digit. The
 * reference styles (`3:16`, `Jn 3:16`) are left-aligned and only as wide as the widest label on
 * screen: `useVerseLabelWidth` measures the labels and publishes `--verse-label-width` (the label
 * itself; the padding is added here), so the verse text of every row in a chapter still starts
 * at the same edge. The em fallback only shows for the instant before the first measurement.
 * Literal class names so Tailwind sees them.
 */
// Reference labels get a little room at the start edge so they do not sit on the column edge, and
// `Jn 3:16` a wider gap before the text than `3:16`, since a word plus a number reads as part of the
// verse otherwise. The width is the measured label plus exactly that padding (border-box).
const CHAPTER_VERSE = 'w-[calc(var(--verse-label-width,3em)_+_0.875rem)] ps-1.5 pe-2 whitespace-nowrap text-start';
const BOOK_CHAPTER_VERSE = 'w-[calc(var(--verse-label-width,5em)_+_1.125rem)] ps-1.5 pe-3 whitespace-nowrap text-start';
const GUTTER: Record<VerseLabelSurface, Record<VerseLabelMode, string>> = {
  standard: { number: 'w-11 pe-2 text-end', chapterVerse: CHAPTER_VERSE, bookChapterVerse: BOOK_CHAPTER_VERSE },
  study: { number: 'w-10 pe-2 text-end', chapterVerse: CHAPTER_VERSE, bookChapterVerse: BOOK_CHAPTER_VERSE },
  parallel: { number: 'w-9 pe-2 text-end', chapterVerse: CHAPTER_VERSE, bookChapterVerse: BOOK_CHAPTER_VERSE },
};

/** Width and alignment classes for the label column; the label element inside carries `data-verse-label`. */
export function verseGutterClass(mode: VerseLabelMode, surface: VerseLabelSurface): string {
  return GUTTER[surface][mode] ?? GUTTER[surface].number;
}
