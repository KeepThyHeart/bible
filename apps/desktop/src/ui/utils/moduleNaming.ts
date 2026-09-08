/**
 * How installed modules are NAMED to the user.
 *
 * One rule lives here rather than at each render site, because the same
 * artefact leaks into several of them.
 */

/**
 * Human-facing label for a cross-reference module.
 *
 * The registry abbreviation for the Treasury of Scripture Knowledge is
 * `TSKxref`, not `TSK`: the importer derives the abbreviation from the
 * `xref_` filename prefix that marks the module's TYPE, so the type suffix
 * ends up inside the module's NAME. The user sees a made-up word for a
 * resource they know by three letters.
 *
 * Stripping a trailing `xref`/`-xref`/`_xrefs` rather than special-casing TSK
 * keeps any future `*xref` module reading the same way. Fixing it here, at the
 * display boundary, rather than by rewriting the stored abbreviation: the
 * stored value is a lookup key - `xref:getGroupsForRange(abbreviation)`, the
 * study cache's `crossrefs[].src`, and the cache's own module fingerprint all
 * resolve through it - so changing it at rest would invalidate the cache and
 * break every lookup, to fix a spelling.
 *
 * Falls back to the original when stripping would leave nothing, so a module
 * literally abbreviated `xref` still renders as something.
 */
export function crossReferenceModuleLabel(abbreviation: string): string {
  const stripped = abbreviation.replace(/[-_ ]?xrefs?$/i, '');
  return stripped.length > 0 ? stripped : abbreviation;
}
