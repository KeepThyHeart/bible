/**
 * Ed25519 signature verification for offline `.biblepack` manifests.
 *
 * A `.biblepack` is a `.zip` carrying, at its root:
 *   - `pack.json`     - the manifest: which module files it bundles, their
 *                       exact size and SHA-256, in the same JSON shape
 *                       `scripts/build-module-pack.js` writes.
 *   - `pack.json.sig` - optional. Same shape as `catalog.json.sig`
 *                       (`CatalogSignatureVerifier`): a primary signature plus
 *                       an optional `signatures[]` for key rotation.
 *
 * ## Why a pack signature can never verify as a catalog signature (or vice versa)
 *
 * A catalog signature is Ed25519 over `sha256(catalog bytes)` - exactly 32
 * bytes, no prefix. A pack signature is Ed25519 over
 * `sha256(PACK_MANIFEST_SIGNATURE_DOMAIN + manifest bytes)`: a different
 * 32-byte digest, because the domain prefix changes the hash input even when
 * the remaining bytes are identical. Since Ed25519 signs the digest it is
 * given, a signature produced for one digest cannot verify against the other,
 * however the manifest was crafted. This mirrors the domain separation
 * `CatalogKeyVouches.ts` uses for vouch messages (see its module doc), applied
 * to a hashed message instead of a text one. `scripts/yubikey-sign.py`'s
 * `sign-pack` builds the identical digest byte for byte.
 *
 * ## Trust
 *
 * A pack is trusted exactly like a catalog: the signer must be one of the
 * pinned official keys (or a key the user separately approved for that scope
 * via a vouch - see `ApprovedCatalogKeys.ts`). There is no per-pack
 * trust-on-first-use, because a `.biblepack` has no stable "source" to record
 * a key against the way a catalog URL does - every check is against the
 * install's current official trust set.
 *
 * ## What "verified" does NOT check
 *
 * Verifying the manifest's signature only proves the manifest itself (its
 * list of paths/sizes/hashes) has not been altered. It says nothing yet about
 * whether the archive's actual file bytes match that manifest - that
 * comparison happens in `ModulePackService.ts`, which hashes each module file
 * while extracting it and refuses the whole pack on any mismatch, an entry the
 * manifest does not list, or a listed entry that never appears.
 */

import { createHash } from 'crypto';
import { readSignatureEntries, verifyDigestAgainstEntries } from './CatalogSignatureVerifier';

/** `format` every `.biblepack` manifest must declare. */
export const PACK_MANIFEST_FORMAT = 'keepthyheart.biblepack/1';

/**
 * Domain-separation prefix for the digest a pack manifest signature covers:
 * `sha256(PACK_MANIFEST_SIGNATURE_DOMAIN + manifestBytes)`. Keep this string
 * byte-for-byte identical to the one `scripts/yubikey-sign.py`'s `sign-pack`
 * builds - they are verified against each other, not against a shared
 * constant.
 */
export const PACK_MANIFEST_SIGNATURE_DOMAIN = 'keepthyheart.biblepack.manifest.v1\n';

/** Root-level filenames a `.biblepack` archive carries its manifest/signature under. */
export const PACK_MANIFEST_FILENAME = 'pack.json';
export const PACK_SIGNATURE_FILENAME = 'pack.json.sig';

/** Metadata files are small by nature; anything bigger is refused outright rather than trusted. */
export const MAX_PACK_MANIFEST_BYTES = 1 * 1024 * 1024;
export const MAX_PACK_SIGNATURE_BYTES = 1 * 1024 * 1024;

/** Upper bound on modules one manifest may list - bounds verification cost. */
export const MAX_PACK_MANIFEST_MODULES = 500;

const PACK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const LANGUAGE_TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/;
const MODULE_FILE_RE = /\.db(\.gz)?$/i;
const MAX_TEXT_FIELD_LENGTH = 500;

/** The exact bytes a pack manifest signature covers. */
export function packManifestDigest(manifestBytes: Buffer): Buffer {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(PACK_MANIFEST_SIGNATURE_DOMAIN, 'utf-8'), manifestBytes]))
    .digest();
}

