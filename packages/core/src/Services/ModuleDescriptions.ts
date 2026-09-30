/**
 * Framework-free module catalog metadata shared by the web and desktop apps.
 *
 * Three groups, all pure data or pure predicates with no i18n or UI
 * dependency:
 *
 * - the AI-synthesized **digest** module's identity (`DIGEST_MODULE_ABBR`,
 *   `isDigestModule`),
 * - the **recommended translations** and **commentary ordering** (editorial
 *   data, identical in every language),
 * - **provenance detection**: deciding from a module's own metadata that its
 *   text was produced by a machine rather than a human author.
 *
 * What is deliberately NOT here is anything text-bearing. The prose that
 * describes a module, and the wording of the provenance notices, is looked up
 * through each app's own localization (i18next on the web, `I18nService` on
 * the desktop) by the app-side `moduleDescriptions.ts`, which re-exports
 * this file's pieces next to its localized accessors.
 */

/** Module abbreviation for the AI-synthesized commentary digest. */
export const DIGEST_MODULE_ABBR = 'SYNTHESIS';

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


/** Recommended Bible translations shown at the top of the selector */
export const RECOMMENDED_BIBLES: string[] = [
  'KJV', 'BSB', 'ASV', 'YLT',
];

/** Default priority for commentaries not in the map */
export const DEFAULT_COMMENTARY_PRIORITY = 100;

/**
 * Sort order for the commentary tab bar: lower is shown first.
 *
 * Ordering is editorial, not linguistic — the digest leads, then the
 * comprehensive full-Bible works, then the widely used ones, then the focused
 * and specialised titles — so it stays in source alongside the code that sorts
 * by it, and is identical in every language.
 */
export const COMMENTARY_PRIORITY: Record<string, number> = {
  // Special: AI-synthesized digest (shown first when present)
  SYNTHESIS: 0,

  // Top-tier: comprehensive, full-Bible or nearly so
  Barnes: 1,
  gill: 2,
  Clarke: 3,
  pulpit: 4,
  kd: 5,
  CalvinCommentaries: 6,
  poole: 7,

  // Excellent, widely used
  cambridge: 10,
  lange: 11,
  expositors: 12,
  TSK: 13,
  Wesley: 14,
  Scofield: 15,
  Geneva: 16,

  // Solid, focused works
  RWP: 20,
  PNT: 21,
  Abbott: 22,
  Burkitt: 23,
  Lightfoot: 24,
  Luther: 25,
  tod: 26,

  // Specialized / Niche
  Catena: 30,
  DTN: 31,
  Family: 32,
  NETnotesfree: 33,
  Personal: 34,
  TFG: 35,
  Kingcomments: 36,
  QuotingPassages: 37,
  Spurious: 38,
};

/** Sort priority for a commentary; unlisted modules sort last together. */
export function getCommentaryPriority(moduleAbbr: string): number {
  return COMMENTARY_PRIORITY[moduleAbbr] ?? DEFAULT_COMMENTARY_PRIORITY;
}
