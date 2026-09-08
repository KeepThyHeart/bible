/**
 * Extension catalog service.
 *
 * Owns the list of catalogs the user is willing to browse, fetching each one
 * through the app's single `NetworkGateway`, and caching the last good
 * document so the Extensions UI has something to show while offline.
 *
 * ## The two rules that shape this class
 *
 * **1. A non-default catalog must be acknowledged before it is ever fetched.**
 * Users can add their own catalogs, but must accept the risk explicitly.
 * That acceptance is enforced here, at the fetch
 * boundary, not in the UI - a renderer bug, an IPC caller, or a future
 * headless path must not be able to skip it. A source with no
 * `riskAcknowledgedAt` is inert: it appears in the list, and every attempt to
 * fetch it fails with `RiskNotAcknowledged`.
 *
 * **2. Adding a catalog is not the same as trusting its contents.** Nothing
 * in this file grants trust. The `marketplace` tier is decided at
 * classification time by `DefaultCatalog.isDefaultCatalogUrl`, and the
 * signature check happens after download against the app's own publisher
 * anchor. A catalog is a list of claims; this class only decides whether we
 * are willing to *read* the list.
 *
 * ## Offline behaviour
 *
 * `NetworkGateway` refuses every request when the master offline switch is
 * engaged, so `refresh()` fails cleanly with `Offline` and the cached
 * document - if any - remains readable. Browsing a previously fetched catalog
 * offline is a feature, not an accident.
 */

import log from 'electron-log/main';
import type { ISql } from '@bible/core';
import { Extensions } from '@bible/core';

import { CATALOG_MAX_RESPONSE_BYTES, UPDATE_CHECK_TIMEOUT_MS } from '../../config/constants';
import {
  getNetworkGateway,
  NetworkBlockedError,
  type INetworkGateway,
} from '../../services/NetworkGateway';
import { getDefaultCatalogUrl, isDefaultCatalogUrl, normalizeCatalogUrl } from '../DefaultCatalog';

type ExtensionCatalog = Extensions.ExtensionCatalog;
type CatalogExtensionEntry = Extensions.CatalogExtensionEntry;

const { validateExtensionCatalog } = Extensions;

/** A catalog the user has added, plus the app's own default. */
export interface CatalogSource {
  /** Normalized absolute https URL. */
  url: string;
  /** User-supplied label, or the catalog's own name once fetched. */
  label?: string;
  /**
   * True when this is the app's configured default catalog. Derived, not
   * stored - changing the default reclassifies sources immediately.
   */
  isDefault: boolean;
  /** Epoch ms when the user added it. */
  addedAt: number;
  /**
   * Epoch ms when the user accepted the risk warning. Absent means the source
   * is inert: it is listed but will not be fetched.
   */
  riskAcknowledgedAt?: number;
  /** Epoch ms of the last successful fetch. */
  lastFetchedAt?: number;
  /** Message from the last failed fetch, if the last attempt failed. */
  lastError?: string;
  /** True when a previously fetched document is cached locally. */
  hasCachedDocument: boolean;
}

/** One listing, tagged with the catalog it came from. */
export interface CatalogListing extends CatalogExtensionEntry {
  /** Catalog this listing was read from. */
  sourceUrl: string;
  /** True when `sourceUrl` is the app's configured default catalog. */
  fromDefaultCatalog: boolean;
}

export type CatalogErrorCode =
  | 'InvalidUrl'
  | 'DuplicateSource'
  | 'UnknownSource'
  | 'RiskNotAcknowledged'
  | 'Offline'
  | 'FetchFailed'
  | 'InvalidDocument';

export interface CatalogError {
  ok: false;
  code: CatalogErrorCode;
  message: string;
  /** Validation messages when `code === 'InvalidDocument'`. */
  detail?: string[];
}

export interface CatalogRefreshResult {
  ok: true;
  url: string;
  catalog: ExtensionCatalog;
}

interface SourceRow {
  url: string;
  label: string | null;
  added_at: number;
  risk_acknowledged_at: number | null;
  last_fetched_at: number | null;
  last_error: string | null;
  cached_document: string | null;
}

export class ExtensionCatalogService {
  private readonly db: ISql;
  private readonly gateway: () => INetworkGateway;

  constructor(opts: { db: ISql; gateway?: INetworkGateway }) {
    this.db = opts.db;
    const injected = opts.gateway;
    this.gateway = injected ? (): INetworkGateway => injected : getNetworkGateway;
  }

  // --- Source management --------------------------------------------------

