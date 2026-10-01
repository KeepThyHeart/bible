/**
 * Formatting references in a locale: book name style, the locale's own
 * separators (no locale is assumed to use ":"; it inherits it from the root
 * unless its data says otherwise) and its digits.
 *
 * No bidi isolation here: callers that place a reference inside text of the
 * other direction wrap the result (task 0076 does, with FSI/PDI), or style
 * the parts from {@link formatParts}.
 */
import type { CompiledLocale } from './compile';
import type { BookNameStyle, ReferenceFormatPart, ReferenceRange } from './types';

/** Zero code point of each Unicode numbering system we format with. */
const ZERO: Record<string, number> = {
  latn: 0x30,
  arab: 0x660,
  arabext: 0x6f0,
  deva: 0x966,
  beng: 0x9e6,
  guru: 0xa66,
  gujr: 0xae6,
  orya: 0xb66,
  tamldec: 0xbe6,
  telu: 0xc66,
  knda: 0xce6,
  mlym: 0xd66,
  thai: 0xe50,
  laoo: 0xed0,
  tibt: 0xf20,
  mymr: 0x1040,
  khmr: 0x17e0,
  fullwide: 0xff10,
};

export function toDigits(n: number, numberingSystem: string | undefined): string {
  const s = String(n);
  const zero = numberingSystem ? ZERO[numberingSystem] : undefined;
  if (zero === undefined || zero === 0x30) return s;
  let r = '';
  for (const ch of s) r += String.fromCodePoint(zero + (ch.charCodeAt(0) - 48));
  return r;
}

export interface FormatContext {
  locale: CompiledLocale;
  bookName: (book: number, style: BookNameStyle) => string;
  style: BookNameStyle;
  digits: 'latin' | 'native';
}

/** Parts for a list of ranges: grouped by book, then chapter ("John 3:16, 18; 4:1; Rom 8:28"). */
export function formatParts(ranges: readonly ReferenceRange[], ctx: FormatContext): ReferenceFormatPart[] {
  const f = ctx.locale.format;
  const ns = ctx.digits === 'native' ? f.numberingSystem : undefined;
  const num = (n: number) => toDigits(n, ns);
  const parts: ReferenceFormatPart[] = [];
  const sep = (value: string) => value && parts.push({ type: 'separator', value });

  let prev: ReferenceRange | undefined;
  for (const r of ranges) {
    const sameBook = prev && prev.book === r.book && !prev.wholeBook && !r.wholeBook;
    const prevEndChapter = prev ? (prev.endChapter ?? prev.chapter) : undefined;
    const sameChapter =
      sameBook && prev!.verse !== undefined && r.verse !== undefined && prevEndChapter === r.chapter && r.endChapter === undefined;
    if (prev) sep(sameChapter ? f.verseList : f.list);
    if (!sameBook) {
      parts.push({ type: 'book', value: ctx.bookName(r.book, ctx.style) });
      if (r.wholeBook) {
        prev = r;
        continue;
      }
      sep(f.bookGap);
    }
    if (sameChapter) {
      parts.push({ type: 'verse', value: num(r.verse!) });
    } else {
      parts.push({ type: 'chapter', value: num(r.chapter) });
      if (r.verse !== undefined) {
        sep(f.chapterVerse);
        parts.push({ type: 'verse', value: num(r.verse) });
      }
    }
    if (r.verse !== undefined && r.endVerse !== undefined) {
      if (r.endChapter !== undefined && r.endChapter !== r.chapter) {
        sep(f.range);
        parts.push({ type: 'chapter', value: num(r.endChapter) });
        sep(f.chapterVerse);
        parts.push({ type: 'verse', value: num(r.endVerse) });
      } else if (r.endVerse !== r.verse) {
        sep(f.range);
        parts.push({ type: 'verse', value: num(r.endVerse) });
      }
    } else if (r.verse === undefined && r.endChapter !== undefined && r.endChapter !== r.chapter) {
      sep(f.range);
      parts.push({ type: 'chapter', value: num(r.endChapter) });
    }
    prev = r;
  }
  return parts;
}
