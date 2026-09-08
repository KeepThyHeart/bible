/**
 * The app's trust anchor for extension publishers.
 *
 * ## What problem this solves
 *
 * `ExtensionSignatureVerifier` validates a package against the public key
 * stored in that package's own `extension.sig`. That proves the files haven't
 * been altered since signing - real integrity value - but it says nothing
 * about *who* signed. A hostile author generates a keypair, signs their own
 * package, and gets `signatureStatus: 'verified'` exactly like anyone else.
 * Treating that as a "Verified publisher" badge would make the badge
 * meaningless and actively misleading.
 *
 * The set below is the missing half: keys the *app* vouches for, not keys the
 * package vouches for. Only a signature made by one of these promotes an
 * extension to the `signed` tier.
 *
 * ## Why this is a bundled constant
 *
 * There is no single obvious source for trusted keys, and the three plausible
 * answers have very different blast radii. A user-editable list turns social
 * engineering into a trust bypass. A fetched list needs the network gateway,
 * an offline-mode story, and its own signature-checking bootstrap - and the
 * catalog it would come from doesn't exist yet.
 *
 * So this ships the conservative option: a compiled-in list, empty for now.
 * An empty anchor is the *correct* default rather than a placeholder - with no
 * publishers to vouch for, every extension is `untrusted`, which is exactly
 * what the tier model should say today. Publisher identity, key distribution,
 * and revocation are a later concern; this module is the seam they plug into.
 *
 * Note that an empty set costs nothing functionally: trust tiers are about
 * badging and warnings, never installability. Nothing is blocked by having no
 * trusted publishers.
 */

/**
 * Hex-encoded Ed25519 public keys (64 chars) the app vouches for.
 *
 * Adding a key here is a security decision: it grants that publisher the
 * "Verified publisher" badge on every extension they sign, which users will
 * reasonably read as an endorsement.
 */
const BUNDLED_TRUSTED_PUBLISHER_KEYS: readonly string[] = Object.freeze([]);

/** Test-only override; `undefined` restores the bundled set. */
let overrideKeys: readonly string[] | undefined;

/**
 * The keys currently in force. Read through this rather than importing the
 * constant so the test hook applies everywhere.
 */
export function getTrustedPublisherKeys(): readonly string[] {
  return overrideKeys ?? BUNDLED_TRUSTED_PUBLISHER_KEYS;
}

/** True when `publicKey` belongs to a publisher the app vouches for. */
export function isTrustedPublisherKey(publicKey: string | undefined): boolean {
  if (publicKey === undefined || publicKey.length === 0) return false;
  const needle = publicKey.toLowerCase();
  return getTrustedPublisherKeys().some((k) => k.toLowerCase() === needle);
}

/**
 * Test-only: swap the trusted set so the tier derivation can be exercised
 * without shipping a real publisher key. Pass `undefined` to restore.
 */
export function __setTrustedPublisherKeysForTests(keys: readonly string[] | undefined): void {
  overrideKeys = keys;
}
