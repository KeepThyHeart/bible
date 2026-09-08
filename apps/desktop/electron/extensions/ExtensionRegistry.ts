/**
 * Extension registry.
 *
 * Backs the extension storage schema and the `IExtensionHost` discovery
 * surface.
 *
 * Owns the canonical state of every known extension: a row per extension in
 * the user DB's `extensions` table, mirrored by an in-memory map for fast
 * synchronous reads from the host. The registry is the single source of
 * truth - `IExtensionHost.listExtensions()` reads from it directly.
 *
 * Lifecycle responsibilities live elsewhere:
 *   - file ops (copy/delete on disk)        -> ExtensionInstaller
 *   - manifest validation                   -> ExtensionManifestLoader / @bible/core
 *   - worker spawn / RPC                    -> ExtensionWorkerProcess
 *   - log + crash diagnostics               -> ExtensionLifecycleLogger
 *
 * The registry just cares about persisted state.
 */

import type { ISql } from '@bible/core';
import { Extensions } from '@bible/core';

import { getTrustedPublisherKeys } from './TrustedPublishers';
import { isDefaultCatalogUrl } from './DefaultCatalog';

type ExtensionManifest = Extensions.ExtensionManifest;
type ExtensionStateInfo = Extensions.ExtensionStateInfo;
type ExtensionStatus = Extensions.ExtensionStatus;
type ExtensionPermission = Extensions.ExtensionPermission;
type SignatureVerificationStatus = Extensions.SignatureVerificationStatus;

interface ExtensionRow {
  id: string;
  version: string;
  install_path: string;
  enabled: number;
  granted_permissions: string;
  installed_at: number;
  updated_at: number;
  last_error: string | null;
  crash_count_session: number;
  signature_status: string | null;
  signature_key: string | null;
  folder_grant_path: string | null;
  folder_grant_date: string | null;
  dev_mode: number;
  source_catalog_url: string | null;
}

/** In-memory record paired with its persisted row. */
interface RegistryEntry {
  manifest: ExtensionManifest;
  installPath: string;
  enabled: boolean;
  status: ExtensionStatus;
  grantedPermissions: ExtensionPermission[];
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  crashCountSession: number;
  signatureStatus?: SignatureVerificationStatus;
  signatureKey?: string;
  folderGrantPath?: string;
  folderGrantDate?: string;
  /** True for an unpacked Developer-Mode extension run in place. */
  devMode: boolean;
  /** Catalog URL this extension was installed from; absent for sideloads. */
  sourceCatalogUrl?: string;
}