  /**
   * Every catalog the app knows about.
   *
   * The configured default is synthesized into the list even when it has no
   * row yet, so it is browsable on a fresh install without the user having to
   * add anything. It never needs a risk acknowledgement - it is the catalog
   * the app itself points at.
   */
  listSources(): CatalogSource[] {
    const rows = this.db.queryAll<SourceRow>(
      'SELECT url, label, added_at, risk_acknowledged_at, last_fetched_at, last_error, cached_document FROM extension_catalog_source ORDER BY added_at',
    );
    const sources = rows.map((row) => this.toSource(row));

    const defaultUrl = getDefaultCatalogUrl();
    if (defaultUrl !== undefined && !sources.some((s) => s.isDefault)) {
      sources.unshift({
        url: normalizeCatalogUrl(defaultUrl),
        isDefault: true,
        addedAt: 0,
        // Synthesized, so it is implicitly acknowledged: shipping a default
        // catalog *is* the app vouching for it.
        riskAcknowledgedAt: 0,
        hasCachedDocument: false,
      });
    }
    return sources;
  }

  /**
   * Add a catalog source.
   *
   * `acknowledgeRisk` is required for anything that is not the app's default
   * catalog. Callers pass `true` only after the user has seen and accepted the
   * warning; passing it unconditionally would defeat the point.
   */
  addSource(opts: {
    url: string;
    label?: string;
    acknowledgeRisk?: boolean;
  }): { ok: true; source: CatalogSource } | CatalogError {
    const normalized = normalizeCatalogUrl(opts.url);
    if (!/^https:\/\/.+/i.test(normalized)) {
      return {
        ok: false,
        code: 'InvalidUrl',
        message: 'A catalog URL must be an absolute https URL.',
      };
    }
    const existing = this.getRow(normalized);
    if (existing) {
      return {
        ok: false,
        code: 'DuplicateSource',
        message: `Catalog ${normalized} has already been added.`,
      };
    }

    const now = Date.now();
    // The default catalog needs no acknowledgement; anything else does, and an
    // un-acknowledged source is stored rather than rejected so the UI can show
    // it in a "needs your confirmation" state instead of losing what the user
    // typed.
    const acknowledged = isDefaultCatalogUrl(normalized) || opts.acknowledgeRisk === true;
    this.db.execute(
      'INSERT INTO extension_catalog_source (url, label, added_at, risk_acknowledged_at) VALUES (?, ?, ?, ?)',
      [normalized, opts.label ?? null, now, acknowledged ? now : null],
    );
    return { ok: true, source: this.toSource(this.getRow(normalized)!) };
  }

  /** Record that the user accepted the risk warning for a source. */
  acknowledgeRisk(url: string): { ok: true } | CatalogError {
    const normalized = normalizeCatalogUrl(url);
    if (!this.getRow(normalized)) {
      return { ok: false, code: 'UnknownSource', message: `No catalog source ${normalized}.` };
    }
    this.db.execute(
      'UPDATE extension_catalog_source SET risk_acknowledged_at = ? WHERE url = ?',
      [Date.now(), normalized],
    );
    return { ok: true };
  }

  /**
   * Forget a catalog source and its cached document.
   *
   * Extensions already installed from it are deliberately left alone. Removing
   * a source says "stop showing me this list", not "uninstall what I got from
   * it" - and their `source_catalog_url` stays recorded, so if the source is
   * added back the provenance is still accurate.
   */
  removeSource(url: string): void {
    this.db.execute('DELETE FROM extension_catalog_source WHERE url = ?', [
      normalizeCatalogUrl(url),
    ]);
  }

  // --- Fetch --------------------------------------------------------------

