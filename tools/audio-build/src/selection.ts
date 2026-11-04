/**
 * Which chapters to render: `--books=JHN,PSA` and `--chapters=JHN.3,PSA.23-25`,
 * intersected with what the module actually contains.
 */

import { Usfm, getBookNumber } from './core';

const getUsfmBookByCode = Usfm.getUsfmBookByCode;
const getUsfmBookByNumber = Usfm.getUsfmBookByNumber;

export interface ChapterId { book: number; chapter: number }

export class SelectionError extends Error {}

/** A book as USFM code (JHN), number (43) or English name (John, 1 Corinthians). */
export function parseBook(token: string): number {
  const t = token.trim();
  if (!t) throw new SelectionError('Empty book name.');
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    if (getUsfmBookByNumber(n)) return n;
    throw new SelectionError(`"${t}" is not a book number (1-66).`);
  }
  const code = getUsfmBookByCode(t);
  if (code) return code.bookNumber;
  const named = getBookNumber(t);
  if (named) return named;
  throw new SelectionError(`"${t}" is not a book (use a code such as JHN, a number 1-66 or an English name).`);
}

export function parseBooks(spec: string): number[] {
  const out: number[] = [];
  for (const token of spec.split(',')) {
    if (!token.trim()) continue;
    const n = parseBook(token);
    if (!out.includes(n)) out.push(n);
  }
  if (out.length === 0) throw new SelectionError('--books is empty.');
  return out;
}

/** `JHN.3`, `PSA.23`, `PSA.23-25`, `JHN` (the whole book). Order is kept, duplicates dropped. */
export function parseChapters(spec: string): Array<{ book: number; chapters: number[] | 'all' }> {
  const out: Array<{ book: number; chapters: number[] | 'all' }> = [];
  for (const token of spec.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const dot = t.lastIndexOf('.');
    if (dot < 0) { out.push({ book: parseBook(t), chapters: 'all' }); continue; }
    const book = parseBook(t.slice(0, dot));
    const range = t.slice(dot + 1);
    const m = /^(\d+)(?:-(\d+))?$/.exec(range);
    if (!m) throw new SelectionError(`"${t}" is not a chapter (use e.g. JHN.3 or PSA.23-25).`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from) throw new SelectionError(`"${t}" is not a valid chapter range.`);
    const chapters: number[] = [];
    for (let c = from; c <= to; c++) chapters.push(c);
    out.push({ book, chapters });
  }
  if (out.length === 0) throw new SelectionError('--chapters is empty.');
  return out;
}

/**
 * The chapters to render, in canonical order. `available` maps each book the module
 * has to its chapter numbers. A requested chapter the module lacks is an error, not
 * a silent skip, so a typo cannot produce an empty run.
 */
export function selectChapters(
  available: ReadonlyMap<number, readonly number[]>,
  opts: { books?: string; chapters?: string },
): ChapterId[] {
  if (opts.books && opts.chapters) throw new SelectionError('Use --books or --chapters, not both.');
  const picked: ChapterId[] = [];
  if (opts.chapters) {
    for (const { book, chapters } of parseChapters(opts.chapters)) {
      const have = available.get(book);
      if (!have) throw new SelectionError(`The module has no ${bookLabel(book)}.`);
      for (const chapter of chapters === 'all' ? have : chapters) {
        if (!have.includes(chapter)) throw new SelectionError(`The module has no ${bookLabel(book)} chapter ${chapter}.`);
        picked.push({ book, chapter });
      }
    }
  } else if (opts.books) {
    for (const book of parseBooks(opts.books)) {
      const have = available.get(book);
      if (!have) throw new SelectionError(`The module has no ${bookLabel(book)}.`);
      for (const chapter of have) picked.push({ book, chapter });
    }
  } else {
    for (const [book, have] of available) for (const chapter of have) picked.push({ book, chapter });
  }
  const seen = new Set<string>();
  return picked
    .filter(c => { const k = `${c.book}.${c.chapter}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.book - b.book || a.chapter - b.chapter);
}

export const bookLabel = (book: number): string => getUsfmBookByNumber(book)?.name ?? `book ${book}`;