export interface PackManifestModuleEntry {
  /** POSIX-style, relative, no `..` segments; names a `*.db`/`*.db.gz` archive entry. */
  path: string;
  /** Lowercase hex SHA-256 of the file's exact bytes. */
  sha256: string;
  size_bytes: number;
}

export interface PackManifest {
  format: string;
  pack_id: string;
  name: string;
  version: string;
  languages: string[];
  created?: string;
  modules: PackManifestModuleEntry[];
}

export type PackManifestParseResult =
  | { ok: true; manifest: PackManifest }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown, maxLength = MAX_TEXT_FIELD_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/** POSIX-relative, no leading `/`, no `..` segment, no backslash, `*.db`/`*.db.gz`. */
function isValidPackModulePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  if (!MODULE_FILE_RE.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/**
 * Validate a parsed `pack.json` document.
 *
 * Every field is checked before any is read, the same discipline
 * `StarterPackTypes.ts#parseStarterPack` applies to catalog JSON - `pack.json`
 * sits inside an untrusted archive and must never be read field-by-field
 * before its shape is known.
 */
export function parsePackManifest(raw: unknown): PackManifestParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'pack.json must be a JSON object.' };
  }
  const doc = raw as Record<string, unknown>;

  if (doc.format !== PACK_MANIFEST_FORMAT) {
    return { ok: false, error: `pack.json "format" must be "${PACK_MANIFEST_FORMAT}".` };
  }
  if (!isNonEmptyString(doc.pack_id, 100) || !PACK_ID_RE.test(doc.pack_id)) {
    return { ok: false, error: '"pack_id" must be a short lowercase slug ([a-z0-9._-], starting alphanumeric).' };
  }
  if (!isNonEmptyString(doc.name) || !isNonEmptyString(doc.version, 100)) {
    return { ok: false, error: '"name" and "version" must be non-empty strings.' };
  }
  if (doc.created !== undefined && (typeof doc.created !== 'string' || Number.isNaN(Date.parse(doc.created)))) {
    return { ok: false, error: '"created", when present, must be a parseable ISO-8601 timestamp.' };
  }

  if (!Array.isArray(doc.languages) || doc.languages.length === 0) {
    return { ok: false, error: '"languages" must be a non-empty array of BCP-47 tags.' };
  }
  if (!doc.languages.every((tag) => typeof tag === 'string' && LANGUAGE_TAG_RE.test(tag))) {
    return { ok: false, error: '"languages" contains a value that is not a recognised BCP-47 tag.' };
  }

  if (!Array.isArray(doc.modules) || doc.modules.length === 0) {
    return { ok: false, error: '"modules" must be a non-empty array - an empty pack has nothing to install.' };
  }
  if (doc.modules.length > MAX_PACK_MANIFEST_MODULES) {
    return { ok: false, error: `"modules" may list at most ${MAX_PACK_MANIFEST_MODULES} files.` };
  }

  const modules: PackManifestModuleEntry[] = [];
  const seenPaths = new Set<string>();
  for (const [index, entry] of doc.modules.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: `modules[${index}] must be a JSON object.` };
    }
    const m = entry as Record<string, unknown>;
    if (!isValidPackModulePath(m.path)) {
      return { ok: false, error: `modules[${index}].path is not a valid relative *.db/*.db.gz path.` };
    }
    if (seenPaths.has(m.path)) {
      return { ok: false, error: `modules[${index}].path duplicates an earlier entry.` };
    }
    if (typeof m.sha256 !== 'string' || !SHA256_RE.test(m.sha256)) {
      return { ok: false, error: `modules[${index}].sha256 must be a 64-character hex SHA-256 digest.` };
    }
    if (!Number.isInteger(m.size_bytes) || (m.size_bytes as number) <= 0) {
      return { ok: false, error: `modules[${index}].size_bytes must be a positive integer.` };
    }
    seenPaths.add(m.path);
    modules.push({ path: m.path, sha256: (m.sha256 as string).toLowerCase(), size_bytes: m.size_bytes as number });
  }

  return {
    ok: true,
    manifest: {
      format: doc.format,
      pack_id: doc.pack_id,
      name: doc.name,
      version: doc.version,
      languages: doc.languages as string[],
      created: doc.created as string | undefined,
      modules,
    },
  };
}

