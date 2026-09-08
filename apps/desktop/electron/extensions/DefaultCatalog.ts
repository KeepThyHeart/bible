/**
 * The app's default extension catalog.
 *
 * ## Why this exists as a separate seam
 *
 * Users can add their own catalogs, and there is an *optional* configurable
 * default. That optionality is the whole design, not
 * a placeholder - it is what keeps the `marketplace` trust tier honest.
 *
 * If any catalog could confer `marketplace`, anyone could mint a
 * marketplace-tier extension by publishing a `catalog.json` and telling a user
 * to add it. So the rule is: **only the default catalog promotes**. An
 * extension installed from a user-added catalog is classified exactly like a
 * sideload - `untrusted`, or `signed` if its key happens to be in the app's
 * trusted-publisher anchor.
 *
 * ## Why it is read at classification time, not stored
 *
 * The registry stores *which URL an extension came from* (a historical fact).
 * Whether that URL is currently the default is app state, so it is resolved on
 * every read - exactly like {@link getTrustedPublisherKeys}. Consequences,
 * both intended:
 *
 *   - Configuring a default catalog immediately promotes anything already
 *     installed from that URL.
 *   - Clearing or changing it immediately demotes those installs to
 *     `untrusted`, rather than leaving a stale badge in the database.
 *
 * ## Why it is empty today
 *
 * There is no marketplace yet. An unset default is a legitimate shipped
 * state: catalog browsing still works for user-added sources, and nothing can
 * reach the `marketplace` tier - which is the truthful answer while no
 * curated catalog exists. Setting this is a deployment decision, not a code
 * change.
 */

/**
 * Absolute https URL of the curated catalog, or `undefined` when the app
 * ships without one.
 *
 * Setting this is a security decision: every extension installed from this URL
 * is badged as coming from the official marketplace, which users will read as
 * a stronger claim than "someone signed it".
 */
const BUNDLED_DEFAULT_CATALOG_URL: string | undefined = undefined;

/**
 * URL of the app's extension blocklist, or `undefined` when the app ships
 * without one.
 *
 * **Only the app's own blocklist is honored - never a catalog's.** Blocking
 * means an installed extension refuses to activate, which is a denial-of-
 * service primitive: if any user-added catalog could publish block rules, one
 * catalog could disable a competitor's extension on every machine that had
 * ever added it. The symmetry with the catalog rule is deliberate - only the
 * app promotes, and only the app blocks.
 */
const BUNDLED_BLOCKLIST_URL: string | undefined = undefined;

/** Test-only override; `undefined` restores the bundled value. */
let overrideUrl: string | undefined;
let overrideActive = false;
let overrideBlocklistUrl: string | undefined;
let overrideBlocklistActive = false;

/**
 * The default catalog URL currently in force, or `undefined` if the app has
 * none. Read through this rather than importing the constant so the test hook
 * applies everywhere.
 */
export function getDefaultCatalogUrl(): string | undefined {
  return overrideActive ? overrideUrl : BUNDLED_DEFAULT_CATALOG_URL;
}

/**
 * True when `url` is the app's default catalog.
 *
 * A `undefined` URL is never the default - an extension with no recorded
 * source did not come from a catalog at all. And when the app has no default
 * configured, nothing matches, so nothing is promoted.
 */
export function isDefaultCatalogUrl(url: string | undefined): boolean {
  if (url === undefined || url.length === 0) return false;
  const current = getDefaultCatalogUrl();
  if (current === undefined) return false;
  return normalizeCatalogUrl(current) === normalizeCatalogUrl(url);
}

/**
 * Canonical form for comparing and storing catalog URLs.
 *
 * Trailing-slash and case differences in the origin are not meaningful, and
 * treating `https://Example.com/c.json` as a different source from
 * `https://example.com/c.json` would let a near-miss URL masquerade as the
 * default in the source list while quietly failing the promotion check. The
 * path is left case-sensitive because paths genuinely are.
 */
export function normalizeCatalogUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    // Not parseable as a URL - return it trimmed so the caller's own
    // validation reports the problem rather than this helper throwing.
    return trimmed;
  }
}

/**
 * Test-only: pretend the app ships with (or without) a default catalog.
 * Pass `undefined` to simulate "no default configured"; call
 * {@link __clearDefaultCatalogUrlForTests} to restore the bundled value.
 */
export function __setDefaultCatalogUrlForTests(url: string | undefined): void {
  overrideUrl = url;
  overrideActive = true;
}

/** Test-only: restore the bundled default. */
export function __clearDefaultCatalogUrlForTests(): void {
  overrideUrl = undefined;
  overrideActive = false;
  overrideBlocklistUrl = undefined;
  overrideBlocklistActive = false;
}

/**
 * The blocklist URL currently in force, or `undefined` when the app has none -
 * in which case nothing is ever blocked, which is the correct behaviour for a
 * build with no marketplace behind it.
 */
export function getBlocklistUrl(): string | undefined {
  return overrideBlocklistActive ? overrideBlocklistUrl : BUNDLED_BLOCKLIST_URL;
}

/** Test-only: pretend the app ships with (or without) a blocklist endpoint. */
export function __setBlocklistUrlForTests(url: string | undefined): void {
  overrideBlocklistUrl = url;
  overrideBlocklistActive = true;
}
