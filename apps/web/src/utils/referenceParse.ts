/**
 * Book-reference parsing shared by the Study header, the search store and the
 * Presenter's command box. Lives in `utils/` (not `components/Header`) so the
 * Presenter chunk does not pull the whole Study header; `components/Header`
 * re-exports everything here for existing importers.
 */
import { getAllBookNames, getLocalizedBookName } from './bookNames';
import { localizedBookAliases } from '../constants';
import type { Localizer } from '@bible/core/browser';

/**
 * Where the "current chapter" for quick verse jumps ("5", "17:5") comes from. Study's header
 * registers `bibleStore.getActiveTab` (this module must not import Study stores); with no source
 * (e.g. the Presenter) only full references parse.
 */
let activeTabSource: (() => { book?: number | null; chapter?: number | null } | undefined) | null = null;

export function setActiveTabSource(fn: (() => { book?: number | null; chapter?: number | null } | undefined) | null): void {
  activeTabSource = fn;
}

/**
 * Common abbreviation mappings (lowercase).
 *
 * Exported so other code that needs to recognise a book name -- the
 * presenter's paste-to-detect-references scanner (`present/referenceScan.ts`)
 * is the one other caller today -- has one table to consult rather than a
 * second copy invented for it.
 */
export const BOOK_ABBREV_MAP: Record<string, number> = {
  'gen': 1, 'exo': 2, 'exod': 2, 'exodus': 2, 'lev': 3, 'num': 4, 'deu': 5, 'deut': 5,
  'jos': 6, 'josh': 6, 'jdg': 7, 'judg': 7, 'judges': 7, 'rut': 8, 'ruth': 8,
  'ps': 19, 'psa': 19, 'psalm': 19, 'psalms': 19, 'pro': 20, 'prov': 20, 'proverbs': 20,
  'ecc': 21, 'eccl': 21, 'eccles': 21, 'ecclesiastes': 21,
  'isa': 23, 'isaiah': 23, 'jer': 24, 'jeremiah': 24, 'lam': 25, 'eze': 26, 'ezek': 26,
  'dan': 27, 'daniel': 27, 'hos': 28, 'hosea': 28, 'joe': 29, 'joel': 29,
  'amo': 30, 'amos': 30, 'oba': 31, 'obad': 31, 'jon': 32, 'jonah': 32,
  'mic': 33, 'micah': 33, 'nah': 34, 'nahum': 34, 'hab': 35, 'zep': 36, 'zeph': 36,
  'hag': 37, 'zec': 38, 'zech': 38, 'mal': 39, 'malachi': 39,
  'mat': 40, 'matt': 40, 'matthew': 40, 'mar': 41, 'mk': 41, 'mark': 41,
  'luk': 42, 'lk': 42, 'luke': 42, 'joh': 43, 'jn': 43, 'john': 43,
  'act': 44, 'acts': 44, 'rom': 45, 'romans': 45,
  'gal': 48, 'galatians': 48, 'eph': 49, 'ephesians': 49,
  'phi': 50, 'php': 50, 'philippians': 50, 'col': 51, 'colossians': 51,
  'tit': 56, 'titus': 56, 'phm': 57, 'philemon': 57, 'heb': 58, 'hebrews': 58,
  'jam': 59, 'jas': 59, 'james': 59, 'jud': 65, 'jude': 65, 'rev': 66, 'revelation': 66,
  // Numbered books with various prefix styles
  '1sa': 9, '1sam': 9, '1 sam': 9, '1 samuel': 9, 'i sam': 9, 'i samuel': 9,
  '2sa': 10, '2sam': 10, '2 sam': 10, '2 samuel': 10, 'ii sam': 10, 'ii samuel': 10,
  '1ki': 11, '1kgs': 11, '1 ki': 11, '1 kings': 11, 'i ki': 11, 'i kings': 11,
  '2ki': 12, '2kgs': 12, '2 ki': 12, '2 kings': 12, 'ii ki': 12, 'ii kings': 12,
  '1ch': 13, '1chr': 13, '1 chr': 13, '1 chronicles': 13, 'i chr': 13, 'i chronicles': 13,
  '2ch': 14, '2chr': 14, '2 chr': 14, '2 chronicles': 14, 'ii chr': 14, 'ii chronicles': 14,
  '1co': 46, '1cor': 46, '1 cor': 46, '1 corinthians': 46, 'i cor': 46, 'i corinthians': 46,
  '2co': 47, '2cor': 47, '2 cor': 47, '2 corinthians': 47, 'ii cor': 47, 'ii corinthians': 47,
  '1th': 52, '1thess': 52, '1 thess': 52, '1 thessalonians': 52, 'i thess': 52,
  '2th': 53, '2thess': 53, '2 thess': 53, '2 thessalonians': 53, 'ii thess': 53,
  '1ti': 54, '1tim': 54, '1 tim': 54, '1 timothy': 54, 'i tim': 54, 'i timothy': 54,
  '2ti': 55, '2tim': 55, '2 tim': 55, '2 timothy': 55, 'ii tim': 55, 'ii timothy': 55,
  '1pe': 60, '1pet': 60, '1 pet': 60, '1 peter': 60, 'i pet': 60, 'i peter': 60,
  '2pe': 61, '2pet': 61, '2 pet': 61, '2 peter': 61, 'ii pet': 61, 'ii peter': 61,
  '1jo': 62, '1john': 62, '1 john': 62, 'i john': 62,
  '2jo': 63, '2john': 63, '2 john': 63, 'ii john': 63,
  '3jo': 64, '3john': 64, '3 john': 64, 'iii john': 64,
};

