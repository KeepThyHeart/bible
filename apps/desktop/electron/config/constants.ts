// Centralized magic numbers and tunables for the Electron main process.
// Keep names descriptive and exported so tests can import them directly.

/**
 * Minimum interval between automatic on-disk backups of a single notes file.
 * Edits within this window are coalesced into the most recent backup so we
 * don't churn the filesystem on every keystroke.
 */
export const NOTES_BACKUP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Maximum time the main process waits for the renderer to acknowledge a
 * session-save request during shutdown. If the renderer is frozen or already
 * gone, we surrender after this and let the app close so users aren't held
 * hostage by a dead UI.
 */
export const SESSION_SAVE_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Diagnostics & issue reporting tunables.
 */
export const DIAGNOSTICS_QUEUE_MAX = 50;
export const DIAGNOSTICS_RING_SIZE = 20;
export const DIAGNOSTICS_CRASHES_PER_SESSION_CAP = 10;
// Diagnostics is strictly opt-IN: a stock build never contacts a
// diagnostics endpoint until the user explicitly enables it. The uploader's
// `start()` is additionally gated on this flag in `main.ts`.
export const DIAGNOSTICS_DEFAULT_ENABLED = false;

declare const __BIBLE_DIAGNOSTICS_URL__: string | undefined;
declare const __BIBLE_DIAGNOSTICS_TOKEN__: string | undefined;

/**
 * Default destination for queued reports, baked in at build time from
 * `BIBLE_DIAGNOSTICS_URL`. Empty means this build has no destination, and the
 * uploader stays silent -- the user can still set one in Preferences.
 *
 * Note this is only a *default*: it seeds `DiagnosticsConfig` on first run and
 * a user-set endpoint overrides it. Enabling diagnostics remains opt-in either
 * way; a URL alone sends nothing.
 */
export const DIAGNOSTICS_DEFAULT_ENDPOINT: string =
  typeof __BIBLE_DIAGNOSTICS_URL__ === 'string' ? __BIBLE_DIAGNOSTICS_URL__ : '';

/**
 * Shared secret presented to that endpoint as `X-Report-Token`.
 *
 * This is not authentication and does not identify the user -- it is the same
 * value in every copy of a given build. Its only job is to keep an open POST
 * endpoint from being trivially discoverable by bots, which is worth doing
 * precisely because the endpoint stores no IP address and so cannot block a
 * flood by origin.
 */
export const DIAGNOSTICS_SHARED_TOKEN: string =
  typeof __BIBLE_DIAGNOSTICS_TOKEN__ === 'string' ? __BIBLE_DIAGNOSTICS_TOKEN__ : '';

/**
 * Uploader tick cadence while the app is running. Each tick drains the queue
 * one report at a time (sequentially, not in parallel) so a hostile endpoint
 * can't trigger a burst of concurrent requests.
 */
export const DIAGNOSTICS_UPLOAD_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Per-request timeout for uploader POSTs. If the request hasn't completed
 * within this window we abort and treat it as a network error (leave the
 * file queued and try again on the next tick).
 */
export const DIAGNOSTICS_UPLOAD_TIMEOUT_MS = 15000;

/**
 * Delay before the uploader's first tick after startup. Gives the app time
 * to finish booting so the first POST doesn't race with window creation and
 * handler registration.
 */
export const DIAGNOSTICS_UPLOAD_INITIAL_DELAY_MS = 5000;

/**
 * Maximum number of HTTP redirects followed by the module catalog fetch and
 * the module downloader before the request is abandoned. Five is the
 * conventional browser limit; without a cap a server that keeps answering 302
 * drives unbounded recursion.
 */
export const NETWORK_MAX_REDIRECTS = 5;

/**
 * Maximum size of a module catalog response body. The catalog is a JSON index
 * (a few hundred KB even for a large repository), so 5 MB is generous while
 * still bounding how much memory a hostile or misconfigured endpoint can make
 * us buffer - the body is accumulated in a string before parsing.
 */
export const CATALOG_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Maximum size of a catalog's detached signature (`catalog.json.sig`). A
 * signature document is a small fixed-shape JSON object (public key +
 * signature bytes as hex, at most `MAX_CATALOG_SIGNATURES` of them), so this
 * is deliberately tiny.
 */
export const CATALOG_SIGNATURE_MAX_RESPONSE_BYTES = 8 * 1024;

/**
 * Maximum size of a catalog's key-vouch document (`catalog.json.vouches`): a
 * few hundred bytes per vouch, and at most `MAX_VOUCHES` of them.
 */
export const CATALOG_VOUCHES_MAX_RESPONSE_BYTES = 32 * 1024;

/**
 * Maximum size of the official catalog index (`index.json`): a short list of
 * catalog URLs and names, at most `MAX_INDEX_CATALOGS` of them.
 */
export const CATALOG_INDEX_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Manual "Check for Updates" tunables.
 *
 * The updater fetches a small version manifest ONLY when the user clicks the
 * Help > Check for Updates... menu item - never on launch, never on a timer - and
 * only through the single `NetworkGateway` (so the master offline switch and the
 * system proxy both apply). `DEFAULT_UPDATE_MANIFEST_URL` points at the GitHub
 * Releases API "latest" endpoint; a build can override it with the
 * `BIBLE_UPDATE_MANIFEST_URL` env var (e.g. a mirror). Empty means "not
 * configured", in which case the check reports that rather than contacting
 * anything.
 */
export const DEFAULT_UPDATE_MANIFEST_URL =
  'https://api.github.com/repos/psrankin/bible/releases/latest';

/** Per-request timeout for the manual update check. */
export const UPDATE_CHECK_TIMEOUT_MS = 15000;

/**
 * Cap on the update-manifest response body. A GitHub "latest release" JSON is a
 * few KB; 1 MB bounds a hostile/misconfigured endpoint while leaving generous
 * headroom for long release notes.
 */
export const UPDATE_MAX_RESPONSE_BYTES = 1024 * 1024;
