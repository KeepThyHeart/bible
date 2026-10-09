/**
 * Verse identity.
 *
 * A verse is one integer: `book * 1_000_000 + chapter * 1_000 + verse`. Book 1
 * is Genesis, book 66 is Revelation. John 3:16 is 43_003_016.
 *
 * This is the same encoding the Bible module files use, which is the whole
 * point: the games can read a module directly, and any content authored here
 * stays meaningful against a different module later. Chapter and verse are
 * capped at 999, which no book of the protestant canon comes close to.
 */

export type VerseId = number;

export const BOOK_COUNT = 66;

export interface VerseRef {
  book: number;
  chapter: number;
  verse: number;
}

export function toVerseId(book: number, chapter: number, verse: number): VerseId {
  return book * 1_000_000 + chapter * 1_000 + verse;
}

export function fromVerseId(id: VerseId): VerseRef {
  const book = Math.floor(id / 1_000_000);
  const remainder = id % 1_000_000;
  return {
    book,
    chapter: Math.floor(remainder / 1_000),
    verse: remainder % 1_000,
  };
}

export function isValidVerseId(id: VerseId): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const { book, chapter, verse } = fromVerseId(id);
  return book >= 1 && book <= BOOK_COUNT && chapter >= 1 && verse >= 1;
}

/** Inclusive bounds covering every verse of one chapter. */
export function chapterRange(book: number, chapter: number): { first: VerseId; last: VerseId } {
  return { first: toVerseId(book, chapter, 1), last: toVerseId(book, chapter, 999) };
}

/** Inclusive bounds covering every verse of one book. */
export function bookRange(book: number): { first: VerseId; last: VerseId } {
  return { first: toVerseId(book, 1, 1), last: toVerseId(book, 999, 999) };
}

/**
 * Book names, indexed by book number minus one. Long names are for the host
 * screen; short names fit a phone's reference picker at 320 px.
 */
export const BOOK_NAMES: readonly string[] = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude',
  'Revelation',
];

export const SHORT_BOOK_NAMES: readonly string[] = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs',
  '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song',
  'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic',
  'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts',
  'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col', '1Thess', '2Thess', '1Tim',
  '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John', '3John',
  'Jude', 'Rev',
];

export function bookName(book: number): string {
  return BOOK_NAMES[book - 1] ?? `Book ${book}`;
}

/** Single-chapter books are rendered without a chapter number. */
const SINGLE_CHAPTER_BOOKS = new Set([31, 57, 63, 64, 65]);

export function formatRef(id: VerseId): string {
  const { book, chapter, verse } = fromVerseId(id);
  if (SINGLE_CHAPTER_BOOKS.has(book)) return `${bookName(book)} ${verse}`;
  return `${bookName(book)} ${chapter}:${verse}`;
}

/**
 * Spellings a person might write that are not the name this file prints.
 * Deliberately short: it covers the handful of books with two common names,
 * not every abbreviation ever used, because a reference the parser cannot read
 * is rejected by name at import time rather than quietly mis-filed.
 */
const NAME_ALIASES: Readonly<Record<string, number>> = {
  psalm: 19,
  songofsongs: 22,
  canticles: 22,
  revelations: 66,
  '1thes': 52,
  '2thes': 53,
  philem: 57,
};

/** Case, spaces and full stops are noise in a book name: `1 Jn.` is `1Jn`. */
function nameKey(text: string): string {
  return text.toLowerCase().replace(/[.\s]+/gu, '');
}

const BOOK_BY_NAME = new Map<string, number>([
  ...BOOK_NAMES.map((name, index): [string, number] => [nameKey(name), index + 1]),
  ...SHORT_BOOK_NAMES.map((name, index): [string, number] => [nameKey(name), index + 1]),
  ...Object.entries(NAME_ALIASES),
]);

/**
 * A reference as a person writes it — `John 3:16`, `1 Cor 13:4`, `Ps. 23:1`,
 * `Jude 3` — back to an id, or null when it cannot be read.
 *
 * Authored content is written by hand and checked by a validator, so this
 * accepts the long name, the short name and the obvious punctuation, and
 * refuses everything else rather than guessing. A lone number is a verse only
 * in the books that have one chapter: `1 John 3` names a chapter, not a verse,
 * and comes back null.
 */
export function parseRef(text: string): VerseId | null {
  const match = /^\s*(.*?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?\s*$/u.exec(text);
  if (match === null) return null;

  const book = BOOK_BY_NAME.get(nameKey(match[1] ?? ''));
  if (book === undefined) return null;

  const single = match[3] === undefined;
  if (single && !SINGLE_CHAPTER_BOOKS.has(book)) return null;

  const chapter = single ? 1 : Number(match[2]);
  const verse = single ? Number(match[2]) : Number(match[3]);
  const id = toVerseId(book, chapter, verse);
  return isValidVerseId(id) ? id : null;
}

/**
 * Canonical sections, used to build reference distractors that sit a chosen
 * distance from the true answer, and to let hosts filter content.
 */
export const SECTIONS = {
  law: [1, 5],
  history: [6, 17],
  wisdom: [18, 22],
  majorProphets: [23, 27],
  minorProphets: [28, 39],
  gospels: [40, 43],
  acts: [44, 44],
  epistles: [45, 65],
  revelation: [66, 66],
} as const satisfies Record<string, readonly [number, number]>;

export type SectionName = keyof typeof SECTIONS;

export function sectionOf(book: number): SectionName {
  for (const [name, [first, last]] of Object.entries(SECTIONS)) {
    if (book >= first && book <= last) return name as SectionName;
  }
  return 'law';
}

export function isOldTestament(book: number): boolean {
  return book <= 39;
}
