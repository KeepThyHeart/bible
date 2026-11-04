import { ReadingPlans, stripBidiControls } from '@bible/core/browser';
import { getLocalizedReferenceParser } from './localizedReferenceParser';

/** Why typed text that names a real book is not a valid reference (B-039/B-040). */
export type ReferenceProblem =
  | { key: 'searchBar.reference.noChapter'; params: { book: string; count: number; chapter: number } }
  | { key: 'searchBar.reference.noVerse'; params: { book: string; chapter: number; count: number; verse: number } }
  | { key: 'searchBar.reference.needsChapter'; params: { book: string } };

/**
 * Checks a chapter/verse against the canonical (KJV) table. Returns undefined when the
 * reference exists or when the text does not name a book at all (then it is a plain search).
 */
export function checkChapterVerse(book: number, chapter: number, verse?: number): ReferenceProblem | undefined {
  const name = getLocalizedReferenceParser().getBookName(book);
  const chapters = ReadingPlans.chapterCount(book);
  if (chapters === 0) return undefined;
  if (chapter < 1 || chapter > chapters) {
    return { key: 'searchBar.reference.noChapter', params: { book: name, count: chapters, chapter } };
  }
  if (verse !== undefined) {
    const verses = ReadingPlans.versesInChapter(book, chapter);
    if (verse < 1 || verse > verses) {
      return { key: 'searchBar.reference.noVerse', params: { book: name, chapter, count: verses, verse } };
    }
  }
  return undefined;
}

const SHAPE = /^(\d?\s*\p{L}[\p{L}. ]*?)\s*(?:(\d+)(?:\s*:\s*(\d+))?)?\s*(?:[-–]\s*[\d:]+)?$/u;

/** Problem with typed text such as "Gen 0:1", "Ps 151", "John 3:999" or "1 Jn"; undefined if none. */
export function describeReferenceProblem(input: string): ReferenceProblem | undefined {
  const text = stripBidiControls(input).trim();
  const m = SHAPE.exec(text);
  if (!m) return undefined;
  const bookText = m[1]!.trim();
  const parser = getLocalizedReferenceParser();
  const hit = parser.getBookNumberFuzzy(bookText);
  if (!hit || hit.fuzzy) return undefined;
  if (m[2] === undefined) {
    // A bare book name is a fair word search; a numbered one ("1 Jn") is clearly a reference attempt.
    return /^\d/.test(bookText) ? { key: 'searchBar.reference.needsChapter', params: { book: parser.getBookName(hit.bookNumber) } } : undefined;
  }
  return checkChapterVerse(hit.bookNumber, Number(m[2]), m[3] === undefined ? undefined : Number(m[3]));
}
