import { ModuleType } from './Types';

/**
 * Repository catalog metadata
 */
export interface RepositoryInfo {
  name: string;
  abbreviation: string;
  version: string;
  url: string;
  last_updated: string;
  /**
   * ISO-8601 UTC time the catalog was published, stamped by
   * `scripts/yubikey-sign.py` when it signs. It sits inside the catalog, so the
   * signature covers it. Recorded for a future freshness check - the app does
   * not reject a catalog for its age today. Absent in older catalogs.
   */
  published?: string;
  description: string;
  language: string;
}

/**
 * Module entry in a repository catalog
 */
export interface CatalogModule {
  module_id: string;
  module_type: ModuleType;
  name: string;
  abbreviation: string;
  language_code: string;
  version: string;
  description: string;
  author?: string | null;
  publisher?: string | null;
  year_published?: number | null;
  license: string;
  license_url?: string | null;
  download_url: string;
  download_size_bytes: number;
  installed_size_bytes: number;
  checksum: string;
  features: string[];
  sample_text?: SampleText | null;
  tags: string[];
  recommended: boolean;
  requires_module?: string | null;
  created_date: string;
  updated_date: string;
}

/**
 * Sample text from a module
 */
export interface SampleText {
  verse_id: number;
  reference: string;
  text: string;
}

/**
 * Complete repository catalog
 */
export interface RepositoryCatalog {
  repository: RepositoryInfo;
  modules: CatalogModule[];
  /**
   * Optional feature packs - downloadable *capabilities* (currently only the
   * semantic-search index + embedding model) rather than study content.
   *
   * Deliberately a separate section from `modules`, and deliberately typed as
   * `unknown[]`: these entries never pass through `InstallationService` and must
   * be run through `parseFeaturePack` / `parseFeaturePacks` (FeaturePackTypes.ts)
   * before anything reads a field off them. Typing the raw catalog as
   * `FeaturePack[]` would let unvalidated network data masquerade as validated.
   * Absent in older catalogs, which is why it is optional.
   */
  feature_packs?: unknown[];
  /**
   * Optional starter packs - language-scoped bundles of recommended *content*
   * (see `StarterPackTypes.ts`). These reference `module_id`s from the
   * `modules` array above rather than carrying payloads of their own, so a
   * pack install is just several ordinary module installs.
   *
   * Typed `unknown[]` for the same reason as `feature_packs`: catalog JSON is
   * untrusted network input and must go through `parseStarterPacks` before
   * any field is read. Absent in older catalogs.
   */
  starter_packs?: unknown[];
}

/** One Ed25519 signature over the SHA-256 digest of a catalog's exact bytes. */
export interface CatalogSignatureEntry {
  /** Hex-encoded 32-byte Ed25519 public key (64 hex chars). */
  publicKey: string;
  /** Hex-encoded 64-byte Ed25519 signature (128 hex chars). */
  signature: string;
  algorithm: 'ed25519-sha256';
}

/**
 * Detached Ed25519 signature over a catalog document.
 *
 * Served alongside the catalog as `<catalog>.sig` so that `catalog.json`
 * stays byte-identical to what was signed (no canonicalization needed).
 * Mirrors the extension signing format (`ExtensionSignature`).
 *
 * The top-level fields are the primary signature. `signatures` may add more
 * over the same bytes by other keys, which is how a catalog is signed by an
 * outgoing and an incoming key at once during a rotation. Apps that predate
 * `signatures` read only the primary, so during a rotation it should be the
 * key older installs trust. Every signature present must verify; one by a
 * trusted key is enough.
 */
export interface CatalogSignature extends CatalogSignatureEntry {
  /** ISO-8601 timestamp the signature was produced (informational). */
  signedAt?: string;
  /** Optional short label identifying the signing key. */
  keyId?: string;
  /** Further signatures over the same catalog bytes. */
  signatures?: CatalogSignatureEntry[];
}

/**
 * Outcome of verifying a catalog's detached signature.
 *
 * - `verified`      - signature valid and the key is trusted for this catalog.
 * - `unsigned`      - no `.sig` was served.
 * - `invalid`       - a signature was served but did not validate.
 * - `untrusted_key` - signature is cryptographically valid, but signed by a
 *                     key that is not pinned/known for this catalog source.
 * - `error`         - the signature could not be evaluated (malformed, etc).
 */
export type CatalogSignatureStatus =
  | 'verified'
  | 'unsigned'
  | 'invalid'
  | 'untrusted_key'
  | 'error';

export interface CatalogVerificationResult {
  status: CatalogSignatureStatus;
  /**
   * Hex public key that produced the signature, when one was present. With
   * several signatures, the trusted one that verified the catalog.
   */
  publicKey?: string;
  /** Every key whose signature over the catalog verified. */
  signers?: string[];
  /** Human-readable detail, suitable for surfacing in the UI. */
  message: string;
}

/**
 * A catalog together with the verification result of its detached signature.
 */
export interface FetchedCatalog {
  catalog: RepositoryCatalog;
  signature: CatalogVerificationResult;
}

/**
 * Module filter options for searching catalogs
 */
export interface ModuleFilter {
  moduleType?: ModuleType | ModuleType[];
  languageCode?: string | string[];
  license?: string | string[];
  features?: string | string[];
  tags?: string | string[];
  recommended?: boolean;
  searchQuery?: string;
  minSize?: number;
  maxSize?: number;
}

/**
 * Sort options for module lists
 */
export type ModuleSortBy = 'name' | 'size' | 'date_added' | 'recommended' | 'language';

export type SortDirection = 'ASC' | 'DESC';

export interface ModuleSortOptions {
  sortBy: ModuleSortBy;
  direction: SortDirection;
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  queueId: number;
  moduleId: string;
  moduleName: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progressBytes: number;
  totalBytes?: number;
  progressPercentage: number;
  speedBps?: number;
  speedMBps?: number;
  estimatedTimeRemaining?: number;
  errorMessage?: string;
}

/**
 * Installation result
 */
export interface InstallationResult {
  success: boolean;
  moduleId?: number;
  moduleName?: string;
  error?: string;
}

/**
 * Update check result
 */
export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  availableVersion?: string;
  changelog?: string;
  downloadUrl?: string;
  downloadSizeBytes?: number;
  isCritical?: boolean;
}
