/**
 * Finding every Bible reference in a block of pasted text -- a sermon
 * outline or a Word document, say -- so the presenter can pick which ones to
 * add to the running order without retyping them.
 *
 * This is deliberately not the same code as `Header.tsx`'s `parseReference`.
 * That function is built for a search box: the whole trimmed input is
 * presumed to already be a reference, and its fallbacks reflect that -- a
 * bare "3 16" or a bare "5" (a quick jump within whatever chapter is
 * currently open) are both accepted there. Turned loose on an arbitrary
 * paragraph, either fallback would light up on ordinary numbers ("in 2020, 3
 * events happened" is not John 3:16). So scanning works the other way round:
 * it looks for a *known book name or abbreviation* first, and only then for a
 * chapter (and optional verses) immediately after it. Nothing here consults
 * what the reader happens to have open.
 *
 * It does reuse the one thing worth reusing: the book-name and abbreviation
 * tables `parseReference` itself draws on (`getAllBookNames`,
 * `BOOK_ABBREV_MAP`), so a book recognised in the search box is recognised
 * here too, from one table rather than two.
 */

import { getAllBookNames } from '../utils/bookNames';
import { BOOK_ABBREV_MAP } from '../components/Header';

export interface ScannedReference {
  book: number;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  /** The exact text this was read from, for showing the presenter what matched. */
  matchedText: string;
}

/** Escape a string for use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One regex alternative per known book name or abbreviation, longest first so
 * that "1 john" is tried before a bare "john" could otherwise be found
 * starting partway through it, and with internal whitespace loosened to
 * `\s+` so a line-wrapped or doubly-spaced phrase still matches.
 */
function buildBookPattern(): { regex: RegExp; books: Map<string, number> } {
  const books = new Map<string, number>();

  const add = (phrase: string, book: number): void => {
    const key = phrase.toLowerCase().trim().replace(/\s+/g, ' ');
    if (key) books.set(key, book);
  };

  for (const [numStr, name] of Object.entries(getAllBookNames())) add(name, Number(numStr));
  for (const [abbrev, book] of Object.entries(BOOK_ABBREV_MAP)) add(abbrev, book);

  const alternatives = [...books.keys()]
    .sort((a, b) => b.length - a.length)
    .map(phrase => escapeRegExp(phrase).replace(/ /g, '\\s+'));

  return { regex: new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'gi'), books };
}

/** A chapter, and optional verse(s), starting right where the book name left off. */
const LOCATION_RE = /^\.?\s*(\d{1,3})(?::(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?/;

/**
 * Scan `text` for every recognisable Bible reference, in the order they
 * appear, with exact duplicates (same book, chapter and verse range) removed.
 */
export function scanReferences(text: string): ScannedReference[] {
  const { regex, books } = buildBookPattern();
  const out: ScannedReference[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(regex)) {
    const book = books.get(match[0].toLowerCase().trim().replace(/\s+/g, ' '));
    if (book === undefined) continue;

    const rest = text.slice(match.index + match[0].length);
    const location = LOCATION_RE.exec(rest);
    if (!location) continue;

    const chapter = Number(location[1]);
    if (chapter < 1 || chapter > 999) continue;

    const verseStart = location[2] ? Number(location[2]) : undefined;
    const verseEnd = location[3] ? Number(location[3]) : undefined;
    if (verseEnd !== undefined && verseStart !== undefined && verseEnd < verseStart) continue;

    const key = `${book}/${chapter}/${verseStart ?? ''}/${verseEnd ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      book, chapter, verseStart, verseEnd,
      matchedText: `${match[0]}${location[0]}`.replace(/\s+/g, ' ').trim(),
    });
  }

  return out;
}
