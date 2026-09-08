/** John 3:16 - used as default starting verse throughout the app */
export const DEFAULT_VERSE_ID = 43003016;

/**
 * Module abbreviation of the commentary opened on a fresh profile.
 *
 * The AI-synthesized commentary ships with every build (see
 * scripts/stage-build-data.js), so it is the only safe cross-tradition
 * default. Lean builds that omit it fall back to the first available
 * commentary - see `pickDefaultCommentary` in services/AppInitService.
 */
export const DEFAULT_COMMENTARY_ABBREVIATION = 'SYNTHESIS';

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
