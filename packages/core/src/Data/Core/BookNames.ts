/**
 * Canonical English book-name tables - the single source of truth for the repo.
 *
 * Before this module existed, a full 66-book table was hardcoded in more than a
 * dozen places across core and its consumers. Those copies differed only in
 * their alias sets, never in the display names, so this file is their union:
 * every alias that parsed anywhere before still parses here.
 *
 * ## Localization
 *
 * These are the *English* defaults. `ReferenceParser` accepts its own tables
 * via `ReferenceParserConfig`, so a localized app supplies translated names
 * rather than editing this file. UI code that displays a book name to the user
 * should prefer the app's i18n lookup and fall back to `getBookName()`; these
 * constants exist for parsing, for non-UI contexts, and as that fallback.
 *
 * This module has no imports and no platform dependencies, so it is safe in a
 * browser bundle, an Electron renderer, and a Node script alike.
 */

/**
 * Book name format for reference output.
 * - 'long': Full book names (e.g., "Acts", "Romans", "1 Corinthians")
 * - 'short': TSK-style abbreviations (e.g., "Ac", "Ro", "1Co")
 * - 'medium': Standard abbreviations (e.g., "Act", "Rom", "1 Cor")
 */
export type BookNameFormat = 'long' | 'short' | 'medium';

/** Total number of books in the standard English canon. */
export const BOOK_COUNT = 66;


/** Long (full) book names, indexed by book number 1-66. */
export const LONG_NAMES: Record<number, string> = {
  1: 'Genesis', 2: 'Exodus', 3: 'Leviticus', 4: 'Numbers', 5: 'Deuteronomy',
  6: 'Joshua', 7: 'Judges', 8: 'Ruth', 9: '1 Samuel', 10: '2 Samuel',
  11: '1 Kings', 12: '2 Kings', 13: '1 Chronicles', 14: '2 Chronicles',
  15: 'Ezra', 16: 'Nehemiah', 17: 'Esther', 18: 'Job', 19: 'Psalms',
  20: 'Proverbs', 21: 'Ecclesiastes', 22: 'Song of Solomon', 23: 'Isaiah',
  24: 'Jeremiah', 25: 'Lamentations', 26: 'Ezekiel', 27: 'Daniel',
  28: 'Hosea', 29: 'Joel', 30: 'Amos', 31: 'Obadiah', 32: 'Jonah',
  33: 'Micah', 34: 'Nahum', 35: 'Habakkuk', 36: 'Zephaniah', 37: 'Haggai',
  38: 'Zechariah', 39: 'Malachi', 40: 'Matthew', 41: 'Mark', 42: 'Luke',
  43: 'John', 44: 'Acts', 45: 'Romans', 46: '1 Corinthians', 47: '2 Corinthians',
  48: 'Galatians', 49: 'Ephesians', 50: 'Philippians', 51: 'Colossians',
  52: '1 Thessalonians', 53: '2 Thessalonians', 54: '1 Timothy', 55: '2 Timothy',
  56: 'Titus', 57: 'Philemon', 58: 'Hebrews', 59: 'James', 60: '1 Peter',
  61: '2 Peter', 62: '1 John', 63: '2 John', 64: '3 John', 65: 'Jude',
  66: 'Revelation'
};

/** Medium-length abbreviations, indexed by book number 1-66. */
export const MEDIUM_NAMES: Record<number, string> = {
  1: 'Gen', 2: 'Exo', 3: 'Lev', 4: 'Num', 5: 'Deut',
  6: 'Josh', 7: 'Judg', 8: 'Ruth', 9: '1 Sam', 10: '2 Sam',
  11: '1 Kgs', 12: '2 Kgs', 13: '1 Chr', 14: '2 Chr',
  15: 'Ezra', 16: 'Neh', 17: 'Esth', 18: 'Job', 19: 'Psa',
  20: 'Prov', 21: 'Eccl', 22: 'Song', 23: 'Isa',
  24: 'Jer', 25: 'Lam', 26: 'Ezek', 27: 'Dan',
  28: 'Hos', 29: 'Joel', 30: 'Amos', 31: 'Obad', 32: 'Jonah',
  33: 'Mic', 34: 'Nah', 35: 'Hab', 36: 'Zeph', 37: 'Hag',
  38: 'Zech', 39: 'Mal', 40: 'Matt', 41: 'Mark', 42: 'Luke',
  43: 'John', 44: 'Acts', 45: 'Rom', 46: '1 Cor', 47: '2 Cor',
  48: 'Gal', 49: 'Eph', 50: 'Phil', 51: 'Col',
  52: '1 Thess', 53: '2 Thess', 54: '1 Tim', 55: '2 Tim',
  56: 'Titus', 57: 'Phlm', 58: 'Heb', 59: 'Jas', 60: '1 Pet',
  61: '2 Pet', 62: '1 John', 63: '2 John', 64: '3 John', 65: 'Jude',
  66: 'Rev'
};

