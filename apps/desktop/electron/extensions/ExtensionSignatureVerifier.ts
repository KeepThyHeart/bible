/**
 * Extension signature verification (Workstream 4 - Security Hardening).
 *
 * Verifies Ed25519 signatures of extension packages at install time.
 *
 * Signing model:
 *   1. Publisher builds the extension package.
 *   2. Publisher's tooling computes a deterministic SHA-256 content hash of
 *      all files in the package (excluding `extension.sig` itself).
 *   3. Publisher signs the hash with their Ed25519 private key.
 *   4. The signature + public key are written to `extension.sig` as JSON.
 *
 * Verification model:
 *   1. At install time, the host reads `extension.sig`.
 *   2. Re-computes the content hash from the installed files.
 *   3. Verifies the Ed25519 signature against the declared public key.
 *   4. Stores the verification status (`verified`, `unsigned`, `invalid`,
 *      `error`) in the extension registry.
 *
 * For sideloaded extensions without `extension.sig`, verification returns
 * `unsigned` - the caller (installer) should warn the user but allow install.
 */

import { createHash, createPublicKey, verify } from 'crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'fs';
import { join } from 'path';

import type { Extensions } from '@bible/core';

type ExtensionSignature = Extensions.ExtensionSignature;
type SignatureVerificationStatus = Extensions.SignatureVerificationStatus;

export interface SignatureVerificationResult {
  status: SignatureVerificationStatus;
  /** Present when `status === 'verified'`. Hex-encoded public key. */
  publicKey?: string;
  /** Human-readable detail (warning for unsigned, error message for invalid/error). */
  message: string;
}

/** The well-known filename for the signature file. */
const SIGNATURE_FILENAME = 'extension.sig';

/**
 * Verify the Ed25519 signature of an installed extension directory.
 *
 * Returns `unsigned` (not an error) when the sig file is absent - the
 * installer should surface this to the user as a warning.
 */