export type PackSignatureStatus = 'verified' | 'unsigned' | 'untrusted' | 'invalid';

export interface PackSignatureResult {
  status: PackSignatureStatus;
  /** Present for `verified`/`untrusted`, whenever `pack.json` itself parsed. */
  manifest?: PackManifest;
  /** The signer that made the pack `verified`, or the first signer when `untrusted`. */
  publicKey?: string;
  /** Every key whose signature over the manifest verified. */
  signers?: string[];
  message: string;
}

/** `<first 8 hex><…><last 8 hex>` - enough to recognize a key without printing all 64 characters. */
function fingerprint(publicKeyHex: string): string {
  return `${publicKeyHex.slice(0, 8)}…${publicKeyHex.slice(-8)}`;
}

/**
 * Verify a `.biblepack`'s manifest and its detached signature.
 *
 * @param manifestBytes  - Exact bytes of `pack.json` as read from the archive,
 *                         or undefined if the archive carries no such entry.
 * @param signatureBytes - Exact bytes of `pack.json.sig`, or undefined.
 * @param trustedKeys    - Keys trusted for packs (the pinned official keys
 *                         plus any the user approved for that scope).
 */
export function verifyPackManifestSignature(
  manifestBytes: Buffer | undefined,
  signatureBytes: Buffer | undefined,
  trustedKeys: readonly string[],
): PackSignatureResult {
  // `scripts/build-module-pack.js` always writes `pack.json` and adds
  // `pack.json.sig` only when the publisher signed it - so "manifest present,
  // no signature" is the ordinary shape of an unsigned pack, not a
  // half-broken one, and gets the soft (confirmable) `unsigned` outcome. A
  // `.sig` with no manifest to check it against has no legitimate origin -
  // nothing produces that shape - so it is treated as tampering (`invalid`,
  // no override) rather than "unsigned".
  if (signatureBytes === undefined) {
    return {
      status: 'unsigned',
      message: 'This pack is not signed. It has not been tampered with in a way this app can detect either way.',
    };
  }
  if (manifestBytes === undefined) {
    return {
      status: 'invalid',
      message: 'This pack carries pack.json.sig with no pack.json to verify it against.',
    };
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestBytes.toString('utf-8'));
  } catch (err) {
    return { status: 'invalid', message: `pack.json is not valid JSON: ${(err as Error).message}` };
  }
  const manifestResult = parsePackManifest(parsedManifest);
  if (!manifestResult.ok) {
    return { status: 'invalid', message: `pack.json is malformed: ${manifestResult.error}` };
  }

  let parsedSignature: unknown;
  try {
    parsedSignature = JSON.parse(signatureBytes.toString('utf-8'));
  } catch (err) {
    return { status: 'invalid', message: `pack.json.sig is not valid JSON: ${(err as Error).message}` };
  }
  const entries = readSignatureEntries(parsedSignature);
  if (typeof entries === 'string') {
    return { status: 'invalid', message: entries };
  }

  const digest = packManifestDigest(manifestBytes);
  let check;
  try {
    check = verifyDigestAgainstEntries(digest, entries);
  } catch (err) {
    return { status: 'invalid', message: `pack.json.sig could not be verified: ${(err as Error).message}` };
  }
  if (!check.valid) {
    return {
      status: 'invalid',
      publicKey: check.publicKey,
      manifest: manifestResult.manifest,
      message: 'pack.json.sig does not match pack.json — the pack may have been tampered with.',
    };
  }

  const trustedSigner = check.signers.find((signer) =>
    trustedKeys.some((key) => key.toLowerCase() === signer.toLowerCase()),
  );
  if (trustedSigner !== undefined) {
    return {
      status: 'verified',
      manifest: manifestResult.manifest,
      publicKey: trustedSigner,
      signers: check.signers,
      message: 'Verified: signed by Keep Thy Heart.',
    };
  }

  return {
    status: 'untrusted',
    manifest: manifestResult.manifest,
    signers: check.signers,
    publicKey: check.signers[0],
    message: `Signed, but not by a key this app trusts (${fingerprint(check.signers[0])}).`,
  };
}
