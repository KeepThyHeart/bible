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
 * `OFFICIAL_PUBLIC_KEYS` below. `scripts/yubikey-sign.py` generates the key on
 * a YubiKey (where it can never be copied off) and signs catalogs with it.
 *
 * -- Rotating keys ----------------------------------------------------------
 * A catalog signed by ANY pinned key is accepted, and one catalog can carry
 * several signatures (`CatalogSignature.signatures`). To rotate:
 *   1. Pin the new key alongside the old one and ship a release.
 *   2. Sign the catalog with both keys - the old one first, as the primary
 *      signature, because installs that predate multi-signature support read
 *      only that one.
 *   3. Once the old key is retired, remove it from this list in a later release.
 * An install too old to know the new key can still follow it through a vouch:
 * the old key signs a statement naming the new one (`CatalogKeyVouches.ts`),
 * and the user is asked to approve the new key (`ModuleCatalogService`).
 */

/**
 * Hex-encoded Ed25519 public keys trusted for the official catalog.
 *
 * Non-empty means pinning is enforced: the official catalog must serve a
 * `catalog.json.sig` made by one of these keys, or the app refuses it. (When
 * empty, the official catalog falls back to trust-on-first-use.)
 */
export const OFFICIAL_PUBLIC_KEYS: readonly string[] = [
  // YubiKey 5 NFC - generated on-key
  '1968a4c09125a7e6c0fc3e60b3437b6d2d239766af500d5d4dbf992ccd95f59b',
];

/**
 * URL prefixes considered "official" for pinning purposes. A catalog whose URL
 * starts with one of these must satisfy `OFFICIAL_PUBLIC_KEYS`.
 */
export const OFFICIAL_CATALOG_URL_PREFIXES: readonly string[] = [
  'https://modules.bible.keepthyheart.com/',
];

/** Test-only override; `undefined` restores the bundled set. */
let overrideKeys: readonly string[] | undefined;

/**
 * The pinned official keys in force. Read through this rather than the
 * constant so the test hook applies everywhere.
 */
export function getOfficialPublicKeys(): readonly string[] {
  return overrideKeys ?? OFFICIAL_PUBLIC_KEYS;
}

/**
 * Test-only: swap the pinned set so the official-catalog paths can be
 * exercised with a key the test holds. Pass `undefined` to restore. Mirrors
 * `__setTrustedPublisherKeysForTests`.
 */
export function __setOfficialPublicKeysForTests(keys: readonly string[] | undefined): void {
  overrideKeys = keys;
}

/**
 * The official URL prefix `url` falls under, or undefined. The prefix is also
 * the `scope` a key vouch has to name.
 */
export function officialCatalogScope(url: string): string | undefined {
  const normalized = url.toLowerCase();
  return OFFICIAL_CATALOG_URL_PREFIXES.find((prefix) =>
    normalized.startsWith(prefix.toLowerCase()),
  );
}

/** Whether `url` is an official catalog with pinning in force. */
export function isPinnedOfficialCatalog(url: string): boolean {
  return officialCatalogScope(url) !== undefined && getOfficialPublicKeys().length > 0;
}

/**
 * Resolve the public keys that a catalog at `url` may be signed by.
 *
 * @param url - The catalog source URL.
 * @param recordedKey - Key(s) stored on the catalog row from a previous fetch
 *                      (trust-on-first-use), if any.
 * @param approvedKeys - Keys the user approved for the official catalog from a
 *                       vouch (`ApprovedCatalogKeys`). Ignored for other catalogs.
 * @returns The keys to accept (any one of them), or undefined to accept any
 *          key (first use).
 */
export function resolveExpectedKeys(
  url: string,
  recordedKey?: string | readonly string[],
  approvedKeys: readonly string[] = [],
): readonly string[] | undefined {
  if (isPinnedOfficialCatalog(url)) {
    // Pinned: the recorded key is irrelevant - the compiled-in keys win, plus
    // any the user approved. Every entry counts; accepting only the first
    // would make rotation impossible.
    return [...getOfficialPublicKeys(), ...approvedKeys];
  }

  const recorded = typeof recordedKey === 'string' ? [recordedKey] : (recordedKey ?? []);
  const keys = recorded.filter((key) => key.length > 0);
  return keys.length > 0 ? keys : undefined;
}

/**
 * Whether a catalog at `url` must serve a signature.
 *
 * Always true for the official catalog once a key is pinned - at that point an
 * unsigned official catalog is a downgrade attack, not a legacy configuration.
 */
export function isSignatureRequired(url: string, hadSignatureBefore: boolean): boolean {
  if (isPinnedOfficialCatalog(url)) {
    return true;
  }

  // For any other source: once signed, always signed.
  return hadSignatureBefore;
}
