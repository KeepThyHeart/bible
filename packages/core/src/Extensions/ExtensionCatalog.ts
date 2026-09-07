/**
 * Extension catalog + blocklist wire formats (Phase 4).
 *
 * These are the two documents a marketplace serves. Both are plain JSON
 * fetched over HTTP, so both are **untrusted input** and neither is parsed
 * anywhere without going through the validators below first.
 *
 * ## Why this lives in core rather than the desktop host
 *
 * Three consumers need the same shapes: the host (fetch + install), the
 * renderer (browse + badge + "why won't this run?"), and the tests. Putting
 * the types and the validation in one dependency-free module means the
 * renderer cannot drift from what the host will actually accept.
 *
 * ## What the validators do and do not promise
 *
 * They promise *shape*: required fields present, of the right primitive type,
 * with a recognizable version marker. They deliberately do NOT promise
 * *trust*. A catalog is a list of claims made by whoever served it; the
 * `sha256` in an entry is only as good as the connection that delivered it,
 * and the real provenance decision is made after download by
 * `verifyExtensionSignature` + {@link deriveTrustTier}. Validation is here to
 * stop malformed JSON from reaching the install path, not to decide who to
 * believe.
 *
 * Unknown fields are preserved rather than rejected: a future catalog format
 * that adds a field must not break an older app that does not understand it.
 */

/** Marker for the catalog document format this app understands. */
export const EXTENSION_CATALOG_FORMAT = 1;

/** Marker for the blocklist document format this app understands. */
export const EXTENSION_BLOCKLIST_FORMAT = 1;

/**
 * One extension offered by a catalog.
 *
 * `downloadUrl` and `sha256` are what turn a listing into an install. The
 * hash is checked against the downloaded bytes *before* anything is unpacked,
 * so a catalog that lies about a bundle fails closed rather than shipping
 * unexpected code into the extraction path.
 */
export interface CatalogExtensionEntry {
  /** Extension id, matching the `id` in the bundle's manifest. */
  id: string;
  /** Semantic version of the offered build. */
  version: string;
  /** Display name for the listing. */
  name: string;
  /** One-line description for the listing. */
  description?: string;
  /** Publisher display name as claimed by the catalog. */
  publisher?: string;
  /** Absolute https URL of the `.zip` bundle. */
  downloadUrl: string;
  /** Lowercase hex SHA-256 of the bundle bytes. */
  sha256: string;
  /** Bundle size in bytes, used for the download progress UI and a sanity cap. */
  sizeBytes?: number;
  /** Permissions the bundle declares, shown before download. */
  permissions?: string[];
  /** Host app version range this build supports (`engines.bibleApp`). */
  engines?: string;
  /** Publisher homepage for the listing. */
  homepage?: string;
  /**
   * Hex-encoded Ed25519 public key the catalog claims signs this extension.
   *
   * Advisory only. The key that decides the trust tier is the one inside the
   * downloaded package, checked against the app's own trusted-publisher set -
   * a catalog cannot promote itself by naming a key here.
   */
  publisherKey?: string;
}

/** A fetched catalog document. */
export interface ExtensionCatalog {
  /** Document format marker. Must equal {@link EXTENSION_CATALOG_FORMAT}. */
  format: number;
  /** Human-readable catalog name, shown in the source list. */
  name: string;
  /** Optional catalog homepage / terms. */
  homepage?: string;
  /** Offered extensions. May be empty - an empty catalog is valid. */
  extensions: CatalogExtensionEntry[];
}

/**
 * One blocklist rule.
 *
 * Granularity is per-extension-id plus an optional version range, so a bad
 * 1.4.2 does not condemn 1.4.1 forever. Omitting `versions` blocks every
 * version of the id, which is the right default for "this extension is
 * malicious" as opposed to "this build has a bug".
 */
export interface BlocklistEntry {
  /** Extension id this rule applies to. */
  id: string;
  /**
   * Semver range of affected versions (e.g. `'>=1.4.0 <1.4.3'`). Absent means
   * every version.
   */
  versions?: string;
  /**
   * User-facing explanation, shown when the extension refuses to activate.
   * Required: an extension that will not run without saying why is a support
   * ticket, not a safety feature.
   */
  reason: string;
  /** Optional URL with more detail (advisory, changelog, CVE). */
  url?: string;
}

/** A fetched blocklist document. */
export interface ExtensionBlocklist {
  /** Document format marker. Must equal {@link EXTENSION_BLOCKLIST_FORMAT}. */
  format: number;
  /** Blocked entries. An empty list is valid and means "nothing is blocked". */
  entries: BlocklistEntry[];
}

/** Validation outcome. `errors` is non-empty exactly when `ok` is false. */
export type CatalogValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

// --- Validation ------------------------------------------------------------

/**
 * Validate an already-parsed catalog document.
 *
 * Malformed *entries* are dropped rather than failing the whole document: one
 * bad listing in a catalog of fifty should not make the other forty-nine
 * un-installable. A document that is structurally wrong (not an object, wrong
 * format marker, `extensions` not an array) fails outright, because at that
 * point there is nothing to salvage and silently returning an empty catalog
 * would look identical to a catalog that legitimately offers nothing.
 */
