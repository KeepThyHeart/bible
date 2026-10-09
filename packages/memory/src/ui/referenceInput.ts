/**
 * Splitting pasted text into references, and consolidating a batch of them.
 *
 * Task 0004's review raised a real problem with the one-passage-at-a-time add
 * field: someone with a plan of, say, 250 verses is not going to type them in
 * one at a time. The first answer, "if the user can paste in a batch of
 * verses, one reference per line, that is sufficient for now on the UI", is
 * what `extractReferenceCandidates`'s line-splitting still does. A later
 * round asked for more: pasting "lots of text with random verse references
 * sprinkled in" - not a clean one-per-line list - should still find them, and
 * a batch that names both a range and one of its own verses ("John 3:16-17"
 * and "John 3:16") should collapse to the range, not track the same verse
 * twice.
 *
 * This module still does not try to be `reference.ts` - it has no book list
 * and no access to the host's parser, so it cannot say whether "John 3:16" is
 * real. What it adds here is a light *shape* check (does this look enough
 * like "Book chapter[:verse[-verse]]" to pull out of a longer sentence), used
 * only to find candidate spans in free text. Anything it does not recognise
 * the shape of - an abbreviation, a translated book name, "Jn 3.16" - still
 * reaches the worker exactly as before, one whole line at a time, and the
 * worker's own parser has the final say either way.
 */

/**
 * A book name shape this module knows how to spot: a leading number or roman
 * numeral for "1 Corinthians" / "II Timothy" / "3 John", the two English
 * multi-word titles ("Song of Solomon", "Song of Songs"), or a single
 * capitalised word. Deliberately not a book list - see the file header.
 */
const BOOK_SHAPE = String.raw`(?:[1-3]|I{1,3})\s?[A-Z][a-zA-Z]+|Song of (?:Solomon|Songs)|[A-Z][a-zA-Z]+`;

/**
 * "Book 12:34" or "Book 12:34-36" or a bare "Book 12" (a whole chapter).
 *
 * The trailing `(?!\.\d)` guards against truncating a reference this module
 * does not otherwise understand - "Jn 3.16" would otherwise match just "Jn
 * 3" (a bare chapter is a valid shape on its own) and silently drop the
 * ".16", turning an unparseable reference into a *wrong* one (the whole of
 * chapter 3) instead of leaving it whole for the worker to reject. A period
 * immediately followed by a digit reads as "there was more reference here
 * this module doesn't know the shape of", so the match is refused outright
 * and the line falls through to the whole-line candidate instead.
 */
const REFERENCE_SHAPE = new RegExp(
  String.raw`\b(?:${BOOK_SHAPE})\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?(?!\.\d)\b`,
  'g',
);

/**
 * Turns pasted text into a list of candidate references, one per line unless
 * a line itself names more than one ("John 3:16 and Romans 8:28 today" is one
 * line but two candidates).
 *
 * Each line is tried against `REFERENCE_SHAPE` first. A line with one or more
 * matches contributes exactly those matches - so surrounding prose on the
 * same line is dropped rather than turned into a doomed-to-fail candidate. A
 * line with none is passed through whole, unchanged, exactly as the original
 * per-line splitter did: some real references (abbreviations, translated
 * names) do not match the shape above, and the worker's own parser is the
 * only thing that gets to reject those, not this module.
 *
 * Exact repeats (case-insensitive, whitespace-trimmed) are dropped, keeping
 * the first occurrence, so a batch that names the same verse twice does not
 * show it twice in the confirmation list.
 */
export function extractReferenceCandidates(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  const found: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const matches = Array.from(line.matchAll(REFERENCE_SHAPE), (m) => m[0].replace(/\s+/g, ' ').trim());
    if (matches.length > 0) found.push(...matches);
    else found.push(line);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of found) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

/**
 * Collapses a batch down to the ranges that are not wholly covered by another
 * range in the same batch - "if John 3:16-17 is in there, John 3:16
 * separately should be ignored" (task 0004's review). Only ever compares
 * items within the array passed in: a passage that was already in the plan
 * before this paste is never a candidate for removal, since it is not part of
 * `items`.
 *
 * Ties (two items with the identical range - a reference pasted twice, or two
 * spellings that resolved to the same verses) keep whichever came first in
 * `items` and drop the rest, rather than keeping both or neither.
 */
export function dropContainedRanges<T extends { startVerseId: number; endVerseId: number }>(
  items: readonly T[],
): { kept: T[]; dropped: T[] } {
  // Larger ranges first, ties broken by original position, so a range is
  // always tested against the widest candidates before its own size class -
  // and, among equal-size ranges, the earliest one wins the tie above.
  const bySize = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rangeSize(b.item) - rangeSize(a.item) || a.index - b.index);

  const kept: T[] = [];
  const dropped: T[] = [];

  for (const { item } of bySize) {
    const coveredByKept = kept.some((k) => k !== item && covers(k, item));
    (coveredByKept ? dropped : kept).push(item);
  }

  // Restore the caller's original order for `kept`, so the confirmation list
  // and the order passages get added in are not shuffled by range size.
  const keptSet = new Set(kept);
  return { kept: items.filter((i) => keptSet.has(i)), dropped };
}

function rangeSize(r: { startVerseId: number; endVerseId: number }): number {
  return r.endVerseId - r.startVerseId;
}

/** Whether `a`'s range fully contains `b`'s range (equal ranges count). */
function covers(
  a: { startVerseId: number; endVerseId: number },
  b: { startVerseId: number; endVerseId: number },
): boolean {
  return a.startVerseId <= b.startVerseId && a.endVerseId >= b.endVerseId;
}
