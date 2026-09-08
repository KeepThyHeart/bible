/**
 * Ed25519 signature verification for module catalogs.
 *
 * Why this exists
 * ---------------
 * A catalog carries each module's `download_url` *and* its expected SHA-256
 * `checksum`. Verifying the checksum alone proves only that the bytes match
 * what the catalog claimed - if the catalog itself is forged or tampered
 * with, an attacker supplies both the poisoned download URL and a matching
 * checksum, and the check passes. Since a module is a SQLite database that
 * the app opens and queries, that is a real code-adjacent attack surface.
 *
 * Signing the catalog closes the loop: the signature covers the download URLs
 * and checksums, so a verified catalog transitively authenticates every module
 * download it describes.
 *
 * Signing model (mirrors `ExtensionSignatureVerifier`)
 * ----------------------------------------------------
 *   1. Publisher builds `catalog.json`.
 *   2. Tooling computes SHA-256 over the exact catalog bytes.
 *   3. Tooling signs that hash with an Ed25519 private key.
 *   4. `{ publicKey, signature, algorithm }` is written to `catalog.json.sig`.
 *
 * The signature is *detached* (a sibling `.sig` file) rather than embedded, so
 * `catalog.json` stays byte-identical to what was signed and no JSON
 * canonicalization is required.
 *
 * Trust model
 * -----------
 * A valid signature is not by itself sufficient - anyone can generate a key.
 * The key must also be trusted for that catalog:
 *
 *   - Official catalog: the key is pinned in `trustedCatalogKeys.ts` and
 *     compiled into the app.
 *   - Third-party catalogs: trust-on-first-use. The key seen when the catalog
 *     is added is stored on the catalog row; a later change to a different key
 *     yields `untrusted_key` so key rotation/compromise is visible instead of
 *     silent.
 */

import { createHash, createPublicKey, verify } from 'crypto';

import type { CatalogSignature, CatalogVerificationResult } from '@bible/core';

/** DER prefix for a 32-byte Ed25519 SPKI public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface CatalogTrustOptions {
  /**
   * Key that must have produced the signature. When set (a pinned official
   * key, or the TOFU key recorded when the catalog was added), a valid
   * signature from any other key is reported as `untrusted_key`.
   */
  expectedPublicKey?: string;
  /**
   * When true, an absent `.sig` is reported as `invalid` rather than
   * `unsigned`. Used for catalogs that have previously served a signature -
   * dropping the signature must not silently downgrade trust.
   */
  requireSignature?: boolean;
}

/**
 * Verify a detached catalog signature.
 *
 * @param catalogBytes - The exact bytes of the fetched catalog document.
 * @param signatureJson - Contents of the `.sig` file, or undefined if absent.
 */
export function verifyCatalogSignature(
  catalogBytes: Buffer,
  signatureJson: string | undefined,
  options: CatalogTrustOptions = {},
): CatalogVerificationResult {
  const { expectedPublicKey, requireSignature = false } = options;

  // -- No signature served ---------------------------------------------
  if (signatureJson === undefined || signatureJson.trim() === '') {
    if (requireSignature) {
      return {
        status: 'invalid',
        message:
          'This catalog was previously signed but no longer serves a signature. ' +
          'Refusing to trust it — the catalog may have been tampered with.',
      };
    }
    return {
      status: 'unsigned',
      message:
        'Catalog is not signed. Modules from this source cannot be authenticated ' +
        'beyond their checksums.',
    };
  }

  // -- Parse and shape-check the sig file ------------------------------
  let sig: CatalogSignature;
  try {
    sig = JSON.parse(signatureJson) as CatalogSignature;
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to parse catalog signature: ${(err as Error).message}`,
    };
  }

  if (
    !sig ||
    typeof sig.publicKey !== 'string' ||
    typeof sig.signature !== 'string' ||
    sig.algorithm !== 'ed25519-sha256'
  ) {
    return {
      status: 'error',
      message:
        'Catalog signature has an invalid shape (expected publicKey, signature, ' +
        'algorithm: "ed25519-sha256").',
    };
  }

  if (!/^[0-9a-f]{64}$/i.test(sig.publicKey)) {
    return {
      status: 'error',
      message: 'Catalog signature publicKey must be 64 hex characters (32-byte Ed25519 key).',
    };
  }
  if (!/^[0-9a-f]{128}$/i.test(sig.signature)) {
    return {
      status: 'error',
      message: 'Catalog signature must be 128 hex characters (64-byte Ed25519 signature).',
    };
  }

  // -- Verify the signature over SHA-256 of the catalog bytes ----------
  let signatureValid: boolean;
  try {
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(sig.publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });

    const digest = createHash('sha256').update(catalogBytes).digest();
    signatureValid = verify(null, digest, keyObject, Buffer.from(sig.signature, 'hex'));
  } catch (err) {
    return {
      status: 'error',
      message: `Catalog signature verification error: ${(err as Error).message}`,
    };
  }

  if (!signatureValid) {
    return {
      status: 'invalid',
      publicKey: sig.publicKey,
      message:
        'Catalog signature does not match its contents — the catalog may have been ' +
        'tampered with in transit.',
    };
  }

  // -- Signature is valid; is the key the one we expect? ---------------
  if (expectedPublicKey && !equalsIgnoreCase(expectedPublicKey, sig.publicKey)) {
    return {
      status: 'untrusted_key',
      publicKey: sig.publicKey,
      message:
        'Catalog is signed by a different key than the one previously trusted for ' +
        `this source (expected ${short(expectedPublicKey)}, got ${short(sig.publicKey)}). ` +
        'If the publisher rotated keys, re-add the catalog to accept the new key.',
    };
  }

  return {
    status: 'verified',
    publicKey: sig.publicKey,
    message: expectedPublicKey
      ? 'Catalog signature verified against the trusted key.'
      : `Catalog signature verified (key ${short(sig.publicKey)} recorded on first use).`,
  };
}

/**
 * Whether a catalog with this verification status may be used at all.
 *
 * `unsigned` is permitted (self-hosted and legacy catalogs are unsigned by
 * default) but the UI should mark it. `invalid`/`untrusted_key` are hard
 * failures - a broken signature is strictly worse than no signature, because
 * it means something changed that should not have.
 */
export function isCatalogUsable(result: CatalogVerificationResult): boolean {
  return result.status === 'verified' || result.status === 'unsigned';
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function short(publicKeyHex: string): string {
  return `${publicKeyHex.slice(0, 8)}…${publicKeyHex.slice(-4)}`;
}
