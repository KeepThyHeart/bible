import type { ReferenceParseResult, ReferenceRange } from '../types';

export const LOCALE_TAGS = ['en', 'es', 'zh-Hans', 'ar', 'he', 'fa'] as const;

/** "book:chapter[:verse][-[chapter:]verse]" for one range, or "book:whole". */
export function encodeRange(r: ReferenceRange): string {
  if (r.wholeBook) return `${r.book}:whole`;
  let s = `${r.book}:${r.chapter}`;
  if (r.verse !== undefined) s += `:${r.verse}`;
  if (r.endChapter !== undefined && r.endChapter !== r.chapter) {
    s += `-${r.endChapter}`;
    if (r.endVerse !== undefined) s += `:${r.endVerse}`;
  } else if (r.endVerse !== undefined && r.endVerse !== r.verse) {
    s += `-${r.endVerse}`;
  }
  return s;
}

/** Encoding of the first range of a parse, or null when it did not parse. */
export function encodeParse(res: ReferenceParseResult): string | null {
  return res.ok ? encodeRange(res.ranges[0]) : null;
}