  /**
   * Fetch and cache one catalog.
   *
   * Failures update `last_error` but never clear a previously cached document:
   * a transient network problem should not empty the user's view of a catalog
   * they successfully fetched yesterday.
   */
  async refresh(url: string): Promise<CatalogRefreshResult | CatalogError> {
    const normalized = normalizeCatalogUrl(url);
    const row = this.getRow(normalized);
    const isDefault = isDefaultCatalogUrl(normalized);

    if (!row && !isDefault) {
      return { ok: false, code: 'UnknownSource', message: `No catalog source ${normalized}.` };
    }
    // The acknowledgement gate. Enforced here rather than in the UI so no
    // caller can route around it.
    if (!isDefault && (!row || row.risk_acknowledged_at === null)) {
      return {
        ok: false,
        code: 'RiskNotAcknowledged',
        message:
          'This catalog has not been confirmed. Extensions from a catalog you added are no more vouched-for than a sideloaded file.',
      };
    }

    let body: Buffer;
    try {
      const response = await this.gateway().fetchBuffered({
        url: normalized,
        method: 'GET',
        maxResponseBytes: CATALOG_MAX_RESPONSE_BYTES,
        timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
        context: 'extension catalog fetch',
      });
      if (response.status !== 200) {
        return this.fail(normalized, 'FetchFailed', `Catalog fetch failed: HTTP ${response.status}`);
      }
      body = response.body;
    } catch (err) {
      if (err instanceof NetworkBlockedError) {
        // Do NOT record this as a source error: the user turned the network
        // off deliberately, and flagging the catalog as broken would be
        // misleading the next time they look at the list.
        return {
          ok: false,
          code: 'Offline',
          message: 'The app is in offline mode, so catalogs cannot be refreshed.',
        };
      }
      return this.fail(normalized, 'FetchFailed', `Catalog fetch failed: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch (err) {
      return this.fail(
        normalized,
        'InvalidDocument',
        `Catalog is not valid JSON: ${(err as Error).message}`,
      );
    }

    const validated = validateExtensionCatalog(parsed);
    if (!validated.ok) {
      return this.fail(normalized, 'InvalidDocument', 'Catalog document is invalid.', validated.errors);
    }

    const now = Date.now();
    // A default catalog with no row yet gets one on first successful fetch, so
    // the cache and the timestamps have somewhere to live.
    if (!this.getRow(normalized)) {
      this.db.execute(
        'INSERT INTO extension_catalog_source (url, label, added_at, risk_acknowledged_at) VALUES (?, ?, ?, ?)',
        [normalized, validated.value.name, now, now],
      );
    }
    this.db.execute(
      'UPDATE extension_catalog_source SET last_fetched_at = ?, last_error = NULL, cached_document = ?, label = COALESCE(label, ?) WHERE url = ?',
      [now, JSON.stringify(validated.value), validated.value.name, normalized],
    );
    log.info(
      `[ExtensionCatalog] Refreshed ${normalized} (${validated.value.extensions.length} extension(s))`,
    );
    return { ok: true, url: normalized, catalog: validated.value };
  }

  /** Refresh every acknowledged source, reporting per-source outcomes. */
  async refreshAll(): Promise<Array<CatalogRefreshResult | CatalogError>> {
    const results: Array<CatalogRefreshResult | CatalogError> = [];
    for (const source of this.listSources()) {
      if (source.riskAcknowledgedAt === undefined) continue;
      results.push(await this.refresh(source.url));
    }
    return results;
  }

  // --- Reads --------------------------------------------------------------

  /** The last successfully fetched document for a source, if any. */
  getCached(url: string): ExtensionCatalog | undefined {
    const row = this.getRow(normalizeCatalogUrl(url));
    if (!row?.cached_document) return undefined;
    try {
      const validated = validateExtensionCatalog(JSON.parse(row.cached_document));
      // Re-validated on read rather than trusted: the cache is written by this
      // app, but a schema change between versions would otherwise hand stale
      // shapes to the UI.
      return validated.ok ? validated.value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Every cached listing across every source, newest catalog first.
   *
   * Duplicate ids across catalogs are kept rather than merged - which catalog
   * an extension came from changes its trust tier, so collapsing them would
   * hide the thing the user most needs to see.
   */
  listAvailable(): CatalogListing[] {
    const out: CatalogListing[] = [];
    for (const source of this.listSources()) {
      const catalog = this.getCached(source.url);
      if (!catalog) continue;
      for (const entry of catalog.extensions) {
        out.push({ ...entry, sourceUrl: source.url, fromDefaultCatalog: source.isDefault });
      }
    }
    return out;
  }

  /** Find one listing by id, optionally restricted to a single source. */
  findListing(extensionId: string, sourceUrl?: string): CatalogListing | undefined {
    const wanted = sourceUrl !== undefined ? normalizeCatalogUrl(sourceUrl) : undefined;
    return this.listAvailable().find(
      (l) => l.id === extensionId && (wanted === undefined || l.sourceUrl === wanted),
    );
  }

  // --- Internals ----------------------------------------------------------

  private getRow(normalizedUrl: string): SourceRow | undefined {
    return this.db.queryOne<SourceRow>(
      'SELECT url, label, added_at, risk_acknowledged_at, last_fetched_at, last_error, cached_document FROM extension_catalog_source WHERE url = ?',
      [normalizedUrl],
    );
  }

  private toSource(row: SourceRow): CatalogSource {
    const source: CatalogSource = {
      url: row.url,
      isDefault: isDefaultCatalogUrl(row.url),
      addedAt: row.added_at,
      hasCachedDocument: row.cached_document !== null,
    };
    if (row.label !== null) source.label = row.label;
    if (row.risk_acknowledged_at !== null) source.riskAcknowledgedAt = row.risk_acknowledged_at;
    if (row.last_fetched_at !== null) source.lastFetchedAt = row.last_fetched_at;
    if (row.last_error !== null) source.lastError = row.last_error;
    return source;
  }

  /** Record a fetch failure against the source and return the error. */
  private fail(
    url: string,
    code: CatalogErrorCode,
    message: string,
    detail?: string[],
  ): CatalogError {
    if (this.getRow(url)) {
      this.db.execute('UPDATE extension_catalog_source SET last_error = ? WHERE url = ?', [
        message,
        url,
      ]);
    }
    log.warn(`[ExtensionCatalog] ${url}: ${message}`);
    return detail ? { ok: false, code, message, detail } : { ok: false, code, message };
  }
}
