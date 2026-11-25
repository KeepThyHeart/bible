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
 * Gutter width for the label column. Fixed per mode (not content-sized) so the verse text of every row
 * in a chapter starts at the same edge. Literal class names so Tailwind sees them.
 */
const GUTTER: Record<VerseLabelSurface, Record<VerseLabelMode, string>> = {
  standard: { number: 'w-11', chapterVerse: 'w-[5em] whitespace-nowrap', bookChapterVerse: 'w-[8.5em] whitespace-nowrap' },
  study: { number: 'w-10', chapterVerse: 'w-[5em] whitespace-nowrap', bookChapterVerse: 'w-[8.5em] whitespace-nowrap' },
  parallel: { number: 'w-9', chapterVerse: 'w-[4.5em] whitespace-nowrap', bookChapterVerse: 'w-[8em] whitespace-nowrap' },
};

export function verseGutterClass(mode: VerseLabelMode, surface: VerseLabelSurface): string {
  return GUTTER[surface][mode] ?? GUTTER[surface].number;
}
