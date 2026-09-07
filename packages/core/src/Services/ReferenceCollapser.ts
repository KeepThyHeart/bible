import { VerseId, VerseIdHelper } from '../Data/Core/Types';

/** Book name format for collapsed reference output. Defined in BookNames.ts. */
export type { BookNameFormat } from '../Data/Core/BookNames';

import type { BookNameFormat } from '../Data/Core/BookNames';

export interface CollapseOptions {
  /** Book name format. Default: 'long' */
  format?: BookNameFormat;
  /** Separator between different books. Default: '; ' */
  bookSeparator?: string;
  /** Separator between references within the same book/chapter. Default: ', ' */
  verseSeparator?: string;
}

// The name tables and `getBookName` live in Data/Core/BookNames.ts - the
// single source of truth for the repo. Re-exported so existing
// `import { getBookName } from '.../ReferenceCollapser'` call sites still work.
export { getBookName } from '../Data/Core/BookNames';

import { ENGLISH_SINGLE_CHAPTER_BOOKS as SINGLE_CHAPTER_BOOKS } from '../Data/Core/BookNames';
import { getBookName } from '../Data/Core/BookNames';

interface VerseRef {
  bookNumber: number;
  chapter: number;
  verse: number;
}

/**
 * Collapse an array of verse IDs into a compact, human-readable reference string,
 * similar to how TSK (Treasury of Scripture Knowledge) formats cross-references.
 *
 * Consecutive verses within the same chapter are collapsed into ranges.
 * References within the same book share the book name.
 * Different books are separated by semicolons.
 *
 * @example
 * ```typescript
 * const ids = [44001002, 44001004, 44001005, 45002003, 45004005];
 *
 * collapseReferences(ids);
 * // "Acts 1:2, 4-5; Romans 2:3, 4:5"
 *
 * collapseReferences(ids, { format: 'short' });
 * // "Ac 1:2, 4-5; Ro 2:3, 4:5"
 *
 * collapseReferences(ids, { format: 'medium' });
 * // "Acts 1:2, 4-5; Rom 2:3, 4:5"
 * ```
 */
export function collapseReferences(verseIds: VerseId[], options?: CollapseOptions): string {
  if (verseIds.length === 0) return '';

  const format = options?.format ?? 'long';
  const bookSep = options?.bookSeparator ?? '; ';
  const verseSep = options?.verseSeparator ?? ', ';

  // Parse and sort
  const refs: VerseRef[] = verseIds
    .filter(id => VerseIdHelper.isValid(id))
    .map(id => VerseIdHelper.parse(id))
    .sort((a, b) => {
      if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });

  if (refs.length === 0) return '';

  // Remove exact duplicates
  const deduped: VerseRef[] = [refs[0]];
  for (let i = 1; i < refs.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = refs[i];
    if (curr.bookNumber !== prev.bookNumber || curr.chapter !== prev.chapter || curr.verse !== prev.verse) {
      deduped.push(curr);
    }
  }

  // Group by book, preserving order
  const bookGroups: { bookNumber: number; refs: VerseRef[] }[] = [];
  let currentBook = -1;
  for (const ref of deduped) {
    if (ref.bookNumber !== currentBook) {
      bookGroups.push({ bookNumber: ref.bookNumber, refs: [] });
      currentBook = ref.bookNumber;
    }
    bookGroups[bookGroups.length - 1].refs.push(ref);
  }

  const bookParts: string[] = [];
  for (const group of bookGroups) {
    const bookName = getBookName(group.bookNumber, format);
    bookParts.push(formatBookGroup(bookName, group.refs, verseSep, group.bookNumber));
  }

  return bookParts.join(bookSep);
}

/**
 * Format all references within a single book.
 * Groups by chapter, collapses consecutive verses into ranges.
 */
