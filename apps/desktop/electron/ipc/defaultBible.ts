/**
 * Which Bible to open when nothing more specific has been asked for.
 *
 * One rule, shared by both processes so they cannot disagree: the main process
 * uses it for the startup chapter and for the Bible search opens with, and the
 * renderer (through `useBibleStore`'s `getDefaultBible`) for the first tab,
 * new passage panels and verse previews. It is pure - no Electron, no database
 * - which is what lets the renderer import it.
 *
 * KJV is a preference, never an assumption. Modules install separately, so an
 * install may well have no KJV at all; reaching for it by name there opened a
 * database that does not exist and left the reader looking at an error.
 */

/** Opened by preference when it is installed. */
export const PREFERRED_DEFAULT_BIBLE = 'KJV';

/** The one field the choice reads, so metadata rows and store rows both fit. */
export interface DefaultBibleCandidate {
  abbreviation: string;
}

/**
 * Pick the default Bible from the installed ones.
 *
 * In order: `preferred` (the reader's own - usually the translation they are
 * already reading) if it is installed, then KJV if it is installed, then the
 * first installed Bible. Matching ignores case and answers with the installed
 * spelling, so the result can be handed straight to a lookup or a picker.
 *
 * @param installed The installed Bibles, in the order the app lists them.
 * @param preferred The translation to use when it is installed.
 * @returns The chosen abbreviation, or `undefined` when `installed` is empty.
 *   An empty list can also mean "not loaded yet"; telling those apart is the
 *   caller's job, since only the caller knows whether it has asked.
 */
export function pickDefaultBible(
  installed: readonly DefaultBibleCandidate[],
  preferred?: string | null,
): string | undefined {
  const installedAs = (abbreviation: string): string | undefined => {
    const wanted = abbreviation.toLowerCase();
    return installed.find(b => b.abbreviation.toLowerCase() === wanted)?.abbreviation;
  };

  return (preferred ? installedAs(preferred) : undefined)
    ?? installedAs(PREFERRED_DEFAULT_BIBLE)
    ?? installed[0]?.abbreviation;
}
