/**
 * Per-verse rendered word text, cached across the currently-mounted chapter
 * (task 0036, P0.1b).
 *
 * Needed for exactly one thing: an `occurrence`-bearing, passage-scoped
 * `kind: 'word'` target (design doc §4.2) must count matches cumulatively
 * across every verse of its scope in verse order, but `resolveVerseDecorations`
 * only ever sees one verse's rendered words (design doc §14.3's per-verse
 * contract). `useResolvedVerseDecorations` registers each verse's words here
 * as it renders, and computes the prior-match count for earlier verses of a
 * target's scope from this cache before calling the resolver.
 *
 * A plain module-level `Map`, not store state - mirrors `verseDecorationStore`'s
 * own `verseMemo` cache (`verseDecorationStore.ts`) and `verseFetchCache.ts`'s
 * "unbounded, process-lifetime" precedent (design doc §7): rendered word text
 * for a given `(moduleId, verseId)` never changes, so there is nothing to
 * invalidate.
 *
 * Ordering: this only needs to be populated for a verse's *neighbours* by the
 * time a passage-scoped occurrence target actually resolves. Verse text never
 * waits on decorations (amendment A1), so decorations - and therefore any
 * resolve that needs this cache - always arrive after the whole chapter's
 * verses have mounted and registered their words, not before.
 */

const cache = new Map<string, string[]>();

function key(moduleId: number, verseId: number): string {
  return `${moduleId}:${verseId}`;
}

export function registerVerseWords(moduleId: number, verseId: number, words: readonly { text: string }[]): void {
  cache.set(key(moduleId, verseId), words.map((w) => w.text));
}

export function getCachedVerseWords(moduleId: number, verseId: number): string[] | undefined {
  return cache.get(key(moduleId, verseId));
}

/**
 * Sums `matcher(words)` over every cached verse of `moduleId` whose verse id
 * is in `[startVerseId, endVerseIdExclusive)`. Iterates the cache's own
 * entries rather than the verse-id space itself - verse ids are BBBCCCVVV
 * integers with large arithmetic gaps at chapter/book boundaries (verse 31 of
 * a chapter is not adjacent to verse 1 of the next), so walking `vId++` across
 * a multi-chapter scope would iterate millions of non-existent ids. The
 * number of cached verses is bounded by what has actually rendered in this
 * session, which is what matters here.
 */
export function sumCachedMatches(
  moduleId: number,
  startVerseId: number,
  endVerseIdExclusive: number,
  matcher: (words: string[]) => number,
): number {
  const prefix = `${moduleId}:`;
  let sum = 0;
  for (const [k, cachedWords] of cache) {
    if (!k.startsWith(prefix)) continue;
    const verseId = Number(k.slice(prefix.length));
    if (verseId >= startVerseId && verseId < endVerseIdExclusive) sum += matcher(cachedWords);
  }
  return sum;
}

/** Test-only reset. */
export function __resetVerseWordTextCache(): void {
  cache.clear();
}
