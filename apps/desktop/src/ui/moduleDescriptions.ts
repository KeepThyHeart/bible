/**
 * Module provenance metadata - how the desktop app decides that a module's
 * text was produced by a machine rather than written by a human author.
 *
 * This exists because the app can show an AI-synthesized commentary alongside
 * the historical ones. A reader who is not told will reasonably assume the
 * commentary was written by the commentators whose names appear elsewhere in
 * the app, so every surface that shows that text has to say where it came from.
 *
 * Mirrors `apps/web/src/moduleDescriptions.ts` so both apps disclose the
 * same thing in the same words.
 */

/** Module abbreviation for the AI-synthesized commentary digest. */
export const DIGEST_MODULE_ABBR = 'SYNTHESIS';

/** Display name shown in tabs and dialogs for the digest module. */
export const DIGEST_DISPLAY_NAME = 'Combined Summary';

/**
 * The two flavours of disclosure.
 *
 * - `digest` - the known SYNTHESIS module, which summarises a specific set of
 *   public-domain commentaries. Its wording can be specific.
 * - `generated` - some other module whose own metadata declares it machine
 *   generated. Its wording has to stay generic.
 */
export type ModuleProvenanceKind = 'digest' | 'generated';

/**
 * The subset of a module's `module_info` row that can reveal machine
 * authorship. Matches the shape returned by `commentaryAPI.getCommentaryInfo`.
 */
export interface ModuleProvenanceMetadata {
  author?: string | null;
  copyright?: string | null;
  description?: string | null;
  full_name?: string | null;
}

/**
 * Markers that a module declares itself machine generated.
 *
 * Deliberately conservative. Model and vendor names are NOT matched: "Claude"
 * and "Gemini" are also human names that could legitimately appear in a
 * commentator's byline, and a false positive puts a provenance notice on a
 * real author's work.
 */
const AI_PROVENANCE_PATTERN =
  /\b(?:ai[-\s]?(?:generated|synthesi[sz]ed|assisted|authored|written|produced)|artificial intelligence|machine[-\s]?(?:generated|translated|written)|auto(?:matically)?[-\s]?(?:generated|synthesi[sz]ed)|computer[-\s]?generated|large language model|llm)\b/i;

/** Check whether a module abbreviation is the known Digest/Synthesis module. */
export function isDigestModule(moduleAbbr: string | null | undefined): boolean {
  return (moduleAbbr ?? '').toUpperCase() === DIGEST_MODULE_ABBR;
}

/**
 * Check whether a module's own metadata declares it machine generated.
 *
 * This is the data-driven half of detection: any module whose `author`,
 * `copyright`, `description` or `full_name` says so is covered without a code
 * change. SYNTHESIS is caught here too - its author reads
 * "AI-synthesized from 19+ public domain commentaries" - but the abbreviation
 * check below still runs first so the notice is on screen from the very first
 * paint, before the metadata IPC round-trip resolves.
 */
export function isAiGeneratedMetadata(
  metadata: ModuleProvenanceMetadata | null | undefined
): boolean {
  if (!metadata) return false;
  return [
    metadata.author,
    metadata.copyright,
    metadata.description,
    metadata.full_name,
  ].some((field) => !!field && AI_PROVENANCE_PATTERN.test(field));
}

/**
 * Resolve how a module's content was produced, or `null` when it reads as
 * ordinary human-authored text.
 *
 * `metadata` is optional so callers can render a correct answer synchronously
 * for the known digest module and refine it once the module's own metadata
 * has loaded.
 */
export function getModuleProvenanceKind(
  moduleAbbr: string | null | undefined,
  metadata?: ModuleProvenanceMetadata | null
): ModuleProvenanceKind | null {
  if (isDigestModule(moduleAbbr)) return 'digest';
  if (isAiGeneratedMetadata(metadata)) return 'generated';
  return null;
}

/** Convenience predicate: does this module need a provenance notice? */
export function isAiGeneratedModule(
  moduleAbbr: string | null | undefined,
  metadata?: ModuleProvenanceMetadata | null
): boolean {
  return getModuleProvenanceKind(moduleAbbr, metadata) !== null;
}

/**
 * The catalog keys and English source text for each flavour of notice.
 *
 * Each entry is one whole sentence - never a fragment that the JSX stitches
 * back together - so a translator controls the entire word order.
 * See `docs/features/i18n-source-fixes.md`.
 */
export const MODULE_PROVENANCE_TEXT: Record<
  ModuleProvenanceKind,
  {
    provenanceKey: string;
    cautionKey: string;
    collapsedKey: string;
  }
> = {
  digest: {
    provenanceKey: 'moduleDisclaimer.digest.provenance',
    cautionKey: 'moduleDisclaimer.digest.caution',
    collapsedKey: 'moduleDisclaimer.digest.collapsedLabel',
  },
  generated: {
    provenanceKey: 'moduleDisclaimer.generated.provenance',
    cautionKey: 'moduleDisclaimer.generated.caution',
    collapsedKey: 'moduleDisclaimer.generated.collapsedLabel',
  },
};