/** Short TSK-style abbreviations, indexed by book number 1-66. */
export const SHORT_NAMES: Record<number, string> = {
  1: 'Ge', 2: 'Ex', 3: 'Le', 4: 'Nu', 5: 'De',
  6: 'Jos', 7: 'Jdg', 8: 'Ru', 9: '1Sa', 10: '2Sa',
  11: '1Ki', 12: '2Ki', 13: '1Ch', 14: '2Ch',
  15: 'Ezr', 16: 'Ne', 17: 'Es', 18: 'Job', 19: 'Ps',
  20: 'Pr', 21: 'Ec', 22: 'So', 23: 'Isa',
  24: 'Jer', 25: 'La', 26: 'Eze', 27: 'Da',
  28: 'Ho', 29: 'Joe', 30: 'Am', 31: 'Ob', 32: 'Jon',
  33: 'Mic', 34: 'Na', 35: 'Hab', 36: 'Zep', 37: 'Hag',
  38: 'Zec', 39: 'Mal', 40: 'Mt', 41: 'Mk', 42: 'Lk',
  43: 'Jn', 44: 'Ac', 45: 'Ro', 46: '1Co', 47: '2Co',
  48: 'Ga', 49: 'Eph', 50: 'Php', 51: 'Col',
  52: '1Th', 53: '2Th', 54: '1Ti', 55: '2Ti',
  56: 'Tit', 57: 'Phm', 58: 'He', 59: 'Jas', 60: '1Pe',
  61: '2Pe', 62: '1Jn', 63: '2Jn', 64: '3Jn', 65: 'Jud',
  66: 'Re'
};

export const ENGLISH_SINGLE_CHAPTER_BOOKS = new Set([
  31,  // Obadiah
  57,  // Philemon
  63,  // 2 John
  64,  // 3 John
  65,  // Jude
]);

export const ENGLISH_DISPLAY_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

