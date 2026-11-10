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
 * ## Pre-release channel
 *
 * A stable install asks for `releases/latest`, which GitHub never fills with
 * a pre-release, so stable users are never offered a beta. A pre-release
 * install (`1.0.0-beta.2`) asks for the newest few releases instead
 * (`releases?per_page=10`, same host) and is offered the newest one it is
 * allowed to move to - see {@link pickLatestRelease}. Those rules mirror what
 * `electron-updater` does when it installs (`UpdateInstallService`), so the
 * check never announces a release the installer would then refuse.
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

  /**
   * Resolve the manifest URL (env override -> build default). Empty => unset.
   * A pre-release install reads the release list rather than `latest`, which
   * never includes pre-releases (see "Pre-release channel" above).
   */
  private manifestUrl(): string {
    const override =
      typeof process !== 'undefined' && process.env
        ? (process.env.BIBLE_UPDATE_MANIFEST_URL ?? '').trim()
        : '';
    const url = override !== '' ? override : DEFAULT_UPDATE_MANIFEST_URL;
    return prereleaseChannel(app.getVersion()) !== null ? releaseListUrl(url) : url;
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

    let latest: GitHubLatestRelease | null;
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
      const parsed = JSON.parse(res.body.toString('utf8')) as unknown;
      // `releases/latest` answers one release; the pre-release list answers
      // an array, newest first.
      latest = Array.isArray(parsed)
        ? pickLatestRelease(parsed as GitHubLatestRelease[], currentVersion)
        : (parsed as GitHubLatestRelease);
      if (latest === null) {
        // Nothing published that this install may move to.
        return { status: 'up-to-date', currentVersion, latestVersion: currentVersion, host };
      }
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
 * `releases/latest` -> `releases?per_page=10` on a GitHub API URL; any other
 * URL (a custom manifest) is left alone.
 */
export function releaseListUrl(url: string): string {
  return url.replace(/\/releases\/latest\/?$/, '/releases?per_page=10');
}

interface SemVer {
  core: [number, number, number];
  /** Pre-release identifiers (`beta.2` -> ['beta', '2']); empty for a release. */
  pre: string[];
}

/**
 * Parse `major[.minor[.patch]][-prerelease][+build]`, after `normalizeVersion`.
 * Missing minor/patch read as 0. Returns null for anything else.
 */
function parseVersion(version: string): SemVer | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    normalizeVersion(version)
  );
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    pre: m[4] ? m[4].split('.') : [],
  };
}

/**
 * Semantic-version precedence (semver.org section 11): -1, 0 or 1, or null
 * when either side cannot be parsed. `1.0.0-beta.2 < 1.0.0-beta.10 <
 * 1.0.0-rc.1 < 1.0.0`; build metadata is ignored.
 */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  }
  // A release outranks any of its pre-releases.
  if (x.pre.length === 0 || y.pre.length === 0) {
    return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1; // numeric identifiers sort first
    return p > q ? 1 : -1;
  }
  return 0;
}

/**
 * True when `candidate` is a strictly newer semantic version than `current`,
 * pre-release suffixes included (`1.0.0-beta.2` is newer than
 * `1.0.0-beta.1`). A version that can't be parsed compares as not-newer,
 * failing safe (we won't nag the user about an update we can't understand).
 */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

/** The pre-release channel of a version (`1.0.0-beta.2` -> `beta`), or null. */
export function prereleaseChannel(version: string): string | null {
  return parseVersion(version)?.pre[0] ?? null;
}

/**
 * From a GitHub release list, the newest release this install may move to,
 * or null when there is none. Mirrors electron-updater's GitHub provider for a
 * pre-release install, so the check and the installer agree:
 *
 * - drafts and unparseable tags are ignored;
 * - a stable install takes stable releases only;
 * - a pre-release install takes stable, `alpha` and `beta` releases, except
 *   that a `beta` install does not go back to `alpha`; any other channel
 *   (`rc`, say) is taken only by an install already on that channel.
 */
export function pickLatestRelease(
  releases: readonly GitHubLatestRelease[],
  currentVersion: string
): GitHubLatestRelease | null {
  const current = prereleaseChannel(currentVersion);
  let best: { release: GitHubLatestRelease; version: string } | null = null;
  for (const release of releases) {
    if (!release || typeof release !== 'object' || release.draft) continue;
    const version = normalizeVersion(release.tag_name ?? release.name ?? '');
    if (!parseVersion(version)) continue;
    const channel = prereleaseChannel(version);
    const allowed =
      channel === null ||
      (current !== null &&
        (channel === current ||
          (['alpha', 'beta'].includes(channel) && !(current === 'beta' && channel === 'alpha'))));
    if (!allowed) continue;
    if (!best || compareVersions(version, best.version) === 1) best = { release, version };
  }
  return best?.release ?? null;
}
