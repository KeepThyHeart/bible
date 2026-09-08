/**
 * Compiled-in trust anchors for module catalogs.
 *
 * Keys listed here are pinned: a catalog served from a matching URL prefix
 * MUST be signed by one of the corresponding keys. This is what makes the
 * official catalog resistant to a compromised host or DNS - an attacker who
 * controls the server still cannot produce a signature the app will accept.
 *
 * Catalogs not covered by a pin fall back to trust-on-first-use (the key is
 * recorded on the catalog row when it is added; a later change is surfaced as
 * `untrusted_key`).
 *
 * -- Adding the official key ------------------------------------------------
 * Generate an Ed25519 keypair, keep the private key OFFLINE (never in this
 * repo, never on the web server), and paste the hex-encoded public key into
 * `OFFICIAL_PUBLIC_KEYS` below.
 *
 * Rotation: add the new key alongside the old one, ship a release, then remove
 * the old key in a later release once clients have updated. Two entries are
 * supported simultaneously precisely so rotation does not strand old clients.
 */

/**
 * Hex-encoded Ed25519 public keys trusted for the official catalog.
 *
 * Empty until the project's signing key is generated. While empty, the
 * official catalog is treated as trust-on-first-use like any third-party
 * source - signing is available but not yet enforced.
 */
export const OFFICIAL_PUBLIC_KEYS: readonly string[] = [];

/**
 * URL prefixes considered "official" for pinning purposes. A catalog whose URL
 * starts with one of these must satisfy `OFFICIAL_PUBLIC_KEYS`.
 */
export const OFFICIAL_CATALOG_URL_PREFIXES: readonly string[] = [
  'https://modules.bible.keepthyheart.com/',
];

/**
 * Resolve the public key that a catalog at `url` is required to be signed by.
 *
 * @param url - The catalog source URL.
 * @param recordedKey - Key stored on the catalog row from a previous fetch
 *                      (trust-on-first-use), if any.
 * @returns The key to require, or undefined to accept any key (first use).
 */
export function resolveExpectedKey(
  url: string,
  recordedKey?: string,
): string | undefined {
  const normalized = url.toLowerCase();
  const isOfficial = OFFICIAL_CATALOG_URL_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toLowerCase()),
  );

  if (isOfficial && OFFICIAL_PUBLIC_KEYS.length > 0) {
    // Pinned: the recorded key is irrelevant, the compiled-in key wins.
    return OFFICIAL_PUBLIC_KEYS[0];
  }

  return recordedKey;
}

/**
 * Whether a catalog at `url` must serve a signature.
 *
 * True once the official key is pinned - at that point an unsigned official
 * catalog is a downgrade attack, not a legacy configuration.
 */
export function isSignatureRequired(url: string, hadSignatureBefore: boolean): boolean {
  const normalized = url.toLowerCase();
  const isOfficial = OFFICIAL_CATALOG_URL_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix.toLowerCase()),
  );

  if (isOfficial && OFFICIAL_PUBLIC_KEYS.length > 0) {
    return true;
  }

  // For any other source: once signed, always signed.
  return hadSignatureBefore;
}
