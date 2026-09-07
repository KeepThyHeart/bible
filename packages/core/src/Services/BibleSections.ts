/**
 * Bible book section groupings.
 *
 * Traditional canonical divisions of the 66-book Protestant Bible. Used for
 * grouping, color-coding, and navigation aids in UI layers (passage picker,
 * book lists, etc.). The data is hard-coded and language-independent - UI
 * layers are responsible for localizing the display `name` if desired.
 *
 * Future: additional grouping schemes (e.g., chronological, Hebrew Tanakh
 * order) can be added as parallel exports without breaking this one.
 *
 * Note: named `BibleSectionKey` (not `BookSection`) to avoid collision with
 * the existing `BookSection` class in Data/Models/Book, which represents a
 * section within a book-type module (chapters/subdivisions of a study book).
 */

/** Stable section keys (CSS-friendly, language-independent). */
export type BibleSectionKey =
  | 'pentateuch'
  | 'ot-history'
  | 'wisdom'
  | 'major-prophets'
  | 'minor-prophets'
  | 'gospels'
  | 'acts'
  | 'pauline'
  | 'general'
  | 'revelation';

export interface BibleSectionInfo {
  /** Stable key - safe for use in CSS class names and persistence. */
  key: BibleSectionKey;
  /** English display name. UI layers should localize via i18n if needed. */
  name: string;
  /** First book number (inclusive) covered by this section. */
  firstBook: number;
  /** Last book number (inclusive) covered by this section. */
  lastBook: number;
}

/** All sections in canonical order, covering books 1-66 with no gaps. */
export const BIBLE_SECTIONS: readonly BibleSectionInfo[] = [
  { key: 'pentateuch',     name: 'Pentateuch',       firstBook:  1, lastBook:  5 },
  { key: 'ot-history',     name: 'OT History',       firstBook:  6, lastBook: 17 },
  { key: 'wisdom',         name: 'Wisdom',           firstBook: 18, lastBook: 22 },
  { key: 'major-prophets', name: 'Major Prophets',   firstBook: 23, lastBook: 27 },
  { key: 'minor-prophets', name: 'Minor Prophets',   firstBook: 28, lastBook: 39 },
  { key: 'gospels',        name: 'Gospels',          firstBook: 40, lastBook: 43 },
  { key: 'acts',           name: 'Acts',             firstBook: 44, lastBook: 44 },
  { key: 'pauline',        name: 'Pauline Epistles', firstBook: 45, lastBook: 57 },
  { key: 'general',        name: 'General Epistles', firstBook: 58, lastBook: 65 },
  { key: 'revelation',     name: 'Revelation',       firstBook: 66, lastBook: 66 },
];

/**
 * Returns the section key for a given book number (1-66).
 * Throws if the book number is out of range.
 */
export function getBibleSection(bookNumber: number): BibleSectionKey {
  for (const section of BIBLE_SECTIONS) {
    if (bookNumber >= section.firstBook && bookNumber <= section.lastBook) {
      return section.key;
    }
  }
  throw new Error(`Invalid book number: ${bookNumber}`);
}