export class ExtensionRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(private readonly db: ISql) {}

  // --- Bulk loading --------------------------------------------------------

  /**
   * Replace the in-memory state with the rows currently persisted in the DB.
   * Manifests are NOT loaded here - the host walks the install paths and
   * calls `attachManifest()` once each manifest is parsed. This split lets
   * the registry stay synchronous and lets manifest IO happen in one pass
   * without locking the registry.
   */
  reloadFromDb(): ExtensionRow[] {
    const rows = this.db.queryAll<ExtensionRow>(
      'SELECT id, version, install_path, enabled, granted_permissions, installed_at, updated_at, last_error, crash_count_session, signature_status, signature_key, folder_grant_path, folder_grant_date, dev_mode, source_catalog_url FROM extensions',
    );
    this.entries.clear();
    return rows;
  }

  /**
   * Attach a parsed manifest to a persisted row, materializing a full
   * `RegistryEntry` in memory. Used during boot, after `reloadFromDb()` has
   * returned the rows and the host has loaded each manifest from disk.
   */
  attachManifest(row: ExtensionRow, manifest: ExtensionManifest, status: ExtensionStatus): void {
    this.entries.set(row.id, {
      manifest,
      installPath: row.install_path,
      enabled: row.enabled === 1,
      status,
      grantedPermissions: parsePermissions(row.granted_permissions),
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
      lastError: row.last_error ?? undefined,
      crashCountSession: row.crash_count_session,
      signatureStatus: (row.signature_status as SignatureVerificationStatus) ?? undefined,
      signatureKey: row.signature_key ?? undefined,
      folderGrantPath: row.folder_grant_path ?? undefined,
      folderGrantDate: row.folder_grant_date ?? undefined,
      devMode: row.dev_mode === 1,
      ...(row.source_catalog_url !== null
        ? { sourceCatalogUrl: row.source_catalog_url }
        : {}),
    });
  }

  // --- Reads ---------------------------------------------------------------

  list(): ExtensionStateInfo[] {
    return Array.from(this.entries.values()).map(toStateInfo);
  }

  get(extensionId: string): ExtensionStateInfo | null {
    const entry = this.entries.get(extensionId);
    return entry ? toStateInfo(entry) : null;
  }

  has(extensionId: string): boolean {
    return this.entries.has(extensionId);
  }

  getEntry(extensionId: string): RegistryEntry | undefined {
    return this.entries.get(extensionId);
  }

  /**
   * Iterate every materialized entry. Used by `fireActivationEvent` to find
   * extensions that subscribed to a given event without paying the
   * `toStateInfo` marshaling cost.
   */
  listEntries(): { id: string; entry: RegistryEntry }[] {
    return Array.from(this.entries.entries()).map(([id, entry]) => ({ id, entry }));
  }

  // --- Mutations -----------------------------------------------------------

  /**
   * Insert a brand-new extension row + in-memory entry. Used by the
   * installer after it has copied files and validated the manifest.
   */
  insert(opts: {
    manifest: ExtensionManifest;
    installPath: string;
    grantedPermissions: ExtensionPermission[];
    enabled?: boolean;
    signatureStatus?: SignatureVerificationStatus;
    signatureKey?: string;
    /** True when loading an unpacked directory in Developer Mode. */
    devMode?: boolean;
    /** Catalog URL this came from. Omit for a sideload or dev load. */
    sourceCatalogUrl?: string;
  }): ExtensionStateInfo {
    const now = Date.now();
    const enabled = opts.enabled !== false;
    const devMode = opts.devMode === true;
    this.db.execute(
      `INSERT INTO extensions (id, version, install_path, enabled, granted_permissions, installed_at, updated_at, last_error, crash_count_session, signature_status, signature_key, dev_mode, source_catalog_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?)`,
      [
        opts.manifest.id,
        opts.manifest.version,
        opts.installPath,
        enabled ? 1 : 0,
        JSON.stringify(opts.grantedPermissions),
        now,
        now,
        opts.signatureStatus ?? null,
        opts.signatureKey ?? null,
        devMode ? 1 : 0,
        opts.sourceCatalogUrl ?? null,
      ],
    );

    const entry: RegistryEntry = {
      manifest: opts.manifest,
      installPath: opts.installPath,
      enabled,
      status: enabled ? 'installed' : 'disabled',
      grantedPermissions: opts.grantedPermissions,
      installedAt: now,
      updatedAt: now,
      crashCountSession: 0,
      signatureStatus: opts.signatureStatus,
      signatureKey: opts.signatureKey,
      devMode,
      ...(opts.sourceCatalogUrl !== undefined
        ? { sourceCatalogUrl: opts.sourceCatalogUrl }
        : {}),
    };
    this.entries.set(opts.manifest.id, entry);
    return toStateInfo(entry);
  }

  /**
   * Replace an existing extension row (used by an in-place upgrade once the
   * installer has copied the new files and validated the manifest).
   */
  upsert(opts: {
    manifest: ExtensionManifest;
    installPath: string;
    grantedPermissions: ExtensionPermission[];
    enabled?: boolean;
    signatureStatus?: SignatureVerificationStatus;
    signatureKey?: string;
    /**
     * Only pass this when the *packaging* changed - a packed install being
     * replaced by an unpacked dev load, or the reverse. Omitting it keeps
     * whatever the row already had, which is what a plain version upgrade or a
     * dev hot-reload wants.
     */
    devMode?: boolean;
    /**
     * Only pass this when the *provenance* changed - a catalog install, or a
     * sideload deliberately replacing one. Omitting it keeps whatever the row
     * already had, so a plain version upgrade cannot silently launder a
     * sideload into a marketplace install (or the reverse).
     */
    sourceCatalogUrl?: string;
  }): ExtensionStateInfo {
    if (!this.entries.has(opts.manifest.id)) {
      return this.insert(opts);
    }
    const now = Date.now();
    const enabled = opts.enabled !== false;
    const existing = this.entries.get(opts.manifest.id)!;
    const devMode = opts.devMode ?? existing.devMode;
    const sourceCatalogUrl = opts.sourceCatalogUrl ?? existing.sourceCatalogUrl;
    this.db.execute(
      `UPDATE extensions
         SET version = ?, install_path = ?, enabled = ?, granted_permissions = ?, updated_at = ?, last_error = NULL, signature_status = ?, signature_key = ?, dev_mode = ?, source_catalog_url = ?
       WHERE id = ?`,
      [
        opts.manifest.version,
        opts.installPath,
        enabled ? 1 : 0,
        JSON.stringify(opts.grantedPermissions),
        now,
        opts.signatureStatus ?? null,
        opts.signatureKey ?? null,
        devMode ? 1 : 0,
        sourceCatalogUrl ?? null,
        opts.manifest.id,
      ],
    );

    const updated: RegistryEntry = {
      ...existing,
      manifest: opts.manifest,
      installPath: opts.installPath,
      enabled,
      status: enabled ? 'installed' : 'disabled',
      grantedPermissions: opts.grantedPermissions,
      updatedAt: now,
      lastError: undefined,
      signatureStatus: opts.signatureStatus,
      signatureKey: opts.signatureKey,
      devMode,
      ...(sourceCatalogUrl !== undefined ? { sourceCatalogUrl } : {}),
    };
    this.entries.set(opts.manifest.id, updated);
    return toStateInfo(updated);
  }

  remove(extensionId: string): void {
    this.db.execute('DELETE FROM extensions WHERE id = ?', [extensionId]);
    this.db.execute('DELETE FROM extension_storage WHERE extension_id = ?', [extensionId]);
    this.entries.delete(extensionId);
  }

  setEnabled(extensionId: string, enabled: boolean): void {
    const entry = this.entries.get(extensionId);
    if (!entry) return;
    const now = Date.now();
    this.db.execute(
      'UPDATE extensions SET enabled = ?, updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, now, extensionId],
    );
    entry.enabled = enabled;
    entry.status = computeStatusOnEnable(entry.status, enabled);
    entry.updatedAt = now;
  }

  setStatus(extensionId: string, status: ExtensionStatus, lastError?: string): void {
    const entry = this.entries.get(extensionId);
    if (!entry) return;
    entry.status = status;
    if (lastError !== undefined) {
      entry.lastError = lastError;
      this.db.execute('UPDATE extensions SET last_error = ? WHERE id = ?', [lastError, extensionId]);
    } else if (status === 'installed' || status === 'active') {
      entry.lastError = undefined;
      this.db.execute('UPDATE extensions SET last_error = NULL WHERE id = ?', [extensionId]);
    }
  }

  recordCrash(extensionId: string): number {
    const entry = this.entries.get(extensionId);
    if (!entry) return 0;
    entry.crashCountSession += 1;
    this.db.execute(
      'UPDATE extensions SET crash_count_session = ? WHERE id = ?',
      [entry.crashCountSession, extensionId],
    );
    return entry.crashCountSession;
  }

  resetCrashState(extensionId: string): void {
    const entry = this.entries.get(extensionId);
    if (!entry) return;
    entry.crashCountSession = 0;
    entry.status = entry.enabled ? 'installed' : 'disabled';
    entry.lastError = undefined;
    this.db.execute(
      'UPDATE extensions SET crash_count_session = 0, last_error = NULL WHERE id = ?',
      [extensionId],
    );
  }

  // --- Folder grant management ------------------------------------------

  getFolderGrant(extensionId: string): { path: string; grantedAt: string } | null {
    const entry = this.entries.get(extensionId);
    if (!entry?.folderGrantPath || !entry.folderGrantDate) return null;
    return { path: entry.folderGrantPath, grantedAt: entry.folderGrantDate };
  }

  setFolderGrant(extensionId: string, path: string): void {
    const entry = this.entries.get(extensionId);
    if (!entry) return;
    const grantedAt = new Date().toISOString();
    this.db.execute(
      'UPDATE extensions SET folder_grant_path = ?, folder_grant_date = ? WHERE id = ?',
      [path, grantedAt, extensionId],
    );
    entry.folderGrantPath = path;
    entry.folderGrantDate = grantedAt;
  }

  revokeFolderGrant(extensionId: string): void {
    const entry = this.entries.get(extensionId);
    if (!entry) return;
    this.db.execute(
      'UPDATE extensions SET folder_grant_path = NULL, folder_grant_date = NULL WHERE id = ?',
      [extensionId],
    );
    entry.folderGrantPath = undefined;
    entry.folderGrantDate = undefined;
  }

  setPermissions(extensionId: string, permissions: ExtensionPermission[]): void {
    const entry = this.entries.get(extensionId);
    if (!entry) return;
    const now = Date.now();
    this.db.execute(
      'UPDATE extensions SET granted_permissions = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(permissions), now, extensionId],
    );
    entry.grantedPermissions = permissions;
    entry.updatedAt = now;
  }
}

