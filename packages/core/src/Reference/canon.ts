/**
 * Language-neutral facts about the 66-book canon the engine needs: OSIS ids
 * (always accepted as input, and the last-resort display name) and chapter
 * counts (KJV versification, the only scheme the apps support).
 */
import type { ReferenceLocaleData } from './types';

export const OSIS_IDS: readonly string[] = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt',
  'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil',
  'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet',
  '2Pet', '1John', '2John', '3John', 'Jude', 'Rev',
];

/** Chapters per book, index 0 = Genesis. */
export const CHAPTER_COUNTS: readonly number[] = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31,
  12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28,
  16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5,
  3, 5, 1, 1, 1, 22,
];

export function osisId(book: number): string | undefined {
  return OSIS_IDS[book - 1];
}

export function chapterCount(book: number): number | undefined {
  return CHAPTER_COUNTS[book - 1];
}

export function isSingleChapter(book: number): boolean {
  return CHAPTER_COUNTS[book - 1] === 1;
}

/** Pseudo-locale "osis": OSIS ids as names, always tried last. */
export const OSIS_LOCALE: ReferenceLocaleData = {
  tag: 'osis',
  name: 'OSIS book ids',
  status: 'complete',
  match: { minPrefix: 0 },
  books: Object.fromEntries(OSIS_IDS.map((id, i) => [String(i + 1), { long: id }])),
  ordinals: {},
};
