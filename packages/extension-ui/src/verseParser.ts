/**
 * Lightweight verse reference parser for the Extension UI SDK.
 *
 * Handles common English Bible reference formats:
 *   - "John 3:16"            → single verse
 *   - "1 Cor 13:4-7"         → verse range
 *   - "Genesis 1:1-2:3"      → cross-chapter range
 *   - "Ps 23"                → whole chapter
 *   - "Rom 8:28, 30"         → comma-separated verses
 *   - "Jude 5"               → single-chapter book (→ Jude 1:5)
 *
 * Returns verse IDs using the standard system:
 *   verseId = (bookNumber * 1_000_000) + (chapter * 1_000) + verse
 *
 * This parser uses exact name matching only (no fuzzy/Levenshtein) to
 * minimise false positives when scanning running text.
 */

// ── Verse ID helpers ─────────────────────────────────────────────────────

export function calculateVerseId(book: number, chapter: number, verse: number): number {
  return book * 1_000_000 + chapter * 1_000 + verse;
}

export interface ParsedVerseRef {
  book: number;
  bookName: string;
  chapter: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
  verseId: number;
  endVerseId?: number;
}

export interface ScannedRef extends ParsedVerseRef {
  start: number;
  end: number;
  text: string;
}

// ── Book name table ──────────────────────────────────────────────────────

const SINGLE_CHAPTER = new Set([31, 57, 63, 64, 65]);

const DISPLAY: string[] = [
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra',
  'Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon',
  'Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos',
  'Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah',
  'Malachi','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians',
  '2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians',
  '2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James',
  '1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation',
];

/** Lowercase name/abbreviation → book number (1-66). */
const BOOKS = new Map<string, number>([
  ['genesis',1],['gen',1],['ge',1],['gn',1],
  ['exodus',2],['exo',2],['exod',2],['ex',2],
  ['leviticus',3],['lev',3],['le',3],['lv',3],
  ['numbers',4],['num',4],['nu',4],['nm',4],
  ['deuteronomy',5],['deut',5],['deu',5],['de',5],['dt',5],
  ['joshua',6],['josh',6],['jos',6],
  ['judges',7],['judg',7],['jdg',7],['jg',7],
  ['ruth',8],['rut',8],['ru',8],
  ['1 samuel',9],['1samuel',9],['1sam',9],['1sa',9],['1s',9],['i samuel',9],['i sam',9],
  ['2 samuel',10],['2samuel',10],['2sam',10],['2sa',10],['2s',10],['ii samuel',10],['ii sam',10],
  ['1 kings',11],['1kings',11],['1kgs',11],['1ki',11],['i kings',11],['i kgs',11],
  ['2 kings',12],['2kings',12],['2kgs',12],['2ki',12],['ii kings',12],['ii kgs',12],
  ['1 chronicles',13],['1chronicles',13],['1chr',13],['1ch',13],['i chronicles',13],['i chr',13],
  ['2 chronicles',14],['2chronicles',14],['2chr',14],['2ch',14],['ii chronicles',14],['ii chr',14],
  ['ezra',15],['ezr',15],
  ['nehemiah',16],['neh',16],['ne',16],
  ['esther',17],['esth',17],['est',17],['es',17],
  ['job',18],['jb',18],
  ['psalm',19],['psalms',19],['ps',19],['psa',19],
  ['proverbs',20],['prov',20],['pro',20],['prv',20],['pr',20],
  ['ecclesiastes',21],['eccles',21],['eccl',21],['ecc',21],
  ['song of solomon',22],['song',22],['song of songs',22],['sos',22],
  ['isaiah',23],['isa',23],['is',23],
  ['jeremiah',24],['jer',24],['je',24],
  ['lamentations',25],['lam',25],['la',25],
  ['ezekiel',26],['ezek',26],['eze',26],
  ['daniel',27],['dan',27],['da',27],['dn',27],
  ['hosea',28],['hos',28],['ho',28],
  ['joel',29],['joe',29],['jl',29],
  ['amos',30],['amo',30],['am',30],
  ['obadiah',31],['obad',31],['oba',31],['ob',31],
  ['jonah',32],['jon',32],
  ['micah',33],['mic',33],
  ['nahum',34],['nah',34],['na',34],
  ['habakkuk',35],['hab',35],
  ['zephaniah',36],['zeph',36],['zep',36],
  ['haggai',37],['hag',37],
  ['zechariah',38],['zech',38],['zec',38],
  ['malachi',39],['mal',39],
  ['matthew',40],['matt',40],['mat',40],['mt',40],
  ['mark',41],['mar',41],['mrk',41],['mk',41],
  ['luke',42],['luk',42],['lk',42],
  ['john',43],['joh',43],['jhn',43],['jn',43],
  ['acts',44],['act',44],['ac',44],
  ['romans',45],['rom',45],['ro',45],['rm',45],
  ['1 corinthians',46],['1corinthians',46],['1cor',46],['1co',46],['1 cor',46],['i corinthians',46],['i cor',46],
  ['2 corinthians',47],['2corinthians',47],['2cor',47],['2co',47],['2 cor',47],['ii corinthians',47],['ii cor',47],
  ['galatians',48],['gal',48],['ga',48],
  ['ephesians',49],['eph',49],
  ['philippians',50],['phil',50],['php',50],
  ['colossians',51],['col',51],
  ['1 thessalonians',52],['1thessalonians',52],['1thess',52],['1th',52],['1 thess',52],['i thessalonians',52],['i thess',52],
  ['2 thessalonians',53],['2thessalonians',53],['2thess',53],['2th',53],['2 thess',53],['ii thessalonians',53],['ii thess',53],
  ['1 timothy',54],['1timothy',54],['1tim',54],['1ti',54],['1 tim',54],['i timothy',54],['i tim',54],
  ['2 timothy',55],['2timothy',55],['2tim',55],['2ti',55],['2 tim',55],['ii timothy',55],['ii tim',55],
  ['titus',56],['tit',56],
  ['philemon',57],['philem',57],['phm',57],
  ['hebrews',58],['heb',58],['he',58],
  ['james',59],['jam',59],['jas',59],['jm',59],
  ['1 peter',60],['1peter',60],['1pet',60],['1pe',60],['1 pet',60],['i peter',60],['i pet',60],
  ['2 peter',61],['2peter',61],['2pet',61],['2pe',61],['2 pet',61],['ii peter',61],['ii pet',61],
  ['1 john',62],['1john',62],['1jn',62],['1jo',62],['1 jn',62],['i john',62],['i jn',62],
  ['2 john',63],['2john',63],['2jn',63],['2jo',63],['2 jn',63],['ii john',63],['ii jn',63],
  ['3 john',64],['3john',64],['3jn',64],['3jo',64],['3 jn',64],['iii john',64],['iii jn',64],
  ['jude',65],['jud',65],['jd',65],
  ['revelation',66],['rev',66],['re',66],
]);

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a book number from a name or abbreviation (exact match).
 */