/**
 * The candidate table {@link parseReference} and {@link fuzzyMatchReference}
 * match against: this file's own English abbreviations ({@link BOOK_ABBREV_MAP})
 * plus the active locale's own book-name/abbreviation table (English merged in
 * underneath — see `constants.ts`'s `localizedBookAliases`). English input
 * keeps parsing in every locale; a locale's own abbreviations ("Jn", "Gn")
 * additionally parse once the UI locale is switched to it. Exported so
 * `searchStore.ts` — a plain store, not a component — can build the same
 * table without a hook.
 */
export function headerBookAliases(localizer: Localizer): Record<string, number> {
  return { ...BOOK_ABBREV_MAP, ...localizedBookAliases(localizer) };
}

/**
 * Damerau-Levenshtein distance (counts transpositions as single edit).
 */
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    d[i] = new Array<number>(n + 1);
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Try to fuzzy-match a book name part against known book names/abbreviations.
 * Returns { book, rest } if a match is found, or null.
 * `rest` is the remaining string after the matched book name (e.g., "3:16").
 */
function fuzzyMatchReference(input: string, bookAliases: Record<string, number>): { book: number; rest: string; matchedName: string } | null {
  const lowerInput = input.toLowerCase();

  // Build candidate list from i18n book names and the locale-aware alias table
  const candidates: Array<{ name: string; bookNum: number }> = [];
  for (const [numStr, name] of Object.entries(getAllBookNames())) {
    candidates.push({ name: name.toLowerCase(), bookNum: parseInt(numStr, 10) });
  }
  for (const [abbr, bookNum] of Object.entries(bookAliases)) {
    candidates.push({ name: abbr, bookNum });
  }

  // Try to split input into bookPart + rest (where rest starts with a digit)
  // e.g., "jonh 3:16" → bookPart="jonh", rest="3:16"
  const splitMatch = lowerInput.match(/^([a-z]+(?:\s+[a-z]+)*)\s+(\d.*)$/i)
    || lowerInput.match(/^(\d+\s*[a-z]+)\s+(\d.*)$/i);
  if (!splitMatch) return null;

  const bookPart = splitMatch[1].trim();
  const rest = splitMatch[2].trim();

  // Only fuzzy match if rest looks like chapter[:verse[-verse]]. The range tail
  // has to be allowed here too, or "jonh 3:16-18" is rejected before the
  // caller's range-aware pattern ever sees it.
  if (!/^\d+(?::\d+(?:\s*[-–—]\s*\d+)?)?$/.test(rest)) return null;

  // Skip very short book parts — too ambiguous for fuzzy matching
  if (bookPart.length <= 2) return null;

  let bestCandidate: { name: string; bookNum: number } | null = null;
  let bestDistance = Infinity;
  let bestOverlap = -1;
  let bestLenDiff = Infinity;

  for (const cand of candidates) {
    if (cand.name.length <= 2) continue;

    const distance = damerauLevenshtein(bookPart, cand.name);
    const maxDistance = Math.min(2, Math.floor(bookPart.length / 2));
    if (distance > maxDistance || distance === 0) continue; // distance 0 = exact match, already handled

    // Tiebreakers: character overlap, then length similarity
    let overlap = 0;
    const countA = new Map<string, number>();
    for (const ch of bookPart) countA.set(ch, (countA.get(ch) ?? 0) + 1);
    for (const ch of cand.name) {
      const rem = countA.get(ch) ?? 0;
      if (rem > 0) { overlap++; countA.set(ch, rem - 1); }
    }
    const lenDiff = Math.abs(bookPart.length - cand.name.length);

    const isBetter =
      distance < bestDistance ||
      (distance === bestDistance && overlap > bestOverlap) ||
      (distance === bestDistance && overlap === bestOverlap && lenDiff < bestLenDiff);

    if (isBetter) {
      bestDistance = distance;
      bestOverlap = overlap;
      bestLenDiff = lenDiff;
      bestCandidate = cand;
    }
  }

  if (bestCandidate) {
    return { book: bestCandidate.bookNum, rest, matchedName: bestCandidate.name };
  }
  return null;
}

