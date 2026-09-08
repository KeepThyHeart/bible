/**
 * Extension blocklist / kill-switch.
 *
 * ## The shape of this feature was a decision, not a default
 *
 * VS Code auto-uninstalls blocked extensions. This app deliberately does not,
 * and both halves of that decision are encoded here:
 *
 * **1. Fetched only when the user asks.** There is no timer, no startup
 * fetch, and no background beacon. `refresh()` is called from the manual
 * "Check for Updates" flow and nowhere else. This is the same
 * persecuted-user model that drove the master offline switch: an app that
 * silently phones home on a schedule tells a network observer when it is
 * running, and the blocklist is not worth that.
 *
 * The accepted cost is real and should not be papered over - a user who never
 * checks for updates never receives block rules. That is a deliberate trade,
 * not an oversight.
 *
 * **2. Blocked means refuse-to-activate, never delete.** The app declines to
 * run the code and says why. It does not remove software the user installed,
 * and it does not touch their data. `check()` is consulted at activation;
 * nothing in this module writes to the filesystem or the extension registry.
 *
 * ## Only the app's own blocklist is honored
 *
 * See `DefaultCatalog.getBlocklistUrl`. Block rules from a user-added catalog
 * are never fetched, because "disable this extension everywhere" is a
 * capability no third-party catalog should have.
 *
 * ## Matching
 *
 * Rules are per-extension-id plus an optional semver range, so a bad `1.4.2`
 * does not condemn `1.4.1` forever. A rule with no range blocks every version,
 * which is what "this extension is malicious" needs.
 */

import log from 'electron-log/main';
import type { ISql } from '@bible/core';
import { Extensions } from '@bible/core';

import { UPDATE_CHECK_TIMEOUT_MS, UPDATE_MAX_RESPONSE_BYTES } from '../../config/constants';
import {
  getNetworkGateway,
  NetworkBlockedError,
  type INetworkGateway,
} from '../../services/NetworkGateway';
import { getBlocklistUrl } from '../DefaultCatalog';
import { satisfies } from '../semverRange';

type BlocklistEntry = Extensions.BlocklistEntry;

const { validateExtensionBlocklist } = Extensions;

/** Why an extension is refusing to run. */
export interface BlockDecision {
  extensionId: string;
  /** The matched rule's user-facing explanation. */
  reason: string;
  /** Advisory URL from the rule, if any. */
  url?: string;
  /** The version range that matched, or `undefined` for an all-versions rule. */
  versions?: string;
}

export type BlocklistErrorCode = 'NotConfigured' | 'Offline' | 'FetchFailed' | 'InvalidDocument';

export interface BlocklistError {
  ok: false;
  code: BlocklistErrorCode;
  message: string;
  detail?: string[];
}

export interface BlocklistRefreshResult {
  ok: true;
  /** How many rules are now in force. */
  ruleCount: number;
  fetchedAt: number;
}

interface BlocklistRow {
  extension_id: string;
  versions: string | null;
  reason: string;
  url: string | null;
  source_url: string;
  fetched_at: number;
}

export class ExtensionBlocklistService {
  private readonly db: ISql;
  private readonly gateway: () => INetworkGateway;

  constructor(opts: { db: ISql; gateway?: INetworkGateway }) {
    this.db = opts.db;
    const injected = opts.gateway;
    this.gateway = injected ? (): INetworkGateway => injected : getNetworkGateway;
  }

  // --- Fetch (manual update check only) -----------------------------------

