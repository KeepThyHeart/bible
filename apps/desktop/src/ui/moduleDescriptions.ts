/**
 * Module provenance metadata - how the desktop app decides that a module's
 * text was produced by a machine rather than written by a human author.
 *
 * This exists because the app can show an AI-synthesized commentary alongside
 * the historical ones. A reader who is not told will reasonably assume the
 * commentary was written by the commentators whose names appear elsewhere in
 * the app, so every surface that shows that text has to say where it came from.
 *
 * The detection logic is shared with the web app through `@bible/core`, so
 * both apps disclose the same thing for the same module.
 */

import {
  DIGEST_MODULE_ABBR,
  isDigestModule,
  isAiGeneratedMetadata,
  getModuleProvenanceKind,
  isAiGeneratedModule,
  type ModuleProvenanceKind,
  type ModuleProvenanceMetadata,
} from '@bible/core/browser';

// Detection (which module is the digest, whether metadata declares a module
// machine generated) is language-free and lives in `@bible/core`, where the web
// app shares it; it is re-exported so existing importers keep one import site.
// What stays here is the wording: the desktop catalog keys for each notice.
export {
  DIGEST_MODULE_ABBR,
  isDigestModule,
  isAiGeneratedMetadata,
  getModuleProvenanceKind,
  isAiGeneratedModule,
};
export type { ModuleProvenanceKind, ModuleProvenanceMetadata };

/** Display name shown in tabs and dialogs for the digest module. */
export const DIGEST_DISPLAY_NAME = 'Combined Summary';

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
