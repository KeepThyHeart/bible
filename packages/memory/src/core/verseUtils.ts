/**
 * Verse ids are calculated, not looked up:
 *   verseId = (book * 1000000) + (chapter * 1000) + verse
 * So John 3:16 (book 43) is 43003016.
 */
export function describeVerse(verseId: number): string {
  const book = Math.floor(verseId / 1000000);
  const chapter = Math.floor((verseId % 1000000) / 1000);
  const verse = verseId % 1000;
  return `book ${book}, ${chapter}:${verse}`;
}