  /**
   * Fetch the app's blocklist and replace the stored rules.
   *
   * **Call this only from a user-initiated update check.** Nothing else should
   * reach it; see the header for why.
   *
   * A failed fetch leaves the previously stored rules in place. Dropping them
   * would silently un-block extensions the publisher has declared dangerous
   * because a request timed out.
   */
  async refresh(): Promise<BlocklistRefreshResult | BlocklistError> {
    const url = getBlocklistUrl();
    if (url === undefined) {
      // A build with no marketplace behind it blocks nothing. Not an error -
      // the caller (an update check) should not surface this to the user.
      return {
        ok: false,
        code: 'NotConfigured',
        message: 'This build has no extension blocklist endpoint.',
      };
    }

    let body: Buffer;
    try {
      const response = await this.gateway().fetchBuffered({
        url,
        method: 'GET',
        maxResponseBytes: UPDATE_MAX_RESPONSE_BYTES,
        timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
        context: 'extension blocklist fetch',
      });
      if (response.status !== 200) {
        return {
          ok: false,
          code: 'FetchFailed',
          message: `Blocklist fetch failed: HTTP ${response.status}`,
        };
      }
      body = response.body;
    } catch (err) {
      if (err instanceof NetworkBlockedError) {
        return {
          ok: false,
          code: 'Offline',
          message: 'The app is in offline mode, so the blocklist was not refreshed.',
        };
      }
      return {
        ok: false,
        code: 'FetchFailed',
        message: `Blocklist fetch failed: ${(err as Error).message}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf-8'));
    } catch (err) {
      return {
        ok: false,
        code: 'InvalidDocument',
        message: `Blocklist is not valid JSON: ${(err as Error).message}`,
      };
    }

    const validated = validateExtensionBlocklist(parsed);
    if (!validated.ok) {
      return {
        ok: false,
        code: 'InvalidDocument',
        message: 'Blocklist document is invalid.',
        detail: validated.errors,
      };
    }

    // Replace-all for this source: rules are removed by disappearing from the
    // document, so a merge would make un-blocking impossible.
    const now = Date.now();
    this.db.execute('DELETE FROM extension_blocklist WHERE source_url = ?', [url]);
    for (const entry of validated.value.entries) {
      this.db.execute(
        'INSERT INTO extension_blocklist (extension_id, versions, reason, url, source_url, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
        [entry.id, entry.versions ?? null, entry.reason, entry.url ?? null, url, now],
      );
    }
    log.info(`[ExtensionBlocklist] Refreshed: ${validated.value.entries.length} rule(s) in force`);
    return { ok: true, ruleCount: validated.value.entries.length, fetchedAt: now };
  }

  // --- Query --------------------------------------------------------------

  /**
   * The rule blocking this extension at this version, or `undefined`.
   *
   * An unparseable version in a *rule* is treated as non-matching rather than
   * matching: a malformed range must not become a wildcard that disables
   * unrelated extensions.
   */
  check(extensionId: string, version: string): BlockDecision | undefined {
    const rows = this.db.queryAll<BlocklistRow>(
      'SELECT extension_id, versions, reason, url, source_url, fetched_at FROM extension_blocklist WHERE extension_id = ?',
      [extensionId],
    );
    for (const row of rows) {
      if (row.versions !== null && !safeSatisfies(version, row.versions)) continue;
      const decision: BlockDecision = { extensionId, reason: row.reason };
      if (row.url !== null) decision.url = row.url;
      if (row.versions !== null) decision.versions = row.versions;
      return decision;
    }
    return undefined;
  }

  /** Every stored rule, for the Extensions UI and diagnostics. */
  list(): BlocklistEntry[] {
    const rows = this.db.queryAll<BlocklistRow>(
      'SELECT extension_id, versions, reason, url, source_url, fetched_at FROM extension_blocklist',
    );
    return rows.map((row) => {
      const entry: BlocklistEntry = { id: row.extension_id, reason: row.reason };
      if (row.versions !== null) entry.versions = row.versions;
      if (row.url !== null) entry.url = row.url;
      return entry;
    });
  }

  /** Drop all stored rules. Used by tests and by a full data reset. */
  clear(): void {
    this.db.execute('DELETE FROM extension_blocklist');
  }
}

/**
 * `satisfies` with a malformed range treated as "does not match".
 *
 * The default has to fail *open* here even though the module generally fails
 * closed, because the alternative is worse: a typo in one published range
 * would otherwise silently disable an extension for every user, with a reason
 * string that does not explain it.
 */
function safeSatisfies(version: string, range: string): boolean {
  try {
    return satisfies(version, range);
  } catch {
    log.warn(`[ExtensionBlocklist] Ignoring unparseable version range: ${range}`);
    return false;
  }
}
