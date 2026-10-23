/**
 * Facet classification for semantic-index rows, in one place.
 *
 * The semantic DB has no facet column; the kind of a row is inferred from the
 * row itself. The web scoring code (ScoringUtils) and the bibsearch corpus
 * exporter (scripts/semantic/export-bibsearch-corpus.mjs) both use these
 * helpers so the rule cannot drift. Keep this file free of imports and of
 * non-erasable TypeScript syntax: the export script loads it directly through
 * Node's type stripping.
 */

/** Facet of a row: LLM explanation (main), terse phrase (sub), verbatim text, or topic row. */
export type FacetKind = 'main' | 'sub' | 'text' | 'topic';

/** Text length below which a row is a terse sub-facet phrase. */
export const SUB_FACET_MAX_LENGTH = 80;

/** Id prefix of verbatim-text rows. */
export const TEXT_FACET_ID_PREFIX = 'txt|';

/** Sub-facet rows carry an `_s<N>` suffix on their id. */
export const SUB_FACET_ID_PATTERN = /_s\d+$/;

/** True when the id carries the sub-facet suffix (`..._s3`). */
export function isSubFacetId(id: string): boolean {
  return SUB_FACET_ID_PATTERN.test(id);
}

/** True when the text is short enough to be a sub-facet phrase. */
export function isSubFacetText(text: string): boolean {
  return text.length < SUB_FACET_MAX_LENGTH;
}

/**
 * Full classification of a row. Precedence: topic level, `txt|` id prefix,
 * then sub (id suffix or short text), otherwise main.
 */
export function classifyFacet(row: { id: string; level: string; text: string }): FacetKind {
  if (row.level === 'topic') return 'topic';
  if (row.id.startsWith(TEXT_FACET_ID_PREFIX)) return 'text';
  if (isSubFacetId(row.id) || isSubFacetText(row.text)) return 'sub';
  return 'main';
}
