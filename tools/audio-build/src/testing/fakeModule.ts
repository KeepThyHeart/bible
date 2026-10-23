import type { VerseText } from '../core';
import type { ModuleText } from '../moduleSource';
import type { TextRights } from '../rights';

export interface FakeBook { book: number; chapters: Record<number, string[] | Record<number, string>> }

/** A module held in memory. A chapter is an array (verses 1..n) or an object keyed by verse number (0 allowed). */
export function fakeModule(books: FakeBook[], rights: Partial<TextRights> = {}, language = 'en'): ModuleText & { texts: Map<string, VerseText[]> } {
  const texts = new Map<string, VerseText[]>();
  const chapters = new Map<number, number[]>();
  for (const b of books) {
    chapters.set(b.book, Object.keys(b.chapters).map(Number).sort((x, y) => x - y));
    for (const [c, raw] of Object.entries(b.chapters)) {
      const verses: VerseText[] = Array.isArray(raw)
        ? raw.map((text, i) => ({ verse: i + 1, text }))
        : Object.entries(raw).map(([v, text]) => ({ verse: Number(v), text }));
      texts.set(`${b.book}.${c}`, verses);
    }
  }
  return {
    abbreviation: 'TST',
    language,
    rights: { abbreviation: 'TST', fullName: 'Test Version', licenseSpdx: 'PD', publicDomain: true, ...rights },
    texts,
    chapters: () => new Map(chapters),
    verses: (book, chapter) => texts.get(`${book}.${chapter}`) ?? [],
    bookName: book => ({ 19: 'Psalms', 43: 'John', 63: '2 John' } as Record<number, string>)[book] ?? `Book ${book}`,
    close: () => {},
  };
}