// --- Helpers --------------------------------------------------------------

function parsePermissions(json: string): ExtensionPermission[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ExtensionPermission[]) : [];
  } catch {
    return [];
  }
}

function toStateInfo(entry: RegistryEntry): ExtensionStateInfo {
  const info: ExtensionStateInfo = {
    manifest: entry.manifest,
    installPath: entry.installPath,
    enabled: entry.enabled,
    status: entry.status,
    grantedPermissions: entry.grantedPermissions,
    installedAt: entry.installedAt,
    updatedAt: entry.updatedAt,
    crashCountSession: entry.crashCountSession,
  };
  if (entry.lastError !== undefined) info.lastError = entry.lastError;
  if (entry.signatureStatus !== undefined) info.signatureStatus = entry.signatureStatus;
  if (entry.signatureKey !== undefined) info.signatureKey = entry.signatureKey;

  // Derived here rather than read from a column: the trusted-publisher set and
  // the default-catalog URL are both *app* state, not extension state, so
  // recomputing on every read means adding or removing a publisher - or
  // configuring a different marketplace - reclassifies existing installs
  // immediately rather than leaving a stale badge in the database.
  //
  // `fromMarketplace` is deliberately narrow: only the app's configured
  // default catalog promotes. An install from a user-added catalog is
  // classified exactly like a sideload, because otherwise anyone could mint a
  // marketplace-tier extension by publishing a `catalog.json`.
  info.trustTier = Extensions.deriveTrustTier({
    ...(entry.signatureStatus !== undefined ? { signatureStatus: entry.signatureStatus } : {}),
    ...(entry.signatureKey !== undefined ? { signatureKey: entry.signatureKey } : {}),
    trustedPublisherKeys: getTrustedPublisherKeys(),
    fromMarketplace: isDefaultCatalogUrl(entry.sourceCatalogUrl),
  });
  if (entry.sourceCatalogUrl !== undefined) info.sourceCatalogUrl = entry.sourceCatalogUrl;
  if (entry.folderGrantPath !== undefined) info.folderGrantPath = entry.folderGrantPath;
  if (entry.folderGrantDate !== undefined) info.folderGrantDate = entry.folderGrantDate;
  if (entry.devMode) info.devMode = true;
  return info;
}

/**
 * When the user toggles `enabled`, only flip status between `installed` and
 * `disabled`. Other lifecycle stages (`active`, `failed`, `auto-disabled`,
 * `setup-required`) are owned by the worker subsystem and should not be
 * blown away by an enable/disable click.
 */
function computeStatusOnEnable(prev: ExtensionStatus, enabled: boolean): ExtensionStatus {
  if (!enabled) return 'disabled';
  if (prev === 'disabled') return 'installed';
  return prev;
}
