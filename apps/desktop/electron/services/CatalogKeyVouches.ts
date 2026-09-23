/**
 * Key vouches: how the official catalog can move to a signing key that an
 * installed copy of the app has never seen.
 *
 * A vouch is a statement, signed by a key the app already trusts, naming a new
 * key. Vouches chain: an install that trusts key A reaches key C through
 * "A vouches for B" and "B vouches for C", so a copy of the app from years ago
 * can still follow the publisher's keys without an app update.
 *
 * A vouch never grants trust by itself. `ModuleCatalogService` consults
 * vouches only for the official catalog, only when no signature on it is by a
 * trusted key, and only with the user's explicit approval.
 *
 * Wire format - served beside the catalog as `catalog.json.vouches`:
 *
 *   {
 *     "format": "kth-bible-key-vouches",
 *     "version": 1,
 *     "vouches": [
 *       { "vouchingKey": "<hex>", "newKey": "<hex>",
 *         "scope": "<official catalog URL prefix>",
 *         "issued": "2027-03-01T12:00:00Z", "signature": "<hex>" }
 *     ]
 *   }
 *
 * Why a vouch cannot be mistaken for a catalog signature (or vice versa)
 * ---------------------------------------------------------------------
 * A catalog signature is Ed25519 over exactly 32 bytes: the SHA-256 digest of
 * the catalog. A vouch signature is Ed25519 over the text `vouchMessage`
 * builds, which starts with `VOUCH_MAGIC` and is always far longer than 32
 * bytes. Ed25519 signs the message itself, so a signature over one can never
 * verify over the other: signing a catalog cannot produce a vouch, however the
 * file being signed was crafted, and a vouch cannot pass as a catalog
 * signature. The two also live in different files with different shapes, and
 * `scripts/yubikey-sign.py` makes them with different commands.
 *
 * `scripts/yubikey-sign.py` builds the same message byte for byte; the test
 * vector in `CatalogKeyVouches.test.ts` pins it.
 */

import { verify } from 'crypto';

import { ed25519PublicKey } from './CatalogSignatureVerifier';

export const VOUCH_FORMAT = 'kth-bible-key-vouches';
export const VOUCH_VERSION = 1;
/** First line of every signed vouch message. */
export const VOUCH_MAGIC = 'KTH-BIBLE-KEY-VOUCH-V1';
/** A document with more vouches than this is ignored outright. */
export const MAX_VOUCHES = 32;

/** One signed statement: `vouchingKey` vouches that `newKey` may sign catalogs under `scope`. */
export interface KeyVouch {
  /** Hex Ed25519 key that signed this vouch. */
  vouchingKey: string;
  /** Hex Ed25519 key being vouched for. */
  newKey: string;
  /** Official catalog URL prefix the vouch applies to. */
  scope: string;
  /** UTC time of the vouch, `YYYY-MM-DDTHH:MM:SSZ`. */
  issued: string;
  /** Hex Ed25519 signature over `vouchMessage(...)`. */
  signature: string;
}

/** A catalog signer reached from a trusted key through one or more vouches. */
export interface VouchedKey {
  newKey: string;
  /** The vouches from a trusted key to `newKey`, trusted end first. */
  chain: KeyVouch[];
}

const HEX_KEY = /^[0-9a-f]{64}$/i;
const HEX_SIGNATURE = /^[0-9a-f]{128}$/i;
const ISSUED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// No whitespace, so a scope can never smuggle an extra line into the message.
const SCOPE = /^https:\/\/\S+$/;

/** The exact bytes a vouch signature covers. */
export function vouchMessage(vouch: Omit<KeyVouch, 'signature'>): Buffer {
  return Buffer.from(
    `${VOUCH_MAGIC}\n` +
      `scope: ${vouch.scope}\n` +
      `vouching-key: ${vouch.vouchingKey.toLowerCase()}\n` +
      `new-key: ${vouch.newKey.toLowerCase()}\n` +
      `issued: ${vouch.issued}\n`,
    'utf-8',
  );
}

/**
 * Find a catalog signer that a chain of valid vouches links to a trusted key.
 *
 * Vouches that are malformed, for another scope, or whose signature does not
 * verify are skipped - they cannot grant anything, so there is no reason to
 * let one spoil the rest. Only a document of the wrong format or size is
 * ignored wholesale.
 *
 * @param vouchesJson - Contents of the `.vouches` document.
 * @param trustedKeys - Keys already trusted for this catalog.
 * @param signers     - Keys whose signatures over the catalog verified.
 * @param scope       - The official URL prefix the catalog falls under.
 * @returns The first reachable signer and its chain, or undefined.
 */
export function findVouchedKey(
  vouchesJson: string,
  {
    trustedKeys,
    signers,
    scope,
  }: { trustedKeys: readonly string[]; signers: readonly string[]; scope: string },
): VouchedKey | undefined {
  const usable = parseVouches(vouchesJson).filter(
    (vouch) => vouch.scope.toLowerCase() === scope.toLowerCase() && isVouchSignatureValid(vouch),
  );

  // Breadth-first from the trusted keys, so the shortest chain wins.
  const chains = new Map<string, KeyVouch[]>(trustedKeys.map((key) => [key.toLowerCase(), []]));
  let frontier = [...chains.keys()];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const vouch of usable) {
      const from = vouch.vouchingKey.toLowerCase();
      const to = vouch.newKey.toLowerCase();
      if (frontier.includes(from) && !chains.has(to)) {
        chains.set(to, [...chains.get(from)!, vouch]);
        next.push(to);
      }
    }
    frontier = next;
  }

  for (const signer of signers) {
    const chain = chains.get(signer.toLowerCase());
    if (chain && chain.length > 0) {
      return { newKey: signer.toLowerCase(), chain };
    }
  }
  return undefined;
}

/** Well-formed vouches from a `.vouches` document; [] if the document itself is unusable. */
function parseVouches(vouchesJson: string): KeyVouch[] {
  let doc: unknown;
  try {
    doc = JSON.parse(vouchesJson);
  } catch {
    return [];
  }
  if (
    typeof doc !== 'object' ||
    doc === null ||
    Array.isArray(doc)
  ) {
    return [];
  }
  const { format, version, vouches } = doc as Record<string, unknown>;
  if (
    format !== VOUCH_FORMAT ||
    version !== VOUCH_VERSION ||
    !Array.isArray(vouches) ||
    vouches.length > MAX_VOUCHES
  ) {
    return [];
  }
  return vouches.filter(isWellFormedVouch);
}

function isWellFormedVouch(value: unknown): value is KeyVouch {
  if (typeof value !== 'object' || value === null) return false;
  const vouch = value as Record<string, unknown>;
  return (
    typeof vouch.vouchingKey === 'string' && HEX_KEY.test(vouch.vouchingKey) &&
    typeof vouch.newKey === 'string' && HEX_KEY.test(vouch.newKey) &&
    typeof vouch.scope === 'string' && SCOPE.test(vouch.scope) &&
    typeof vouch.issued === 'string' && ISSUED.test(vouch.issued) &&
    typeof vouch.signature === 'string' && HEX_SIGNATURE.test(vouch.signature)
  );
}

function isVouchSignatureValid(vouch: KeyVouch): boolean {
  try {
    return verify(
      null,
      vouchMessage(vouch),
      ed25519PublicKey(vouch.vouchingKey),
      Buffer.from(vouch.signature, 'hex'),
    );
  } catch {
    return false;
  }
}