export const ENGLISH_BOOK_NAMES: Map<string, number> = new Map([
    // Genesis - Deuteronomy
    ['genesis', 1], ['gen', 1], ['ge', 1], ['gn', 1],
    ['exodus', 2], ['exo', 2], ['exod', 2], ['ex', 2],
    ['leviticus', 3], ['lev', 3], ['le', 3], ['lv', 3],
    ['numbers', 4], ['num', 4], ['nu', 4], ['nm', 4], ['nb', 4],
    ['deuteronomy', 5], ['deut', 5], ['deu', 5], ['de', 5], ['dt', 5],

    // Joshua - Esther
    ['joshua', 6], ['josh', 6], ['jos', 6], ['jsh', 6],
    ['judges', 7], ['judg', 7], ['jdg', 7], ['jg', 7], ['jdgs', 7],
    ['ruth', 8], ['rut', 8], ['rth', 8], ['ru', 8],
    ['1 samuel', 9], ['1samuel', 9], ['1sam', 9], ['1sa', 9], ['1s', 9], ['i samuel', 9], ['1 sm', 9], ['i sam', 9], ['isam', 9], ['i sa', 9],
    ['2 samuel', 10], ['2samuel', 10], ['2sam', 10], ['2sa', 10], ['2s', 10], ['ii samuel', 10], ['2 sm', 10], ['ii sam', 10], ['iisam', 10], ['ii sa', 10],
    ['1 kings', 11], ['1kings', 11], ['1kgs', 11], ['1ki', 11], ['1k', 11], ['i kings', 11], ['1 kgs', 11], ['i kgs', 11], ['ikgs', 11], ['i ki', 11],
    ['2 kings', 12], ['2kings', 12], ['2kgs', 12], ['2ki', 12], ['2k', 12], ['ii kings', 12], ['2 kgs', 12], ['ii kgs', 12], ['iikgs', 12], ['ii ki', 12],
    ['1 chronicles', 13], ['1chronicles', 13], ['1chr', 13], ['1ch', 13], ['i chronicles', 13], ['1 chron', 13], ['i chr', 13], ['ichr', 13], ['i ch', 13],
    ['2 chronicles', 14], ['2chronicles', 14], ['2chr', 14], ['2ch', 14], ['ii chronicles', 14], ['2 chron', 14], ['ii chr', 14], ['iichr', 14], ['ii ch', 14],
    ['ezra', 15], ['ezr', 15], ['ez', 15],
    ['nehemiah', 16], ['neh', 16], ['ne', 16],
    ['esther', 17], ['esth', 17], ['est', 17], ['es', 17],

    // Job - Song of Solomon
    ['job', 18], ['jb', 18],
    ['psalm', 19], ['psalms', 19], ['ps', 19], ['psa', 19], ['psm', 19], ['pss', 19],
    ['proverbs', 20], ['prov', 20], ['pro', 20], ['prv', 20], ['pr', 20],
    ['ecclesiastes', 21], ['eccles', 21], ['eccl', 21], ['ecc', 21], ['ec', 21], ['qoh', 21],
    ['song of solomon', 22], ['song', 22], ['song of songs', 22], ['sos', 22], ['so', 22], ['canticle of canticles', 22], ['canticles', 22], ['cant', 22],

    // Isaiah - Malachi
    ['isaiah', 23], ['isa', 23], ['is', 23],
    ['jeremiah', 24], ['jer', 24], ['je', 24], ['jr', 24],
    ['lamentations', 25], ['lam', 25], ['la', 25],
    ['ezekiel', 26], ['ezek', 26], ['eze', 26], ['ezk', 26],
    ['daniel', 27], ['dan', 27], ['da', 27], ['dn', 27],
    ['hosea', 28], ['hos', 28], ['ho', 28],
    ['joel', 29], ['joe', 29], ['jl', 29],
    ['amos', 30], ['amo', 30], ['am', 30],
    ['obadiah', 31], ['obad', 31], ['oba', 31], ['ob', 31],
    ['jonah', 32], ['jon', 32], ['jnh', 32],
    ['micah', 33], ['mic', 33], ['mc', 33],
    ['nahum', 34], ['nah', 34], ['na', 34],
    ['habakkuk', 35], ['hab', 35], ['hb', 35],
    ['zephaniah', 36], ['zeph', 36], ['zep', 36], ['zp', 36],
    ['haggai', 37], ['hag', 37], ['hg', 37],
    ['zechariah', 38], ['zech', 38], ['zec', 38], ['zc', 38],
    ['malachi', 39], ['mal', 39], ['ml', 39],

    // Matthew - Acts
    ['matthew', 40], ['matt', 40], ['mat', 40], ['mt', 40],
    ['mark', 41], ['mar', 41], ['mrk', 41], ['mk', 41], ['mr', 41],
    ['luke', 42], ['luk', 42], ['lk', 42], ['lu', 42],
    ['john', 43], ['joh', 43], ['jhn', 43], ['jn', 43],
    ['acts', 44], ['act', 44], ['ac', 44],

    // Romans - Philemon
    ['romans', 45], ['rom', 45], ['ro', 45], ['rm', 45],
    ['1 corinthians', 46], ['1corinthians', 46], ['1cor', 46], ['1co', 46], ['1 cor', 46], ['i corinthians', 46], ['1 co', 46], ['i cor', 46], ['icor', 46], ['i co', 46],
    ['2 corinthians', 47], ['2corinthians', 47], ['2cor', 47], ['2co', 47], ['2 cor', 47], ['ii corinthians', 47], ['2 co', 47], ['ii cor', 47], ['iicor', 47], ['ii co', 47],
    ['galatians', 48], ['gal', 48], ['ga', 48],
    ['ephesians', 49], ['eph', 49], ['ephes', 49],
    ['philippians', 50], ['phil', 50], ['php', 50], ['pp', 50],
    ['colossians', 51], ['col', 51], ['co', 51],
    ['1 thessalonians', 52], ['1thessalonians', 52], ['1thess', 52], ['1th', 52], ['1 thes', 52], ['1 thess', 52], ['i thessalonians', 52], ['i thess', 52], ['ithess', 52], ['i th', 52],
    ['2 thessalonians', 53], ['2thessalonians', 53], ['2thess', 53], ['2th', 53], ['2 thes', 53], ['2 thess', 53], ['ii thessalonians', 53], ['ii thess', 53], ['iithess', 53], ['ii th', 53],
    ['1 timothy', 54], ['1timothy', 54], ['1tim', 54], ['1ti', 54], ['1 tim', 54], ['i timothy', 54], ['i tim', 54], ['itim', 54], ['i ti', 54],
    ['2 timothy', 55], ['2timothy', 55], ['2tim', 55], ['2ti', 55], ['2 tim', 55], ['ii timothy', 55], ['ii tim', 55], ['iitim', 55], ['ii ti', 55],
    ['titus', 56], ['tit', 56], ['ti', 56],
    ['philemon', 57], ['philem', 57], ['phm', 57], ['pm', 57],

    // Hebrews - Revelation
    ['hebrews', 58], ['heb', 58], ['he', 58],
    ['james', 59], ['jam', 59], ['jas', 59], ['jm', 59],
    ['1 peter', 60], ['1peter', 60], ['1pet', 60], ['1pe', 60], ['1pt', 60], ['1 pet', 60], ['1 pe', 60], ['i peter', 60], ['1p', 60], ['i pet', 60], ['ipet', 60], ['i pe', 60],
    ['2 peter', 61], ['2peter', 61], ['2pet', 61], ['2pe', 61], ['2pt', 61], ['2 pet', 61], ['2 pe', 61], ['ii peter', 61], ['2p', 61], ['ii pet', 61], ['iipet', 61], ['ii pe', 61],
    ['1 john', 62], ['1john', 62], ['1jn', 62], ['1jo', 62], ['1joh', 62], ['1 jn', 62], ['i john', 62], ['1j', 62], ['i jn', 62], ['ijn', 62], ['i jo', 62],
    ['2 john', 63], ['2john', 63], ['2jn', 63], ['2jo', 63], ['2joh', 63], ['2 jn', 63], ['ii john', 63], ['2j', 63], ['ii jn', 63], ['iijn', 63], ['ii jo', 63],
    ['3 john', 64], ['3john', 64], ['3jn', 64], ['3jo', 64], ['3joh', 64], ['3 jn', 64], ['iii john', 64], ['3j', 64], ['iii jn', 64], ['iiijn', 64], ['iii jo', 64],
    ['jude', 65], ['jud', 65], ['jd', 65],
  ['revelation', 66], ['rev', 66], ['re', 66], ['the revelation', 66],

    // ---- Unioned in when the per-app book tables were consolidated ----
    // Roman-numeral forms without a separating space, plus a few spellings that
    // only existed in the desktop copies. Verified conflict-free against the
    // table above; every one of these parsed in at least one app before.
    ['1sm', 9], ['isamuel', 9], ['1 sam', 9],
    ['2sm', 10], ['iisamuel', 10], ['2 sam', 10],
    ['ikings', 11],
    ['iikings', 12],
    ['ichronicles', 13],
    ['iichronicles', 14],
    ['icorinthians', 46],
    ['iicorinthians', 47],
    ['ithessalonians', 52],
    ['iithessalonians', 53],
    ['itimothy', 54],
    ['iitimothy', 55],
    ['phlm', 57],
    ['ipeter', 60],
    ['iipeter', 61],
    ['ijohn', 62],
    ['iijohn', 63],
    ['iiijohn', 64],
    ['revelations', 66], ['revelation of john', 66], ['rv', 66],
]);

/** Name tables keyed by format. */
const NAME_TABLES: Record<BookNameFormat, Record<number, string>> = {
  long: LONG_NAMES,
  medium: MEDIUM_NAMES,
  short: SHORT_NAMES,
};

/**
 * Get the English book name for a book number in the requested format.
 * Returns `Book <n>` for out-of-range numbers rather than throwing, so callers
 * rendering user-supplied data cannot crash on a bad book number.
 */
export function getBookName(bookNumber: number, format: BookNameFormat = 'long'): string {
  return NAME_TABLES[format][bookNumber] ?? `Book ${bookNumber}`;
}

/** True when the book has a single chapter ("Jude 5" means "Jude 1:5"). */
export function isSingleChapterBook(bookNumber: number): boolean {
  return ENGLISH_SINGLE_CHAPTER_BOOKS.has(bookNumber);
}

/**
 * Resolve a book name or abbreviation to its book number, or `undefined`.
 * Input is lower-cased and trimmed; internal spacing must match a table entry
 * (both spaced and unspaced forms are present for the numbered books).
 */
export function getBookNumber(bookName: string): number | undefined {
  return ENGLISH_BOOK_NAMES.get(bookName.toLowerCase().trim());
}
