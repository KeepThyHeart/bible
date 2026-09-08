/**
 * Shared verse-range fetch cache.
 *
 * This started life as a private `Map` inside `VersePreviewTooltip`. It is
 * shared now because the hover preview and the notes-editor verse expansion
 * ask for exactly the same ranges: once the user has hovered (or previewed)
 * a reference, expanding it does zero IPC and lands instantly.
 *
 * The cache is unbounded and process-lifetime, matching the previous
 * behaviour. Verse text is immutable reference data, so there is nothing to
 * invalidate; a note-sized working set is a few hundred entries at most.
 */
import { bibleAPI } from './electronAPI';

/** The shape `bible:getVerses` returns. */
export interface CachedVerse {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html?: string;
  is_paragraph_start?: boolean;
}

const cache = new Map<string, CachedVerse[]>();

/** Cache key for a translation + inclusive verse-id range. */
export function verseCacheKey(version: string, startId: number, endId: number): string {
  return `${version}:${startId}-${endId}`;
}

/**
 * Fetch an inclusive verse-id range, serving from cache when possible.
 *
 * Empty results are cached too: a well-formed but non-existent reference
 * (`Genesis 99:1` parses fine) should not re-hit IPC every time the user
 * hovers or presses a key on it.
 *
 * Fetch errors are *not* cached - they propagate so callers can distinguish
 * "no such verse" from "the fetch failed".
 */
export async function getVersesCached(
  version: string,
  startId: number,
  endId: number,
): Promise<CachedVerse[]> {
  const key = verseCacheKey(version, startId, endId);
  const hit = cache.get(key);
  if (hit) return hit;

  const verses = (await bibleAPI.getVerses(version, startId, endId)) ?? [];
  cache.set(key, verses);
  return verses;
}

/** True when the range is already cached, i.e. a read would not hit IPC. */
export function isVerseRangeCached(version: string, startId: number, endId: number): boolean {
  return cache.has(verseCacheKey(version, startId, endId));
}

/**
 * Seed the cache directly. Used by callers with their own fallback fetch
 * (the hover tooltip retries a single verse when a range comes back empty)
 * so the fallback result is reused like any other.
 */
export function primeVerseCache(
  version: string,
  startId: number,
  endId: number,
  verses: CachedVerse[],
): void {
  cache.set(verseCacheKey(version, startId, endId), verses);
}

/** Test-only. */
export function __clearVerseFetchCache(): void {
  cache.clear();
}
