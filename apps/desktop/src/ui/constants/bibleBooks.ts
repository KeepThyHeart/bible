/**
 * Book constants for the desktop UI.
 *
 * The book names and parse aliases come from `@bible/core` (Data/Core/BookNames),
 * which is the single source of truth for the repo - a local 66-book table
 * and alias map here would drift out of step with core's 385. The chapter
 * counts and the OT/NT lists also come from core; the search ranges below
 * are genuinely desktop-specific and stay here.
 */
import { LONG_NAMES, ENGLISH_BOOK_NAMES } from '@bible/core';
import type { Localizer } from '@bible/core';

/** Full English book names, indexed by book number 1-66. */
export const BOOK_NAMES: Record<number, string> = LONG_NAMES;

/**
 * Book name/abbreviation -> book number, for the picker's typeahead.
 * Derived from core's alias table so the picker accepts everything the
 * reference parser does.
 */
export const BOOK_ALIASES: Record<string, number> = Object.fromEntries(ENGLISH_BOOK_NAMES);

/**
 * Locale-aware book display names, from the active locale's Localizer. Falls
 * back to English wherever a language has no referenceParserConfig yet (i.e.
 * today, every language but `en`).
 */
export function localizedBookNames(localizer: Localizer): Record<number, string> {
  const names = localizer.referenceParserConfig?.displayNames;
  if (!names) return BOOK_NAMES;
  const out: Record<number, string> = {};
  names.forEach((name, i) => { out[i + 1] = name; });
  return out;
}

/**
 * Locale-aware parsing aliases. English aliases are always merged in
 * underneath, so English input keeps parsing even in a non-English UI locale
 * (per this project's "English is always an accepted parse input" rule).
 */
export function localizedBookAliases(localizer: Localizer): Record<string, number> {
  const aliases = localizer.referenceParserConfig?.bookNames;
  if (!aliases) return BOOK_ALIASES;
  return { ...BOOK_ALIASES, ...Object.fromEntries(aliases) };
}

export function localizedAllBooks(localizer: Localizer): Array<{ number: number; name: string }> {
  const names = localizedBookNames(localizer);
  return Array.from({ length: 66 }, (_, i) => ({ number: i + 1, name: names[i + 1] }));
}

/** Chapter count per book, and the OT/NT book lists: one copy in core, re-exported here so existing imports keep working. */
export { MAX_CHAPTERS, OT_BOOKS, NT_BOOKS } from '@bible/core/browser';

/** Ordered list of every book, for populating book pickers. */
export const ALL_BOOKS: Array<{ number: number; name: string }> =
  Array.from({ length: 66 }, (_, i) => ({ number: i + 1, name: BOOK_NAMES[i + 1] }));

export interface PredefinedRange {
  id: string;
  /** Catalog key for the group's display name. */
  labelKey: string;
  /** Inclusive book numbers in the standard English (KJV) ordering. */
  startBook: number;
  endBook: number;
}

/**
 * Named book groupings offered as one-click scopes in Advanced Search.
 *
 * The ids and book spans are safe to hardcode because this app supports exactly
 * one versification scheme: standard English / KJV ordering. The names are
 * not safe to hardcode: they are
 * the conventional Protestant divisions in English, so they live in the
 * catalog and are resolved at render time.
 */
export const PREDEFINED_RANGES: PredefinedRange[] = [
  { id: 'ot', labelKey: 'bibleBooks.range.ot', startBook: 1, endBook: 39 },
  { id: 'nt', labelKey: 'bibleBooks.range.nt', startBook: 40, endBook: 66 },
  { id: 'pentateuch', labelKey: 'bibleBooks.range.pentateuch', startBook: 1, endBook: 5 },
  { id: 'ot-history', labelKey: 'bibleBooks.range.otHistory', startBook: 6, endBook: 17 },
  { id: 'wisdom', labelKey: 'bibleBooks.range.wisdom', startBook: 18, endBook: 22 },
  { id: 'major-prophets', labelKey: 'bibleBooks.range.majorProphets', startBook: 23, endBook: 27 },
  { id: 'minor-prophets', labelKey: 'bibleBooks.range.minorProphets', startBook: 28, endBook: 39 },
  { id: 'gospels', labelKey: 'bibleBooks.range.gospels', startBook: 40, endBook: 43 },
  { id: 'acts', labelKey: 'bibleBooks.range.acts', startBook: 44, endBook: 44 },
  { id: 'pauline', labelKey: 'bibleBooks.range.pauline', startBook: 45, endBook: 57 },
  { id: 'general-epistles', labelKey: 'bibleBooks.range.generalEpistles', startBook: 58, endBook: 65 },
  { id: 'revelation', labelKey: 'bibleBooks.range.revelation', startBook: 66, endBook: 66 },
];