export function verifyExtensionSignature(
  installPath: string,
): SignatureVerificationResult {
  const sigPath = join(installPath, SIGNATURE_FILENAME);

  // -- No signature file -> unsigned -----------------------------------
  if (!existsSync(sigPath)) {
    return {
      status: 'unsigned',
      message: 'Extension is not signed (no extension.sig found).',
    };
  }

  // -- Parse the signature file ----------------------------------------
  let sigData: ExtensionSignature;
  try {
    const raw = readFileSync(sigPath, 'utf-8');
    sigData = JSON.parse(raw) as ExtensionSignature;
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to parse extension.sig: ${(err as Error).message}`,
    };
  }

  // Validate shape
  if (
    !sigData ||
    typeof sigData.publicKey !== 'string' ||
    typeof sigData.signature !== 'string' ||
    sigData.algorithm !== 'ed25519-sha256'
  ) {
    return {
      status: 'error',
      message:
        'extension.sig has an invalid shape (expected publicKey, signature, algorithm: "ed25519-sha256").',
    };
  }

  // Validate hex encoding lengths
  if (sigData.publicKey.length !== 64 || !/^[0-9a-f]+$/i.test(sigData.publicKey)) {
    return {
      status: 'error',
      message: 'extension.sig publicKey must be 64 hex characters (32-byte Ed25519 public key).',
    };
  }
  if (sigData.signature.length !== 128 || !/^[0-9a-f]+$/i.test(sigData.signature)) {
    return {
      status: 'error',
      message: 'extension.sig signature must be 128 hex characters (64-byte Ed25519 signature).',
    };
  }

  // -- Compute the content hash ----------------------------------------
  let contentHash: Buffer;
  try {
    contentHash = computeContentHash(installPath);
  } catch (err) {
    return {
      status: 'error',
      message: `Failed to compute content hash: ${(err as Error).message}`,
    };
  }

  // -- Verify the Ed25519 signature ------------------------------------
  try {
    const publicKeyBuf = Buffer.from(sigData.publicKey, 'hex');
    const signatureBuf = Buffer.from(sigData.signature, 'hex');

    const keyObject = createPublicKey({
      key: Buffer.concat([
        // Ed25519 DER prefix for a 32-byte public key
        Buffer.from('302a300506032b6570032100', 'hex'),
        publicKeyBuf,
      ]),
      format: 'der',
      type: 'spki',
    });

    const isValid = verify(null, contentHash, keyObject, signatureBuf);
    if (isValid) {
      return {
        status: 'verified',
        publicKey: sigData.publicKey,
        message: 'Signature verified successfully.',
      };
    } else {
      return {
        status: 'invalid',
        publicKey: sigData.publicKey,
        message: 'Ed25519 signature verification failed — the package may have been tampered with.',
      };
    }
  } catch (err) {
    return {
      status: 'error',
      message: `Signature verification error: ${(err as Error).message}`,
    };
  }
}

/**
 * Compute a deterministic SHA-256 content hash of all files in `dir`,
 * excluding `extension.sig` itself.
 *
 * The hash is computed by:
 *   1. Collecting all file paths relative to `dir` (forward-slash normalized).
 *   2. Sorting them lexicographically.
 *   3. For each file: feeding `relativePath + '\0' + fileContents` into the
 *      running SHA-256 digest.
 *
 * This is deterministic across platforms as long as the file contents and
 * relative paths are identical.
 */
export function computeContentHash(dir: string): Buffer {
  const files = collectFiles(dir).filter((f) => f !== SIGNATURE_FILENAME);
  files.sort();

  const hash = createHash('sha256');
  for (const file of files) {
    const fullPath = join(dir, ...file.split('/'));
    const content = readFileSync(fullPath);
    hash.update(file);
    hash.update('\0');
    hash.update(content);
  }
  return hash.digest();
}

/**
 * Recursively collect all file paths under `dir`, relative to `dir`,
 * using forward slashes as the separator for cross-platform determinism.
 */
function collectFiles(dir: string, base?: string): string[] {
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const st = lstatSync(fullPath);
    const relPath = base ? `${base}/${name}` : name;
    if (st.isDirectory()) {
      results.push(...collectFiles(fullPath, relPath));
    } else if (st.isFile()) {
      results.push(relPath);
    }
    // Skip symlinks - they've already been rejected by the symlink escape check.
  }
  return results;
}

/**
 * Sign an extension directory with an Ed25519 private key.
 *
 * This is a developer-facing utility (used by CLI tooling, not at runtime).
 * It computes the content hash, signs it, and returns the `extension.sig`
 * JSON content to write to disk.
 *
 * @param dir - The extension package directory.
 * @param privateKeyHex - Hex-encoded Ed25519 private key (64 hex chars = 32 bytes).
 * @returns The JSON string to write to `extension.sig`.
 */
export function signExtensionDirectory(
  dir: string,
  privateKeyHex: string,
): string {
  // Lazy import so the sign function doesn't pull crypto into the module
  // scope for consumers that only verify.
  const { createPrivateKey, sign: cryptoSign } = require('crypto') as typeof import('crypto');

  const privateKeyBuf = Buffer.from(privateKeyHex, 'hex');
  const keyObject = createPrivateKey({
    key: Buffer.concat([
      // Ed25519 DER prefix for a 32-byte private key (PKCS#8 wrapping)
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      privateKeyBuf,
    ]),
    format: 'der',
    type: 'pkcs8',
  });

  // Derive the public key for inclusion in the sig file.
  const pubKeyObj = createPublicKey(keyObject);
  const pubKeyDer = pubKeyObj.export({ format: 'der', type: 'spki' });
  // The raw 32-byte public key is the last 32 bytes of the DER encoding.
  const publicKeyHex = pubKeyDer.subarray(pubKeyDer.length - 32).toString('hex');

  const contentHash = computeContentHash(dir);
  const signature = cryptoSign(null, contentHash, keyObject);

  const sigData: ExtensionSignature = {
    publicKey: publicKeyHex,
    signature: signature.toString('hex'),
    algorithm: 'ed25519-sha256',
  };

  return JSON.stringify(sigData, null, 2) + '\n';
}
