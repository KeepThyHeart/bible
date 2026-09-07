import { ModuleType, Metadata } from '../Core/Types';

/**
 * Base class for all module info entities. Each module database (bible_*.db,
 * commentary_*.db, etc.) contains a module_info table with these common fields.
 * Subclasses add module-type-specific fields and override getDisplayName().
 *
 * ## Identity + provenance
 *
 * `module_info` carries a stable identity and provenance block. `module_uuid` -
 * not `abbreviation` - is the join key for cross-database references.
 * `license_spdx` is the authoritative licence field; the freeform `copyright`
 * string is display-only.
 *
 * These fields are optional here so a module that omits them still reads.
 */

/** SPDX identifiers that mean "no rights reserved / freely usable". */
const PUBLIC_DOMAIN_SPDX = new Set([
  'PD',
  'PUBLIC-DOMAIN',
  'CC0-1.0',
  'CC-PDDC',
  'UNLICENSE',
  'NLOD-1.0'
]);

export interface BaseModuleInfoData {
  infoId?: number;
  abbreviation: string;
  fullName: string;
  languageCode?: string;
  author?: string;
  yearPublished?: number;
  copyright?: string;
  description?: string;
  publisher?: string;
  version?: string;
  createdDate?: string;
  metadata?: Metadata;

  // -- v2 identity + provenance ------------------------------------------
  /** Stable identity across content revisions; replaces `abbreviation` as the join key. */
  moduleUuid?: string;
  /** Container format name, e.g. `'bible-module'`. */
  format?: string;
  /** Spec version this file conforms to, e.g. `'2.0'`. */
  formatVersion?: string;
  /** The module's own content revision (v1 `version`, renamed). */
  contentVersion?: string;
  /** SHA-256 of the module content, for integrity and dedup. */
  contentSha256?: string;
  /** SPDX licence identifier, e.g. `'CC-BY-4.0'`, `'PD'`, `'Proprietary'`. */
  licenseSpdx?: string;
  /** URL of the full licence terms. */
  licenseUrl?: string;
  /** Provenance: where the content came from. */
  sourceUrl?: string;
  /** Explicit versification scheme, e.g. `'kjv-english'`. */
  versification?: string;
  /** True for an original-language text or lexicon (Hebrew, Aramaic, Greek). */
  isOriginalLanguage?: boolean;
  /** True for a right-to-left script (Hebrew, Aramaic, Arabic, Syriac). */
  rightToLeft?: boolean;
}

export abstract class BaseModuleInfo {
  infoId: number;
  abstract readonly moduleType: ModuleType;
  abbreviation: string;
  fullName: string;
  languageCode: string;
  author?: string;
  yearPublished?: number;
  /** Freeform copyright text. **Display only** - never parsed for licensing. */
  copyright?: string;
  description?: string;
  publisher?: string;
  /**
   * The module's content revision.
   *
   * @deprecated Use {@link contentVersion}. Kept populated as an alias so
   * consumers outside `@bible/core` compile and behave unchanged.
   */
  version?: string;
  createdDate?: string;
  metadata?: Metadata;

  // -- v2 identity + provenance -------------------------------------
  moduleUuid?: string;
  format?: string;
  formatVersion?: string;
  contentVersion?: string;
  contentSha256?: string;
  licenseSpdx?: string;
  licenseUrl?: string;
  sourceUrl?: string;
  versification?: string;
  isOriginalLanguage: boolean;
  rightToLeft: boolean;

  constructor(data: BaseModuleInfoData) {
    this.infoId = data.infoId ?? 1;
    this.abbreviation = data.abbreviation;
    this.fullName = data.fullName;
    this.languageCode = data.languageCode ?? 'en';
    this.author = data.author;
    this.yearPublished = data.yearPublished;
    this.copyright = data.copyright;
    this.description = data.description;
    this.publisher = data.publisher;
    this.createdDate = data.createdDate;
    this.metadata = data.metadata;

    this.moduleUuid = data.moduleUuid;
    this.format = data.format;
    this.formatVersion = data.formatVersion;
    // `content_version` is the renamed `version`. The two fields are kept
    // as aliases in both directions: a v1 module supplies only `version`, a v2
    // module supplies only `content_version`, and callers of either see a value.
    //
    this.contentVersion = data.contentVersion ?? data.version;
    this.version = data.version ?? data.contentVersion;
    this.contentSha256 = data.contentSha256;
    this.licenseSpdx = data.licenseSpdx;
    this.licenseUrl = data.licenseUrl;
    this.sourceUrl = data.sourceUrl;
    this.versification = data.versification;
    this.isOriginalLanguage = data.isOriginalLanguage ?? false;
    this.rightToLeft = data.rightToLeft ?? false;
  }

  /** Right-to-left script (Hebrew, Aramaic, Arabic, Syriac). */
  isRightToLeft(): boolean {
    return this.rightToLeft;
  }

  /** The HTML `dir` attribute value for this module's text. */
  getTextDirection(): 'ltr' | 'rtl' {
    return this.rightToLeft ? 'rtl' : 'ltr';
  }

  /** An original-language text or lexicon (Hebrew, Aramaic, Greek). */
  isOriginalLanguageText(): boolean {
    return this.isOriginalLanguage;
  }

  /** Get display name. Override in subclasses for type-specific formatting. */
  getDisplayName(): string {
    return this.fullName;
  }

  /**
   * Stable identity for this module.
   *
   * Returns `module_uuid`, falling back to the abbreviation as a last-resort
   * identity for a module that carries no UUID. Callers that persist a
   * cross-database reference should prefer {@link moduleUuid} and treat an
   * abbreviation-shaped identity as unstable.
   */
  getIdentity(): string {
    return this.moduleUuid ?? this.abbreviation;
  }

  /** True when this module carries the identity block. */
  hasIdentityBlock(): boolean {
    return this.moduleUuid !== undefined && this.moduleUuid !== '';
  }

  /**
   * Check if this module is in the public domain.
   *
   * Decided from the structured {@link licenseSpdx} field. Recognised
   * public-domain identifiers are `PD`, `CC0-1.0`, `CC-PDDC`, `Unlicense`,
   * `NLOD-1.0` and `public-domain` (case-insensitive); a `LicenseRef-...-PD`
   * custom identifier also counts.
   *
   * When `license_spdx` is absent this falls back to substring-matching the
   * freeform `copyright` text, so a module that only says "Public Domain" in
   * its copyright line still reports correctly. A module with an empty
   * `copyright` and no `license_spdx` reports `false`.
   */
  isPublicDomain(): boolean {
    if (this.licenseSpdx !== undefined && this.licenseSpdx.trim() !== '') {
      const spdx = this.licenseSpdx.trim().toUpperCase();
      if (PUBLIC_DOMAIN_SPDX.has(spdx)) return true;
      // Custom `LicenseRef-*` identifiers that self-declare public domain.
      return spdx.startsWith('LICENSEREF-') && spdx.endsWith('-PD');
    }

    // --- fallback: no structured licence available -------------------------
    return this.copyright?.toLowerCase().includes('public domain') ?? false;
    // ------------------------------------------------------------------------
  }

  /** True when the licence is explicitly declared. */
  hasStructuredLicense(): boolean {
    return this.licenseSpdx !== undefined && this.licenseSpdx.trim() !== '';
  }
}