export function parseReference(input: string, bookAliases: Record<string, number> = BOOK_ABBREV_MAP): { book: number; chapter: number; verse?: number; endVerse?: number; fuzzyMatch?: boolean; correctedBookName?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // First try the full book names from i18n
  const bookEntries = Object.entries(getAllBookNames());
  for (const [numStr, name] of bookEntries) {
    const bookNum = parseInt(numStr, 10);
    const lowerName = name.toLowerCase();
    const lowerInput = trimmed.toLowerCase();
    const abbrevs = [lowerName, lowerName.substring(0, 3)];
    if (/^\d/.test(lowerName)) {
      abbrevs.push(lowerName.replace(' ', ''));
    }
    for (const abbr of abbrevs) {
      if (lowerInput.startsWith(abbr)) {
        const rest = trimmed.substring(abbr.length).trim();
        const match = rest.match(/^(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
        if (match) {
          return {
            book: bookNum,
            chapter: parseInt(match[1], 10),
            verse: match[2] ? parseInt(match[2], 10) : undefined,
            endVerse: match[3] ? parseInt(match[3], 10) : undefined,
          };
        }
        if (!rest) return { book: bookNum, chapter: 1 };
      }
    }
  }

  // Try the alias table (this file's English abbreviations, plus the active
  // locale's own — see headerBookAliases) - sort by longest match first to
  // avoid partial matches.
  const lowerInput = trimmed.toLowerCase();
  const sortedAbbrevs = Object.keys(bookAliases).sort((a, b) => b.length - a.length);
  for (const abbr of sortedAbbrevs) {
    if (lowerInput.startsWith(abbr)) {
      const rest = trimmed.substring(abbr.length).trim();
      const match = rest.match(/^(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
      if (match) {
        return {
          book: bookAliases[abbr],
          chapter: parseInt(match[1], 10),
          verse: match[2] ? parseInt(match[2], 10) : undefined,
          endVerse: match[3] ? parseInt(match[3], 10) : undefined,
        };
      }
      if (!rest) return { book: bookAliases[abbr], chapter: 1 };
    }
  }

  // Try fuzzy matching as a fallback for typos like "jonh 3:16"
  const fuzzy = fuzzyMatchReference(trimmed, bookAliases);
  if (fuzzy) {
    const match = fuzzy.rest.match(/^(\d+)(?::(\d+)(?:\s*[-–—]\s*(\d+))?)?$/);
    if (match) {
      const correctedName = getLocalizedBookName(fuzzy.book);
      return {
        book: fuzzy.book,
        chapter: parseInt(match[1], 10),
        verse: match[2] ? parseInt(match[2], 10) : undefined,
        endVerse: match[3] ? parseInt(match[3], 10) : undefined,
        fuzzyMatch: true,
        correctedBookName: correctedName,
      };
    }
  }

  const numMatch = trimmed.match(/^(\d+)\s+(\d+)(?:\s+(\d+))?$/);
  if (numMatch) {
    return {
      book: parseInt(numMatch[1], 10),
      chapter: parseInt(numMatch[2], 10),
      verse: numMatch[3] ? parseInt(numMatch[3], 10) : undefined,
    };
  }

  // Quick verse jump: "5" → verse 5 of current chapter, "17:5" → chapter 17 verse 5
  const tab = activeTabSource?.();
  if (tab?.book && tab?.chapter) {
    const chapterVerseMatch = trimmed.match(/^(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (chapterVerseMatch) {
      return {
        book: tab.book,
        chapter: parseInt(chapterVerseMatch[1], 10),
        verse: parseInt(chapterVerseMatch[2], 10),
        endVerse: chapterVerseMatch[3] ? parseInt(chapterVerseMatch[3], 10) : undefined,
      };
    }
    const verseOnlyMatch = trimmed.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
    if (verseOnlyMatch) {
      return {
        book: tab.book,
        chapter: tab.chapter,
        verse: parseInt(verseOnlyMatch[1], 10),
        endVerse: verseOnlyMatch[2] ? parseInt(verseOnlyMatch[2], 10) : undefined,
      };
    }
  }

  return null;
}
