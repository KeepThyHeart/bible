/**
 * Which discovered module files should actually be registered.
 *
 * Module type is inferred from the filename prefix (`commentary_mhc.db` is a
 * commentary, `xref_tsk.db` is a cross-reference set). That inference is right
 * for every module the app ships except one shape: a cross-reference module is
 * *generated from* a commentary-shaped source file, and both land in the same
 * directory.
 *
 * TSK is the case in hand. `commentary_tsk.db` is the SWORD import that
 * `scripts/import-tsk.js` reads; `xref_tsk.db` is what it writes and what the
 * app actually queries. Registering both made the Treasury of Scripture
 * Knowledge appear three times under one verse - as a cross-reference row, as
 * a cross-reference chip, and in the "Commentaries:" list, where clicking it
 * opened a commentary the user was never meant to browse.
 *
 * The rule, deliberately stated over filenames rather than over any particular
 * module's name: **a `commentary_<slug>.db` is not registered when an
 * `xref_<slug>.db` is installed alongside it.** The commentary file stays on
 * disk and stays usable as an import source; it simply does not become a
 * browsable module.
 */

/** Filename prefix marking a generated cross-reference module. */
const XREF_PREFIX = 'xref_';
/** Filename prefix marking a commentary module. */
const COMMENTARY_PREFIX = 'commentary_';

/**
 * The slug of a module file: everything between the type prefix and `.db`.
 *
 * @example moduleFileSlug('xref_tsk.db') // 'tsk'
 * @example moduleFileSlug('commentary_mhc.db') // 'mhc'
 */
export function moduleFileSlug(filename: string, prefix: string): string | null {
  const lower = filename.toLowerCase();
  if (!lower.startsWith(prefix) || !lower.endsWith('.db')) return null;
  const slug = lower.slice(prefix.length, -'.db'.length);
  return slug.length > 0 ? slug : null;
}

/**
 * Slugs of every installed cross-reference module, from a list of filenames.
 * Pass every module directory's contents - bundled and user - since the two
 * halves of a pair need not live in the same one.
 */
export function crossReferenceSlugs(filenames: Iterable<string>): Set<string> {
  const slugs = new Set<string>();
  for (const filename of filenames) {
    const slug = moduleFileSlug(filename, XREF_PREFIX);
    if (slug) slugs.add(slug);
  }
  return slugs;
}

/**
 * True when `filename` is a commentary file that is merely the SOURCE of an
 * installed cross-reference module, and so must not be registered.
 *
 * @param filename  A module filename, e.g. `commentary_tsk.db`.
 * @param xrefSlugs Result of {@link crossReferenceSlugs} over all module dirs.
 */
export function isCrossReferenceSourceCommentary(
  filename: string,
  xrefSlugs: ReadonlySet<string>
): boolean {
  const slug = moduleFileSlug(filename, COMMENTARY_PREFIX);
  return slug !== null && xrefSlugs.has(slug);
}

/**
 * True when a registry row's `database_path` points at such a shadowed
 * commentary - used to de-register one that an older build already recorded,
 * so an existing install converges on the same registry a fresh one produces.
 *
 * Registry paths are POSIX-style and relative (`modules/commentary_tsk.db`).
 */
export function isCrossReferenceSourceCommentaryPath(
  databasePath: string,
  xrefSlugs: ReadonlySet<string>
): boolean {
  const filename = databasePath.replace(/\\/g, '/').split('/').pop() ?? '';
  return isCrossReferenceSourceCommentary(filename, xrefSlugs);
}
