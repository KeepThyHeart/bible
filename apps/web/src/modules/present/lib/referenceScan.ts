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

import { getAllBookNames } from '../../../utils/bookNames';
import { BOOK_ABBREV_MAP } from '../../../utils/referenceParse';

export interface ScannedReference {
  book: number;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  /** The exact text this was read from (whitespace collapsed), for showing the presenter what matched. */
  matchedText: string;
  /** Where `matchedText` sits in the scanned text: half-open offsets into the original string. */
  from: number;
  to: number;
  /** The book name as written ("Rom", "1 Pet"), whitespace collapsed. */
  bookText: string;
  /**
   * Set on every part after the first of one written reference: the `6` of
   * `Psalm 23:1-3, 6`, the `14:27` of `John 14:1–3; 14:27`. Its text holds no
   * book name, so a label has to be built from `bookText`.
   */
  listed?: boolean;
  /** Parts read from one written reference share this number (in scan order). */
  group: number;
}

export interface ScanOptions {
  /**
   * Keep exact repeats (same book, chapter and verses) instead of dropping
   * them: the notes detector wants every occurrence, with its position.
   */
  keepDuplicates?: boolean;
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

/** A verse number that is not the start of a longer number or of a chapter:verse. */
const VERSE = String.raw`(\d{1,3})(?!\d|[:.]\d)`;
const DASH = String.raw`\s*[-–—]\s*`;

/**
 * A chapter, and optional verse(s), starting right where the book name left
 * off. Chapter and verse are split by `:` or by a `.` with a digit straight
 * after it (`Jn 3.16`), so a sentence end -- "see John 3. 16 people came" --
 * stays a bare chapter. A range end followed by `:` is the start of a
 * cross-chapter range (`3:16–4:2`), which is read as just its first verse.
 */
const LOCATION_RE = new RegExp(String.raw`^\.?\s*(\d{1,3})(?:(?::|\.(?=\d))(\d{1,3})(?!\d)(?:${DASH}${VERSE})?)?`);

/** `, 6` or `, 6-8` after a verse: more verses in the same chapter. */
const COMMA_PART_RE = new RegExp(String.raw`^\s*,\s*(\d{1,3})(?!\d|\s*[:.]\d)(?:${DASH}${VERSE})?`);

/** `; 14:27` after a reference: another chapter:verse in the same book. */
const SEMICOLON_PART_RE = new RegExp(String.raw`^\s*;\s*(\d{1,3})(?::|\.(?=\d))(\d{1,3})(?!\d)(?:${DASH}${VERSE})?`);

/**
 * What may follow a comma-list verse for it to count: the end of the line,
 * punctuation, a bracket, a dash, `and`/`or`, or an all-capitals translation code.
 * Anything else ("Romans 8:28, 3 times") means the number was prose.
 */
const AFTER_LIST_RE = /^[ \t]*(?:$|[\n,;.!?)\]([–—]|-\s|\b(?:and|or)\b|[A-Z][A-Z0-9]{1,9}\b)/;

interface Part {
  from: number;
  to: number;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  listed: boolean;
}

/** Read a verse range from match groups, or null when it runs backwards. */
function verses(startText: string | undefined, endText: string | undefined): { verseStart?: number; verseEnd?: number } | null {
  if (startText === undefined) return {};
  const verseStart = Number(startText);
  const verseEnd = endText !== undefined ? Number(endText) : undefined;
  if (verseEnd !== undefined && verseEnd < verseStart) return null;
  return verseEnd !== undefined ? { verseStart, verseEnd } : { verseStart };
}

/**
 * The parts of one written reference after its book name: the first location,
 * then any `, 6` verse lists and `; 14:27` continuations. Contiguous verses in
 * a comma list merge (`26:3,4` is 3-4); others are separate parts.
 */
function readParts(text: string, at: number): Part[] {
  const location = LOCATION_RE.exec(text.slice(at));
  if (!location) return [];
  const chapter = Number(location[1]);
  if (chapter < 1) return [];
  const first = verses(location[2], location[3]);
  if (!first) return [];

  const parts: Part[] = [{ from: at, to: at + location[0].length, chapter, ...first, listed: false }];
  let cursor = at + location[0].length;

  for (;;) {
    const last = parts[parts.length - 1];
    const rest = text.slice(cursor);
    const comma = last.verseStart !== undefined ? COMMA_PART_RE.exec(rest) : null;
    if (comma && AFTER_LIST_RE.test(rest.slice(comma[0].length))) {
      const range = verses(comma[1], comma[2]);
      if (!range) break;
      const from = cursor + comma[0].length - comma[0].replace(/^\s*,\s*/, '').length;
      const to = cursor + comma[0].length;
      const lastEnd = last.verseEnd ?? last.verseStart!;
      if (range.verseStart! >= last.verseStart! && range.verseStart! <= lastEnd + 1) {
        // Contiguous (or overlapping): one range.
        last.verseEnd = Math.max(lastEnd, range.verseEnd ?? range.verseStart!);
        last.to = to;
      } else {
        parts.push({ from, to, chapter: last.chapter, ...range, listed: true });
      }
      cursor = to;
      continue;
    }
    const semi = SEMICOLON_PART_RE.exec(rest);
    if (semi) {
      const range = verses(semi[2], semi[3]);
      const partChapter = Number(semi[1]);
      if (!range || partChapter < 1) break;
      const from = cursor + semi[0].length - semi[0].replace(/^\s*;\s*/, '').length;
      const to = cursor + semi[0].length;
      parts.push({ from, to, chapter: partChapter, ...range, listed: true });
      cursor = to;
      continue;
    }
    break;
  }
  return parts;
}

/**
 * Scan `text` for every recognisable Bible reference, in the order they
 * appear, with exact duplicates (same book, chapter and verse range) removed
 * unless `keepDuplicates` is set. A list in one reference (`Psalm 23:1-3, 6`,
 * `John 14:1–3; 14:27`) gives one result per part.
 */
export function scanReferences(text: string, options: ScanOptions = {}): ScannedReference[] {
  const { regex, books } = buildBookPattern();
  const out: ScannedReference[] = [];
  const seen = new Set<string>();
  let group = 0;

  for (const match of text.matchAll(regex)) {
    const book = books.get(match[0].toLowerCase().trim().replace(/\s+/g, ' '));
    if (book === undefined) continue;

    const bookFrom = match.index;
    const parts = readParts(text, bookFrom + match[0].length);
    if (!parts.length) continue;
    const bookText = match[0].replace(/\s+/g, ' ').trim();

    for (const part of parts) {
      const key = `${book}/${part.chapter}/${part.verseStart ?? ''}/${part.verseEnd ?? ''}`;
      if (!options.keepDuplicates && seen.has(key)) continue;
      seen.add(key);
      const from = part.listed ? part.from : bookFrom;
      const ref: ScannedReference = {
        book, chapter: part.chapter, verseStart: part.verseStart, verseEnd: part.verseEnd,
        matchedText: text.slice(from, part.to).replace(/\s+/g, ' ').trim(),
        from, to: part.to, bookText, group,
      };
      if (part.listed) ref.listed = true;
      out.push(ref);
    }
    group++;
  }

  return out;
}