function formatBookGroup(bookName: string, refs: VerseRef[], verseSep: string, bookNumber: number): string {
  // Group by chapter, preserving order
  const chapterGroups: { chapter: number; verses: number[] }[] = [];
  let currentChapter = -1;
  for (const ref of refs) {
    if (ref.chapter !== currentChapter) {
      chapterGroups.push({ chapter: ref.chapter, verses: [] });
      currentChapter = ref.chapter;
    }
    chapterGroups[chapterGroups.length - 1].verses.push(ref.verse);
  }

  const parts: string[] = [];
  let lastChapter = -1;

  for (const cg of chapterGroups) {
    const ranges = collapseConsecutive(cg.verses);
    const rangeStr = ranges.map(r => r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`).join(verseSep);

    const isSingleChapter = SINGLE_CHAPTER_BOOKS.has(bookNumber);
    if (lastChapter === -1) {
      // First chapter group: include book name
      parts.push(isSingleChapter ? `${bookName} ${rangeStr}` : `${bookName} ${cg.chapter}:${rangeStr}`);
    } else if (cg.chapter !== lastChapter) {
      // New chapter within same book: just chapter:verses
      parts.push(isSingleChapter ? rangeStr : `${cg.chapter}:${rangeStr}`);
    } else {
      // Same chapter continuation (shouldn't happen with proper grouping, but defensive)
      parts.push(rangeStr);
    }
    lastChapter = cg.chapter;
  }

  return parts.join(verseSep);
}

/**
 * A segment in structured collapsed output.
 * - 'ref' segments are clickable references with a display label and verse ID(s).
 * - 'sep' segments are separator text ("; " or ", ").
 */
export type CollapsedSegment =
  | { type: 'ref'; label: string; verseId: VerseId; endVerseId?: VerseId }
  | { type: 'sep'; text: string };

/**
 * Like {@link collapseReferences}, but returns structured segments instead of a flat string.
 * Each reference segment carries the verse ID(s) needed for click/hover handling.
 *
 * @example
 * ```typescript
 * const segments = collapseReferencesStructured([44001002, 44001004, 44001005, 45002003]);
 * // [
 * //   { type: 'ref', label: 'Acts 1:2', verseId: 44001002 },
 * //   { type: 'sep', text: ', ' },
 * //   { type: 'ref', label: '4-5', verseId: 44001004, endVerseId: 44001005 },
 * //   { type: 'sep', text: '; ' },
 * //   { type: 'ref', label: 'Romans 2:3', verseId: 45002003 },
 * // ]
 * ```
 */
export function collapseReferencesStructured(
  verseIds: VerseId[],
  options?: CollapseOptions
): CollapsedSegment[] {
  if (verseIds.length === 0) return [];

  const format = options?.format ?? 'long';
  const bookSep = options?.bookSeparator ?? '; ';
  const verseSep = options?.verseSeparator ?? ', ';

  // Parse, sort, deduplicate (same as collapseReferences)
  const refs: VerseRef[] = verseIds
    .filter(id => VerseIdHelper.isValid(id))
    .map(id => VerseIdHelper.parse(id))
    .sort((a, b) => {
      if (a.bookNumber !== b.bookNumber) return a.bookNumber - b.bookNumber;
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      return a.verse - b.verse;
    });

  if (refs.length === 0) return [];

  const deduped: VerseRef[] = [refs[0]];
  for (let i = 1; i < refs.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = refs[i];
    if (curr.bookNumber !== prev.bookNumber || curr.chapter !== prev.chapter || curr.verse !== prev.verse) {
      deduped.push(curr);
    }
  }

  // Group by book
  const bookGroups: { bookNumber: number; refs: VerseRef[] }[] = [];
  let currentBook = -1;
  for (const ref of deduped) {
    if (ref.bookNumber !== currentBook) {
      bookGroups.push({ bookNumber: ref.bookNumber, refs: [] });
      currentBook = ref.bookNumber;
    }
    bookGroups[bookGroups.length - 1].refs.push(ref);
  }

  const segments: CollapsedSegment[] = [];

  for (let bi = 0; bi < bookGroups.length; bi++) {
    if (bi > 0) segments.push({ type: 'sep', text: bookSep });

    const group = bookGroups[bi];
    const bookName = getBookName(group.bookNumber, format);

    // Group by chapter within this book
    const chapterGroups: { chapter: number; refs: VerseRef[] }[] = [];
    let curChap = -1;
    for (const ref of group.refs) {
      if (ref.chapter !== curChap) {
        chapterGroups.push({ chapter: ref.chapter, refs: [] });
        curChap = ref.chapter;
      }
      chapterGroups[chapterGroups.length - 1].refs.push(ref);
    }

    let isFirstInBook = true;
    for (let ci = 0; ci < chapterGroups.length; ci++) {
      const cg = chapterGroups[ci];
      const ranges = collapseConsecutive(cg.refs.map(r => r.verse));

      for (let ri = 0; ri < ranges.length; ri++) {
        if (!isFirstInBook) segments.push({ type: 'sep', text: verseSep });
        isFirstInBook = false;

        const [startVerse, endVerse] = ranges[ri];
        const startId = VerseIdHelper.calculate(group.bookNumber, cg.chapter, startVerse);
        const endId = startVerse !== endVerse
          ? VerseIdHelper.calculate(group.bookNumber, cg.chapter, endVerse)
          : undefined;

        // Build the label
        let label: string;
        const isSingleChapter = SINGLE_CHAPTER_BOOKS.has(group.bookNumber);
        if (ci === 0 && ri === 0) {
          // First range in the book - include book name (and chapter unless single-chapter)
          if (isSingleChapter) {
            label = startVerse === endVerse
              ? `${bookName} ${startVerse}`
              : `${bookName} ${startVerse}-${endVerse}`;
          } else {
            label = startVerse === endVerse
              ? `${bookName} ${cg.chapter}:${startVerse}`
              : `${bookName} ${cg.chapter}:${startVerse}-${endVerse}`;
          }
        } else if (ri === 0) {
          // First range of a new chapter (same book) - include chapter
          label = startVerse === endVerse
            ? `${cg.chapter}:${startVerse}`
            : `${cg.chapter}:${startVerse}-${endVerse}`;
        } else {
          // Subsequent range in same chapter - just verse(s)
          label = startVerse === endVerse
            ? `${startVerse}`
            : `${startVerse}-${endVerse}`;
        }

        segments.push({ type: 'ref', label, verseId: startId, endVerseId: endId });
      }
    }
  }

  return segments;
}

/**
 * Collapse sorted verse numbers into [start, end] range tuples.
 * E.g., [1, 2, 3, 5, 7, 8] -> [[1,3], [5,5], [7,8]]
 */
function collapseConsecutive(verses: number[]): [number, number][] {
  if (verses.length === 0) return [];

  const ranges: [number, number][] = [[verses[0], verses[0]]];
  for (let i = 1; i < verses.length; i++) {
    const last = ranges[ranges.length - 1];
    if (verses[i] === last[1] + 1) {
      last[1] = verses[i];
    } else {
      ranges.push([verses[i], verses[i]]);
    }
  }
  return ranges;
}
