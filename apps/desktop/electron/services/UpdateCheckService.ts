/**
 * UpdateCheckService - the manual, user-initiated "Check for Updates".
 *
 * ## What it is (and, deliberately, is not)
 *
 * This service runs ONLY when the user clicks Help > Check for Updates.... There
 * is:
 *   - no auto-check on launch,
 *   - no background polling / timer,
 *   - no `electron-updater` auto-updater,
 *   - no telemetry beacon.
 *
 * A single click fetches a small version manifest (the GitHub Releases "latest"
 * JSON by default), compares it to the running version, and reports whether a
 * newer release exists - together with a manual download link. Nothing is
 * downloaded or installed automatically.
 *
 * ## Egress goes through the ONE gateway
 *
 * Every network request is made via `getNetworkGateway().fetchBuffered(...)`.
 * That means the master offline switch is honored (an offline app
 * makes no request at all) and the system/Electron proxy is applied. This file
 * opens no socket of its own - the ESLint egress rule allows it precisely
 * because it only calls the gateway.
 *
 * ## Persecuted-user model
 *
 * The host is surfaced to the UI *before* any request via {@link getInfo}, so
 * the renderer can show "this will contact <host>" and require an explicit
 * confirmation. Egress happens only on that second, explicit action.
 */

import { app } from 'electron';
import log from 'electron-log';
import {
  DEFAULT_UPDATE_MANIFEST_URL,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_MAX_RESPONSE_BYTES,
} from '../config/constants';
import { getNetworkGateway, type INetworkGateway } from './NetworkGateway';

/** Pre-flight info the UI shows before contacting anything. */
export interface UpdateCheckInfo {
  /** The host the check will contact (e.g. `api.github.com`). */
  host: string;
  /** The full manifest URL (for logging / advanced display). */
  manifestUrl: string;
  /** The currently running application version. */
  currentVersion: string;
  /** True when the master offline switch is engaged - the check is blocked. */
  offline: boolean;
  /** False when no manifest URL is configured for this build. */
  configured: boolean;
}

export type UpdateCheckOutcome =
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string; host: string }
  | {
      status: 'update-available';
      currentVersion: string;
      latestVersion: string;
      releaseNotes: string;
      releaseUrl: string;
      host: string;
    }
  | { status: 'offline'; host: string }
  | { status: 'not-configured' }
  | { status: 'error'; message: string; host: string };

/** Shape of the fields we read from a GitHub "latest release" response. */
interface GitHubLatestRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export class UpdateCheckService {
  constructor(private readonly gateway: INetworkGateway = getNetworkGateway()) {}

  /** Resolve the manifest URL (env override -> build default). Empty => unset. */
  private manifestUrl(): string {
    const override =
      typeof process !== 'undefined' && process.env
        ? (process.env.BIBLE_UPDATE_MANIFEST_URL ?? '').trim()
        : '';
    return override !== '' ? override : DEFAULT_UPDATE_MANIFEST_URL;
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  /**
   * Pre-flight info for the confirmation step. Makes NO network request - it
   * only reports which host would be contacted and whether offline mode blocks
   * the check, so the UI can ask the user before any egress happens.
   */
  getInfo(): UpdateCheckInfo {
    const manifestUrl = this.manifestUrl();
    return {
      host: this.hostOf(manifestUrl),
      manifestUrl,
      currentVersion: app.getVersion(),
      offline: this.gateway.isOffline(),
      configured: manifestUrl !== '',
    };
  }

  /**
   * Perform the actual check. Call ONLY after the user has confirmed the host.
   * Returns a typed outcome; never throws for expected failures (offline,
   * network error, malformed manifest).
   */
  async check(): Promise<UpdateCheckOutcome> {
    const manifestUrl = this.manifestUrl();
    const host = this.hostOf(manifestUrl);
    const currentVersion = app.getVersion();

    if (manifestUrl === '') {
      return { status: 'not-configured' };
    }
    // Belt-and-suspenders: the gateway also refuses when offline, but bail here
    // so the UI gets a clean "offline" outcome rather than a thrown error.
    if (this.gateway.isOffline()) {
      return { status: 'offline', host };
    }

    let latest: GitHubLatestRelease;
    try {
      const res = await this.gateway.fetchBuffered({
        url: manifestUrl,
        method: 'GET',
        headers: {
          // GitHub asks for an explicit Accept + User-Agent. The UA is
          // generic - it must not say "Bible".
          Accept: 'application/vnd.github+json',
          'User-Agent': `App/${currentVersion} (${process.platform} ${process.arch})`,
        },
        maxResponseBytes: UPDATE_MAX_RESPONSE_BYTES,
        timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
        context: 'update check',
      });

      if (res.status < 200 || res.status >= 300) {
        return { status: 'error', message: `HTTP ${res.status}`, host };
      }
      latest = JSON.parse(res.body.toString('utf8')) as GitHubLatestRelease;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('[update] check failed:', message);
      return { status: 'error', message, host };
    }

    const latestVersion = normalizeVersion(latest.tag_name ?? latest.name ?? '');
    if (latestVersion === '') {
      return { status: 'error', message: 'Manifest had no version', host };
    }

    if (isNewer(latestVersion, currentVersion)) {
      return {
        status: 'update-available',
        currentVersion,
        latestVersion,
        releaseNotes: (latest.body ?? '').trim(),
        releaseUrl: latest.html_url ?? '',
        host,
      };
    }
    return { status: 'up-to-date', currentVersion, latestVersion, host };
  }
}

/** Strip a leading `v` and surrounding whitespace: `v1.2.3` -> `1.2.3`. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

/**
 * True when `candidate` is a strictly newer semantic version than `current`.
 * Compares the numeric `major.minor.patch` triples only; any pre-release
 * suffix is ignored for the comparison (a tagged release is what ships). A
 * version that can't be parsed compares as not-newer, failing safe (we won't
 * nag the user about an update we can't understand).
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseTriple(candidate);
  const b = parseTriple(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function parseTriple(version: string): [number, number, number] | null {
  const core = normalizeVersion(version).split(/[-+]/, 1)[0] ?? '';
  const parts = core.split('.');
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (let i = 0; i < 3; i++) {
    const n = Number.parseInt(parts[i] ?? '0', 10);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return [nums[0], nums[1], nums[2]];
}
