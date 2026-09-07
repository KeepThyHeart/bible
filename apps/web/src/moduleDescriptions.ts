/**
 * Recommendation and ordering metadata for Bible translations and commentaries,
 * plus accessors for the prose that describes them.
 *
 * **The prose lives in `locales/en/modules.json`, not here.** It used to be
 * duplicated: 114 English strings sat in this file while a byte-identical copy
 * sat in the catalog that nothing read. Only one of them could be translated,
 * and it was not the one on screen. What stays in this file is the part that is
 * not language at all — which translations are recommended, and what order the
 * commentaries sort in.
 *
 * Everything text-bearing is a function rather than a constant, because a
 * constant is captured at import time and cannot follow a language change.
 */
import i18n from './i18n';

/**
 * Resolve a catalog key, treating "no such key" as absent rather than as text.
 *
 * i18next echoes the key back when it cannot resolve it, which would put
 * `modules:bibles.KJV.tagline` on screen for any module whose entry omits the
 * optional field.
 */
function optional(key: string): string | undefined {
  const value = i18n.t(key);
  return value === key || value === '' ? undefined : value;
}

// ─── Special Module: Commentary Digest (AI Synthesis) ────────────────

/** Module abbreviation for the AI-synthesized commentary digest */
export const DIGEST_MODULE_ABBR = 'SYNTHESIS';

/** Check whether a module abbreviation is the Digest/Synthesis module */
export function isDigestModule(moduleAbbr: string): boolean {
  return moduleAbbr.toUpperCase() === DIGEST_MODULE_ABBR;
}

/** Display name shown in tabs and dialogs */
export function getDigestDisplayName(): string {
  return i18n.t('modules:digest.displayName');
}

/** Subtitle shown in the module selection dialog */
export function getDigestSubtitle(): string {
  return i18n.t('modules:digest.subtitle');
}

/** Top disclaimer shown when viewing Digest entries */
export function getDigestDisclaimer(): string {
  return i18n.t('modules:digest.disclaimer');
}

// ─── Bible Translations ───────────────────────────────────────────────

export interface BibleDescription {
  description: string;
  /** Short tagline shown in recommendation section */
  tagline?: string;
  /** Optional disclaimer/copyright notice shown when viewing this module */
  disclaimer?: string;
}

/** Recommended Bible translations shown at the top of the selector */
export const RECOMMENDED_BIBLES: string[] = [
  'KJV', 'BSB', 'ASV', 'YLT',
];

/**
 * Description, tagline and disclaimer for a translation, or `undefined` when
 * the catalog has no entry for it — a module the app has never heard of is
 * perfectly normal, since users can install their own.
 */
export function getBibleDescription(moduleAbbr: string): BibleDescription | undefined {
  const description = optional(`modules:bibles.${moduleAbbr}.description`);
  if (description === undefined) return undefined;
  return {
    description,
    tagline: optional(`modules:bibles.${moduleAbbr}.tagline`),
    disclaimer: optional(`modules:bibles.${moduleAbbr}.disclaimer`),
  };
}

// ─── Commentaries ─────────────────────────────────────────────────────

export interface CommentaryDescription {
  description: string;
  /** Sort priority — lower numbers appear first. Omit for default (100). */
  priority?: number;
  /** Optional disclaimer/copyright notice shown when viewing this module */
  disclaimer?: string;
}

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

/**
 * Description, priority and disclaimer for a commentary, or `undefined` when
 * the catalog has no entry for it.
 */
export function getCommentaryDescription(moduleAbbr: string): CommentaryDescription | undefined {
  const description = optional(`modules:commentaries.${moduleAbbr}.description`);
  if (description === undefined) return undefined;
  return {
    description,
    priority: COMMENTARY_PRIORITY[moduleAbbr],
    disclaimer: isDigestModule(moduleAbbr)
      ? getDigestDisclaimer()
      : optional(`modules:commentaries.${moduleAbbr}.disclaimer`),
  };
}

/** Look up the disclaimer for any module (commentary or Bible) by abbreviation */
export function getModuleDisclaimer(moduleAbbr: string): string | undefined {
  if (isDigestModule(moduleAbbr)) return getDigestDisclaimer();
  return (
    optional(`modules:commentaries.${moduleAbbr}.disclaimer`)
    ?? optional(`modules:bibles.${moduleAbbr}.disclaimer`)
  );
}