export function validateExtensionCatalog(
  input: unknown,
): CatalogValidationResult<ExtensionCatalog> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ['catalog: expected a JSON object'] };
  }
  if (input.format !== EXTENSION_CATALOG_FORMAT) {
    return {
      ok: false,
      errors: [
        `catalog.format: expected ${EXTENSION_CATALOG_FORMAT}, got ${JSON.stringify(input.format)}`,
      ],
    };
  }
  const name = typeof input.name === 'string' && input.name.length > 0 ? input.name : undefined;
  if (name === undefined) errors.push('catalog.name: required non-empty string');

  if (!Array.isArray(input.extensions)) {
    errors.push('catalog.extensions: expected an array');
    return { ok: false, errors };
  }

  const entries: CatalogExtensionEntry[] = [];
  input.extensions.forEach((raw, i) => {
    const entry = validateCatalogEntry(raw, `catalog.extensions[${i}]`);
    if (entry.ok) {
      entries.push(entry.value);
    } else {
      errors.push(...entry.errors);
    }
  });

  if (name === undefined) return { ok: false, errors };

  const catalog: ExtensionCatalog = { format: EXTENSION_CATALOG_FORMAT, name, extensions: entries };
  if (typeof input.homepage === 'string') catalog.homepage = input.homepage;
  return { ok: true, value: catalog };
}

/**
 * Validate one catalog entry. Exported so the install path can re-check a
 * single entry it was handed without re-validating the whole document.
 */
export function validateCatalogEntry(
  input: unknown,
  path: string,
): CatalogValidationResult<CatalogExtensionEntry> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [`${path}: expected an object`] };
  }

  const id = requireString(input.id, `${path}.id`, errors);
  const version = requireString(input.version, `${path}.version`, errors);
  const name = requireString(input.name, `${path}.name`, errors);
  const downloadUrl = requireString(input.downloadUrl, `${path}.downloadUrl`, errors);
  const sha256 = requireString(input.sha256, `${path}.sha256`, errors);

  // https only, and checked here rather than at fetch time so a bad entry is
  // reported while the user is still looking at the catalog. `NetworkGateway`
  // re-checks the scheme and refuses downgrades on every redirect hop.
  if (downloadUrl !== undefined && !/^https:\/\//i.test(downloadUrl)) {
    errors.push(`${path}.downloadUrl: must be an https URL`);
  }
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(sha256)) {
    errors.push(`${path}.sha256: must be 64 hex characters`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const entry: CatalogExtensionEntry = {
    id: id!,
    version: version!,
    name: name!,
    downloadUrl: downloadUrl!,
    // Normalized so the comparison against the computed digest is a plain
    // string equality rather than a case-insensitive one at each call site.
    sha256: sha256!.toLowerCase(),
  };
  if (typeof input.description === 'string') entry.description = input.description;
  if (typeof input.publisher === 'string') entry.publisher = input.publisher;
  if (typeof input.sizeBytes === 'number' && input.sizeBytes > 0) {
    entry.sizeBytes = input.sizeBytes;
  }
  if (Array.isArray(input.permissions)) {
    entry.permissions = input.permissions.filter((p): p is string => typeof p === 'string');
  }
  if (typeof input.engines === 'string') entry.engines = input.engines;
  if (typeof input.homepage === 'string') entry.homepage = input.homepage;
  if (typeof input.publisherKey === 'string') entry.publisherKey = input.publisherKey;
  return { ok: true, value: entry };
}

/**
 * Validate an already-parsed blocklist document.
 *
 * Unlike the catalog, a malformed *entry* here is dropped silently-but-counted
 * rather than failing the document, and for the same reason inverted: a
 * blocklist that fails to parse leaves users running software the publisher
 * has declared dangerous. Salvaging the readable rules is the safer failure.
 */
export function validateExtensionBlocklist(
  input: unknown,
): CatalogValidationResult<ExtensionBlocklist> {
  if (!isRecord(input)) {
    return { ok: false, errors: ['blocklist: expected a JSON object'] };
  }
  if (input.format !== EXTENSION_BLOCKLIST_FORMAT) {
    return {
      ok: false,
      errors: [
        `blocklist.format: expected ${EXTENSION_BLOCKLIST_FORMAT}, got ${JSON.stringify(input.format)}`,
      ],
    };
  }
  if (!Array.isArray(input.entries)) {
    return { ok: false, errors: ['blocklist.entries: expected an array'] };
  }

  const errors: string[] = [];
  const entries: BlocklistEntry[] = [];
  input.entries.forEach((raw, i) => {
    const path = `blocklist.entries[${i}]`;
    if (!isRecord(raw)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    const entryErrors: string[] = [];
    const id = requireString(raw.id, `${path}.id`, entryErrors);
    const reason = requireString(raw.reason, `${path}.reason`, entryErrors);
    if (entryErrors.length > 0) {
      errors.push(...entryErrors);
      return;
    }
    const entry: BlocklistEntry = { id: id!, reason: reason! };
    if (typeof raw.versions === 'string' && raw.versions.length > 0) {
      entry.versions = raw.versions;
    }
    if (typeof raw.url === 'string') entry.url = raw.url;
    entries.push(entry);
  });

  return { ok: true, value: { format: EXTENSION_BLOCKLIST_FORMAT, entries } };
}

// --- Helpers ---------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  path: string,
  errors: string[],
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}: required non-empty string`);
    return undefined;
  }
  return value;
}
