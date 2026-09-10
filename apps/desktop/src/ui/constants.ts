/** John 3:16 - used as default starting verse throughout the app */
export const DEFAULT_VERSE_ID = 43003016;

/**
 * Commentaries to open on a fresh profile, most preferred first.
 *
 * All are human-authored public-domain works, so a first-run reader never
 * meets generated text they did not ask for. Gill leads because it covers the
 * whole Bible at a seventh of Matthew Henry's installed size (90 MB against
 * 632 MB); MHC follows because the default installer bundles it; Wesley is
 * last because it is the whole-Bible commentary in the development `starter`
 * set (`npm run init:modules`). Every one covers both Testaments: the fallback
 * below takes whatever is listed first, and in a starter install that was the
 * New-Testament-only Barnes, so Genesis opened on "No commentary for this
 * verse". With none installed, `pickDefaultCommentary` in
 * services/AppInitService falls back to the first available commentary.
 */
export const DEFAULT_COMMENTARY_PREFERENCE: readonly string[] = ['Gill', 'MHC', 'Wesley'];

// ---------------------------------------------------------------------------
// localStorage key constants
// ---------------------------------------------------------------------------
export const STORAGE_KEY_COMMENTARY_MUTED = 'commentary-muted';
export const STORAGE_KEY_COMMENTARY_PROMOTED = 'commentary-promoted';

/**
 * Safely read and parse a JSON array from localStorage.
 * Returns the fallback value on any error (missing key, invalid JSON, etc.).
 */
export function readLocalStorageArray<T>(key: string, fallback: T[] = []): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch (error: unknown) {
    console.warn(
      `[localStorage] Failed to read key "${key}":`,
      error instanceof Error ? error.message : String(error)
    );
    return fallback;
  }
}
