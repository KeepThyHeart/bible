/** Small pure helpers for quiz scopes and catalogs. */
import type { QuizCatalog, QuizChapterCoverage, QuizPassage } from './types';

/** A whole chapter (verse 999 = "to the end"; ranges are inclusive). */
export function chapterPassage(book: number, chapter: number): QuizPassage {
  const base = book * 1_000_000 + chapter * 1_000;
  return { start: base + 1, end: base + 999 };
}

/** Whole chapters `from`..`to` of one book. */
export function chaptersPassage(book: number, from: number, to: number): QuizPassage {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return { start: chapterPassage(book, lo).start, end: chapterPassage(book, hi).end };
}

/** Questions in a chapter according to the catalog (0 when none). */
export function coverageFor(catalog: QuizCatalog | null | undefined, book: number, chapter: number): number {
  return catalog?.coverage.find((c) => c.book === book && c.chapter === chapter)?.count ?? 0;
}

/** Merges per-module coverage lists, summing counts per chapter, sorted. */
export function mergeCoverage(lists: QuizChapterCoverage[][]): QuizChapterCoverage[] {
  const sum = new Map<number, QuizChapterCoverage>();
  for (const list of lists) {
    for (const c of list) {
      const k = c.book * 1000 + c.chapter;
      const prev = sum.get(k);
      if (prev) prev.count += c.count;
      else sum.set(k, { book: c.book, chapter: c.chapter, count: c.count });
    }
  }
  return [...sum.values()].sort((a, b) => a.book - b.book || a.chapter - b.chapter);
}

/** Merges several catalogs (modules concatenated, de-duplicated by uuid). */
export function mergeCatalogs(catalogs: QuizCatalog[]): QuizCatalog {
  const seen = new Set<string>();
  const modules = catalogs.flatMap((c) => c.modules).filter((m) => (seen.has(m.uuid) ? false : (seen.add(m.uuid), true)));
  return { modules, coverage: mergeCoverage(catalogs.map((c) => c.coverage)) };
}

/** The books that have any questions, in canonical order. */
export function booksWithQuestions(catalog: QuizCatalog | null | undefined): number[] {
  return [...new Set((catalog?.coverage ?? []).filter((c) => c.count > 0).map((c) => c.book))].sort((a, b) => a - b);
}

/** The chapters of a book that have questions, ascending. */
export function chaptersWithQuestions(catalog: QuizCatalog | null | undefined, book: number): number[] {
  return (catalog?.coverage ?? []).filter((c) => c.book === book && c.count > 0).map((c) => c.chapter);
}

/** Local calendar date 'YYYY-MM-DD' (for IReadingScopeProvider). */
export function localDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
