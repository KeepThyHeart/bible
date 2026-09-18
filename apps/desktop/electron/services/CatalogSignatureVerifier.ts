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
 * Multiple signatures
 * -------------------
 * A `.sig` may carry further signatures over the same bytes in a `signatures`
 * array beside the top-level (primary) one, so a catalog can be signed by an
 * outgoing and an incoming key at once during a rotation. Apps that predate
 * the array read only the primary, which keeps the shape and place it always
 * had. Every signature present must verify - one that does not means something
 * changed that should not have - and one by a trusted key is enough.
 *
 * Trust model
 * -----------
 * A valid signature is not by itself sufficient - anyone can generate a key.
 * The key must also be trusted for that catalog:
 *
 *   - Official catalog: the keys are pinned in `trustedCatalogKeys.ts` and
 *     compiled into the app. A signature by any pinned key is accepted, so an
 *     old and a new key can overlap during rotation. A key vouched for by a
 *     trusted key can be added with the user's approval (`ModuleCatalogService`).
 *   - Third-party catalogs: trust-on-first-use. The key seen when the catalog
 *     is added is stored on the catalog row; a later change to a different key
 *     yields `untrusted_key` so key rotation/compromise is visible instead of
 *     silent.
 */

import { createHash, createPublicKey, verify, type KeyObject } from 'crypto';

import type { CatalogSignatureEntry, CatalogVerificationResult } from '@bible/core';

/** DER prefix for a 32-byte Ed25519 SPKI public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Most signatures one catalog may carry. A rotation needs two; the cap bounds
 * the verification work a hostile `.sig` can demand.
 */
export const MAX_CATALOG_SIGNATURES = 8;

const SHAPE_ERROR =
  'Catalog signature has an invalid shape (expected publicKey, signature, ' +
  'algorithm: "ed25519-sha256").';

export interface CatalogTrustOptions {
  /**
   * Key, or set of keys, that may have produced the signature. When set (the
   * pinned official keys, or the TOFU key recorded when the catalog was added),
   * a catalog with no signature by a listed key is reported as `untrusted_key`.
   * An empty string or empty list means no expectation, like omitting it.
   */
  expectedPublicKey?: string | readonly string[];
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
  const trustedKeys = (
    typeof expectedPublicKey === 'string' ? [expectedPublicKey] : (expectedPublicKey ?? [])
  ).filter((key) => key.length > 0);

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
  let parsed: unknown;
  try {
    parsed = JSON.parse(signatureJson);
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to parse catalog signature: ${(err as Error).message}`,
    };
  }

  const entries = readSignatureEntries(parsed);
  if (typeof entries === 'string') {
    return { status: 'error', message: entries };
  }

  // -- Verify every signature over SHA-256 of the catalog bytes --------
  const digest = createHash('sha256').update(catalogBytes).digest();
  const signers: string[] = [];
  for (const entry of entries) {
    let signatureValid: boolean;
    try {
      signatureValid = verify(
        null,
        digest,
        ed25519PublicKey(entry.publicKey),
        Buffer.from(entry.signature, 'hex'),
      );
    } catch (err) {
      return {
        status: 'error',
        message: `Catalog signature verification error: ${(err as Error).message}`,
      };
    }

    if (!signatureValid) {
      return {
        status: 'invalid',
        publicKey: entry.publicKey,
        message:
          'Catalog signature does not match its contents — the catalog may have been ' +
          'tampered with in transit.',
      };
    }
    signers.push(entry.publicKey);
  }

  // -- Every signature is valid; is one of them by a key we trust? -----
  if (trustedKeys.length === 0) {
    return {
      status: 'verified',
      publicKey: signers[0],
      signers,
      message: `Catalog signature verified (key ${short(signers[0])} recorded on first use).`,
    };
  }

  const trustedSigner = signers.find((signer) =>
    trustedKeys.some((key) => equalsIgnoreCase(key, signer)),
  );
  if (trustedSigner === undefined) {
    return {
      status: 'untrusted_key',
      publicKey: signers[0],
      signers,
      message:
        'Catalog is signed by a different key than the one previously trusted for ' +
        `this source (expected ${trustedKeys.map(short).join(' or ')}, ` +
        `got ${signers.map(short).join(', ')}). ` +
        'If the publisher rotated keys, re-add the catalog to accept the new key.',
    };
  }

  return {
    status: 'verified',
    publicKey: trustedSigner,
    signers,
    message: 'Catalog signature verified against the trusted key.',
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

/** An Ed25519 public key object from its raw 64-hex-character form. */
export function ed25519PublicKey(publicKeyHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * The primary signature followed by any in `signatures`, or a message saying
 * why the document is malformed. One malformed entry fails the whole file:
 * publishing tooling never writes one, so it is either a bug to surface or an
 * attack.
 */
function readSignatureEntries(doc: unknown): CatalogSignatureEntry[] | string {
  if (!isRecord(doc)) return SHAPE_ERROR;

  const { signatures } = doc;
  if (signatures !== undefined && !Array.isArray(signatures)) {
    return 'Catalog signature "signatures" must be an array.';
  }

  const entries: unknown[] = [doc, ...((signatures as unknown[] | undefined) ?? [])];
  if (entries.length > MAX_CATALOG_SIGNATURES) {
    return `Catalog carries ${entries.length} signatures; at most ${MAX_CATALOG_SIGNATURES} are accepted.`;
  }

  for (const entry of entries) {
    const problem = entryProblem(entry);
    if (problem) return problem;
  }
  return entries as CatalogSignatureEntry[];
}

function entryProblem(entry: unknown): string | undefined {
  if (
    !isRecord(entry) ||
    typeof entry.publicKey !== 'string' ||
    typeof entry.signature !== 'string' ||
    entry.algorithm !== 'ed25519-sha256'
  ) {
    return SHAPE_ERROR;
  }
  if (!/^[0-9a-f]{64}$/i.test(entry.publicKey)) {
    return 'Catalog signature publicKey must be 64 hex characters (32-byte Ed25519 key).';
  }
  if (!/^[0-9a-f]{128}$/i.test(entry.signature)) {
    return 'Catalog signature must be 128 hex characters (64-byte Ed25519 signature).';
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function short(publicKeyHex: string): string {
  return `${publicKeyHex.slice(0, 8)}…${publicKeyHex.slice(-4)}`;
}
