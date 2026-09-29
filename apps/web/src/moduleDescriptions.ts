/**
 * Recommendation and ordering metadata for Bible translations and commentaries,
 * plus accessors for the prose that describes them.
 *
 * **The prose lives in `locales/en/modules.json`, not here.** Duplicating it
 * into this file gives two copies of the same English, only one of which can be
 * translated — and not necessarily the one on screen. What belongs here is the
 * part that is not language at all — which translations are recommended, and
 * what order the commentaries sort in.
 *
 * Everything text-bearing is a function rather than a constant, because a
 * constant is captured at import time and cannot follow a language change.
 */
import i18n from './i18n';
import {
  DIGEST_MODULE_ABBR,
  isDigestModule,
  RECOMMENDED_BIBLES,
  DEFAULT_COMMENTARY_PRIORITY,
  COMMENTARY_PRIORITY,
  getCommentaryPriority,
} from '@bible/core/browser';

// The language-free half (which module is the digest, which translations are
// recommended, how commentaries sort) lives in `@bible/core` so the desktop
// app shares it; it is re-exported here so existing importers, and the tests
// that mock this module by path, keep one import site.
export {
  DIGEST_MODULE_ABBR,
  isDigestModule,
  RECOMMENDED_BIBLES,
  DEFAULT_COMMENTARY_PRIORITY,
  COMMENTARY_PRIORITY,
  getCommentaryPriority,
};

/**
 * Resolve a catalog key, treating "no such key" as absent rather than as text.
 *
 * i18next echoes the key back when it cannot resolve it, which would put
 * `commentaries.Wesley.disclaimer` on screen for any module whose entry omits
 * the optional field. The echo is the key *without* its `modules:` namespace
 * prefix, so comparing the result against the key never matched and the raw key
 * was shown; asking `exists` first does not depend on the echo's shape.
 */
function optional(key: string): string | undefined {
  if (!i18n.exists(key)) return undefined;
  const value = i18n.t(key);
  return value === '' ? undefined : value;
}

// ─── Special Module: Commentary Digest (AI Synthesis) ────────────────

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