export function getBookNumber(name: string): number | undefined {
  return BOOKS.get(name.toLowerCase().trim());
}

/**
 * Get the canonical display name for a book number.
 */
export function getBookName(bookNumber: number): string {
  return DISPLAY[bookNumber - 1] ?? `Book ${bookNumber}`;
}

/**
 * Parse a single Bible reference string.
 * Returns undefined if the text is not a recognisable reference.
 */
export function parseReference(text: string): ParsedVerseRef | undefined {
  const trimmed = text.trim();

  // Pattern: [prefix] BookName chapter[:verse][-[chapter:]verse]
  const m = /^((?:[123]|I{1,3}|i{1,3})\s+)?([A-Za-z]+(?:\s+of\s+[A-Za-z]+)?)\s+(\d+)(?::(\d+))?(?:\s*[-\u2013]\s*(?:(\d+):)?(\d+))?$/
    .exec(trimmed);
  if (!m) return undefined;

  const rawBook = ((m[1] ?? '') + m[2]).trim();
  const bookNum = getBookNumber(rawBook);
  if (bookNum === undefined) return undefined;

  let chapter = parseInt(m[3]);
  let verse = m[4] ? parseInt(m[4]) : undefined;
  let endChapter = m[5] ? parseInt(m[5]) : undefined;
  let endVerse = m[6] ? parseInt(m[6]) : undefined;

  // Single-chapter books: "Jude 5" → chapter 1, verse 5
  if (SINGLE_CHAPTER.has(bookNum) && verse === undefined) {
    verse = chapter;
    endChapter = undefined;
    chapter = 1;
  }

  const verseId = calculateVerseId(bookNum, chapter, verse ?? 1);
  let endVerseId: number | undefined;
  if (endVerse !== undefined) {
    endVerseId = calculateVerseId(bookNum, endChapter ?? chapter, endVerse);
  }

  return {
    book: bookNum,
    bookName: getBookName(bookNum),
    chapter,
    verse,
    endChapter,
    endVerse,
    verseId,
    endVerseId,
  };
}

/**
 * Scan running text for Bible references and return their positions.
 *
 * Only uses exact book name matching (no fuzzy) to avoid false positives.
 * Handles comma-separated verses: "John 3:16, 17" yields two results.
 */
export function scanText(text: string): ScannedRef[] {
  const results: ScannedRef[] = [];

  // Match potential references in running text.
  const pattern = /\b((?:[123]|I{1,3}|i{1,3})\s+)?([A-Z][a-z]+(?:\s+of\s+[A-Z][a-z]+)?)\s+(\d+)(?::(\d+))?(?:\s*[-\u2013]\s*(?:(\d+):)?(\d+))?\b/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0];
    const ref = parseReference(fullMatch.trim());
    if (!ref) continue;

    const mainEnd = match.index + fullMatch.length;
    results.push({ ...ref, start: match.index, end: mainEnd, text: fullMatch.trim() });

    // Look ahead for comma-separated verses: "John 3:16, 17"
    if (ref.verse !== undefined) {
      const commaRe = /^,\s*(\d+)/g;
      let remaining = text.substring(mainEnd);
      let offset = mainEnd;
      let cm: RegExpExecArray | null;
      while ((cm = commaRe.exec(remaining)) !== null) {
        const extraVerse = parseInt(cm[1]);
        const extraId = calculateVerseId(ref.book, ref.chapter, extraVerse);
        results.push({
          book: ref.book,
          bookName: ref.bookName,
          chapter: ref.chapter,
          verse: extraVerse,
          verseId: extraId,
          start: offset + cm.index,
          end: offset + cm.index + cm[0].length,
          text: cm[0].trim(),
        });
        const consumed = cm.index + cm[0].length;
        remaining = remaining.substring(consumed);
        offset += consumed;
        commaRe.lastIndex = 0;
      }
      if (offset > mainEnd) {
        pattern.lastIndex = offset;
      }
    }
  }

  return results;
}
