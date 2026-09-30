/** The dataset's convention for "to the end of the chapter". */
export const CHAPTER_END_VERSE = 999;

export interface FormatVerseRangeOptions {
  /** Single-chapter books print "Jude 3-5" and whole-book "Jude" (no chapter number). */
  isSingleChapterBook?: (bookNumber: number) => boolean;
}

function part(id: number): { b: number; c: number; v: number } {
  return { b: Math.floor(id / 1_000_000), c: Math.floor((id % 1_000_000) / 1000), v: id % 1000 };
}

/**
 * "Genesis 1:1" / "Genesis 1:1-3" / "Genesis 1:1-2:3" from verse ids, treating verse 999 as the end of the
 * chapter: "Genesis 5:1-999" -> "Genesis 5", "Genesis 5:1-6:999" -> "Genesis 5-6",
 * "Genesis 5:3-6:999" -> "Genesis 5:3-6" (the whole of chapter 6 is included), "Genesis 5:3-999" -> "Genesis 5:3ff".
 * `bookName` supplies the (possibly localized) name.
 */
export function formatVerseIdRange(
  verseId: number,
  endVerseId: number | undefined,
  bookName: (bookNumber: number) => string,
  options: FormatVerseRangeOptions = {}
): string {
  const a = part(verseId);
  const single = options.isSingleChapterBook?.(a.b) ?? false;
  const ref = (p: { b: number; c: number; v: number }, verse: boolean) =>
    single ? (verse ? `${bookName(p.b)} ${p.v}` : bookName(p.b)) : verse ? `${bookName(p.b)} ${p.c}:${p.v}` : `${bookName(p.b)} ${p.c}`;
  const startsChapter = a.v <= 1;
  if (endVerseId === undefined || endVerseId === verseId) {
    return a.v === CHAPTER_END_VERSE ? ref(a, false) : ref(a, true);
  }
  const z = part(endVerseId);
  const endsChapter = z.v === CHAPTER_END_VERSE;
  if (z.b !== a.b) {
    const startText = ref(a, !(startsChapter && endsChapter));
    const endText = endsChapter ? ref(z, false) : ref(z, true);
    return `${startText} - ${endText}`;
  }
  if (single) {
    if (startsChapter && endsChapter) return bookName(a.b);
    return endsChapter ? `${bookName(a.b)} ${a.v}ff` : `${bookName(a.b)} ${a.v}-${z.v}`;
  }
  if (z.c === a.c) {
    if (endsChapter) return startsChapter ? ref(a, false) : `${ref(a, true)}ff`;
    return `${ref(a, true)}-${z.v}`;
  }
  if (endsChapter) return startsChapter ? `${ref(a, false)}-${z.c}` : `${ref(a, true)}-${z.c}`;
  return `${ref(a, true)}-${z.c}:${z.v}`;
}

