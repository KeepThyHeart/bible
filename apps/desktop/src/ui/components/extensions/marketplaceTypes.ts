/**
 * Renderer-side mirrors of the marketplace wire shapes.
 *
 * These duplicate the main-process types in
 * `electron/extensions/marketplace/` rather than importing them: the renderer
 * cannot reach into `electron/` (different tsconfig, different module graph),
 * and the preload deliberately types these channels as `any` so the bridge
 * stays free of app types. Keeping the shapes here means the UI is at least
 * checked against *something*.
 *
 * If a field changes on the main-process side, change it here too - nothing
 * enforces the match at compile time.
 */

/** A catalog the user has added, plus the app's own default. */
export interface CatalogSource {
  url: string;
  label?: string;
  /** True for the app's configured default catalog. Derived by the host. */
  isDefault: boolean;
  addedAt: number;
  /** Absent means the source is inert: listed, but never fetched. */
  riskAcknowledgedAt?: number;
  lastFetchedAt?: number;
  lastError?: string;
  hasCachedDocument: boolean;
}

/** One catalog listing, tagged with the catalog it came from. */
export interface CatalogListing {
  id: string;
  version: string;
  name: string;
  description?: string;
  publisher?: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes?: number;
  permissions?: string[];
  engines?: string;
  homepage?: string;
  publisherKey?: string;
  sourceUrl: string;
  /** Only listings from the default catalog can reach the `marketplace` tier. */
  fromDefaultCatalog: boolean;
}

/** A published block rule. */
export interface BlocklistEntry {
  id: string;
  versions?: string;
  reason: string;
  url?: string;
}

/** The host's verdict for one installed extension. */
export interface BlockDecision {
  extensionId: string;
  reason: string;
  url?: string;
  versions?: string;
}

/** Uniform failure shape across the catalog channels. */
export interface MarketplaceError {
  ok: false;
  code: string;
  message: string;
  detail?: unknown;
}

export function isMarketplaceError(value: unknown): value is MarketplaceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/** Human-readable size for a listing, or an empty string when unknown. */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short host name for display, falling back to the raw string on a bad URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
