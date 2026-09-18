/* eslint-disable no-console */

/**
 * scripts/init/catalog.js -- fetch a module catalog, choose modules, download them.
 *
 * Loaded lazily by `index.js`, and only when `--catalog` is passed: the
 * offline path must keep working on a machine with no network and no interest
 * in one.
 *
 * ## Why this duplicates the desktop
 *
 * The desktop's Module Manager already does all of this, through
 * `ModuleCatalogService`, `DownloadService` and `CatalogSignatureVerifier`.
 * None of them can be imported here: they live in `apps/desktop/electron`, bind
 * `better-sqlite3` at Electron's ABI, and read build-time constants injected by
 * electron-vite.  So this is a second implementation, and the risk that comes
 * with a second implementation of a security control is real -- the two can
 * drift, and the weaker one becomes the path everybody uses.
 *
 * Two things follow from that, and both are deliberate:
 *
 *   - The verification here is a line-for-line match of
 *     `CatalogSignatureVerifier.verifyCatalogSignature`: same SPKI prefix, same
 *     SHA-256-then-Ed25519 construction, same shape checks, same verdicts.  If
 *     one changes, both change.
 *   - It refuses everything the desktop refuses.  `invalid` and `untrusted_key`
 *     are hard failures, because a broken signature is strictly worse than no
 *     signature: it means something changed that should not have.
 *
 * The right long-term answer is to lift the catalog client into `@bible/core`
 * (platform-free, with the HTTP layer injected) so both consumers share one
 * implementation.  `CatalogTypes.ts` already lives there.
 *
 * ## Trust
 *
 * A valid signature is not sufficient -- anyone can generate a key.  Catalogs
 * not covered by a compiled-in pin are trust-on-first-use: the key seen when a
 * catalog is first fetched is recorded, and a later change to a different key
 * is surfaced rather than accepted silently.  This script keeps that record in
 * `catalog-trust.json` beside the registry, which is the CLI's equivalent of
 * the desktop's `module_repository.signing_public_key` column.
 *
 * Catalogs (and indexes) under the official URL prefix are pinned, as in the
 * desktop, from the very first run: they must be signed by one of the keys in
 * `trustedCatalogKeys.ts` -- read from that file, so the two cannot disagree --
 * or by a key vouched for by one (`CatalogKeyVouches.ts`) that the user
 * approves at a prompt.  `--yes` never approves one.  Approvals are kept in
 * `catalog-approved-keys.json`, apart from the first-use record, so only a user
 * decision can widen the official trust set.
 *
 * Unsigned catalogs outside the official prefix are permitted, matching
 * `isCatalogUsable` -- self-hosted
 * and development catalogs are unsigned by default -- but the fact is printed
 * every time, and once a source has served a valid signature this script will
 * not accept an unsigned one from it again.
 *
 * ## Catalog index
 *
 * A source may publish several catalogs (one per language, say) and list them
 * in a signed `index.json` beside its catalog -- the format is the desktop's
 * `CatalogIndex.ts`.  This script always looks for one: with it, every listed
 * catalog is offered, each verified against its own signature; without it
 * (HTTP 404), the source's single catalog is used.  The index gets its own
 * trust-on-first-use entry, just like a catalog.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { createHash, createPublicKey, verify } = require('crypto');
const { gunzipSync } = require('zlib');

/** DER prefix for a 32-byte Ed25519 SPKI public key. Mirrors the desktop's. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Matches CATALOG_MAX_RESPONSE_BYTES in apps/desktop/electron/config/constants.ts. */
const CATALOG_MAX_BYTES = 5 * 1024 * 1024;

/** Mirror CatalogIndex.ts and CATALOG_INDEX_MAX_RESPONSE_BYTES in the desktop. */
const CATALOG_INDEX_FILENAME = 'index.json';
const CATALOG_INDEX_FORMAT = 'kth-bible-catalog-index';
const CATALOG_INDEX_VERSION = 1;
const MAX_INDEX_CATALOGS = 64;
const CATALOG_INDEX_MAX_BYTES = 64 * 1024;

/** Bounded like the desktop's NetworkGateway; a redirect chain is not a maze. */
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
// How long each address may take to connect before Node's dual-stack connect
// moves on.  Node's default, 250 ms, fails the whole request on a network where
// IPv6 is unreachable and IPv4 is merely slow to answer.
const CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;
// Network-level failures worth another try.  An HTTP error status is not one.
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE']);
const FETCH_ATTEMPTS = 3;

const BRAND_DIR = path.resolve(__dirname, '../../admin/brand');

/** The desktop's compiled-in trust anchors; see `readOfficialTrust`. */
const TRUSTED_KEYS_FILE = path.resolve(__dirname, '../../apps/desktop/electron/services/trustedCatalogKeys.ts');

/** Mirror CatalogKeyVouches.ts and CATALOG_VOUCHES_MAX_RESPONSE_BYTES in the desktop. */
const VOUCH_FORMAT = 'kth-bible-key-vouches';
const VOUCH_VERSION = 1;
const VOUCH_MAGIC = 'KTH-BIBLE-KEY-VOUCH-V1';
const MAX_VOUCHES = 32;
const VOUCHES_MAX_BYTES = 32 * 1024;

/**
 * The catalog `--catalog` uses when given no URL.
 *
 * Resolved the way the desktop build resolves its own default, so that the two
 * agree: `BIBLE_MODULE_CATALOG_URL` first, then `moduleRepositoryUrl` from
 * `branding.json` overlaid by `branding.local.json`.  A key still listed in
 * `_undecided` counts as absent, as it does for the desktop -- a provisional
 * URL that does not answer is worse than none, because it fails with a TLS or
 * DNS error instead of a message saying what to do.
 */
function defaultCatalogUrl() {
  const fromEnv = (process.env.BIBLE_MODULE_CATALOG_URL ?? '').trim();
  if (fromEnv) return fromEnv;

  const read = (name) => {
    const file = path.join(BRAND_DIR, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  };
  const branding = { ...read('branding.json'), ...read('branding.local.json') };
  if (branding._undecided?.includes('moduleRepositoryUrl')) return '';
  return typeof branding.moduleRepositoryUrl === 'string' ? branding.moduleRepositoryUrl.trim() : '';
}

/** A bare directory URL gets `/catalog.json` appended, as the desktop does. */
function resolveCatalogUrl(url) {
  return url.endsWith('.json') ? url : `${url.replace(/\/$/, '')}/catalog.json`;
}

/**
 * Where a source's catalog index lives: `index.json` in its catalog's
 * directory.  `https://x/modules/` and `https://x/modules/catalog.json` both
 * give `https://x/modules/index.json`.
 */
function indexUrlFor(sourceUrl) {
  return new URL(CATALOG_INDEX_FILENAME, resolveCatalogUrl(sourceUrl)).toString();
}

// ============================================================================
// Transport
// ============================================================================

/**
 * GET a URL over TLS, with a size cap, a timeout and bounded redirects.
 *
 * Plain HTTP is refused outright.  A catalog names the download URL and the
 * expected checksum for every module, so anyone who can rewrite it in transit
 * chooses what gets installed -- and a module is a SQLite database the app
 * opens and queries.
 */
function fetchOnce(url, { maxBytes, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Not a valid URL: ${url}`));
      return;
    }
    if (parsed.protocol !== 'https:') {
      reject(new Error(`Refusing to fetch over ${parsed.protocol} -- catalogs and modules must be served over HTTPS: ${url}`));
      return;
    }

    const request = https.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      autoSelectFamilyAttemptTimeout: CONNECT_ATTEMPT_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects fetching ${url}`));
          return;
        }
        const next = new URL(response.headers.location, url).toString();
        resolve(fetchOnce(next, { maxBytes, redirectsLeft: redirectsLeft - 1 }));
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(Object.assign(new Error(`HTTP ${status} fetching ${url}`), { status }));
        return;
      }

      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (maxBytes && received > maxBytes) {
          request.destroy();
          reject(new Error(`Response from ${url} exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.on('timeout', () => {
      request.destroy();
      reject(Object.assign(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms fetching ${url}`), { code: 'ETIMEDOUT' }));
    });
    request.on('error', reject);
  });
}

/**
 * `fetchOnce`, tried again when the network rather than the server failed: a
 * dropped connection, or a connect that timed out.
 */
async function fetchBuffer(url, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchOnce(url, options);
    } catch (err) {
      if (attempt >= FETCH_ATTEMPTS || !RETRYABLE_CODES.has(err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * An error's message, or what it is made of when it has none: Node's dual-stack
 * connect fails with an AggregateError whose own message is empty.
 */
function describeError(err) {
  if (err.message) return err.message;
  const causes = (err.errors || []).map((e) => `${e.code ?? e.message} ${e.address ?? ''}`.trim());
  return [err.code ?? err.name, ...causes].join('; ');
}

// ============================================================================
// Signature verification -- mirrors CatalogSignatureVerifier
// ============================================================================

/**
 * Verify a detached catalog signature.
 *
 * Runs against the exact bytes received, never a re-serialized object, so
 * formatting differences can never break the digest -- which is the reason the
 * signature is detached in the first place.
 *
 * Verdicts match the desktop's `CatalogSignatureStatus`.  `expectedPublicKey`
 * may be one key or a list of keys; a signature by any listed key is accepted.
 */
function verifyCatalogSignature(catalogBytes, signatureJson, { expectedPublicKey } = {}) {
  if (signatureJson === null) {
    return { status: 'unsigned', message: 'No signature was served alongside this catalog.' };
  }

  let doc;
  try {
    doc = JSON.parse(signatureJson);
  } catch (err) {
    return { status: 'error', message: `Failed to parse catalog signature: ${err.message}` };
  }

  // The top-level fields are the primary signature; `signatures` may add more
  // over the same bytes (key rotation).  Every one must verify, and one by a
  // trusted key is enough.
  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isRecord(doc) || (doc.signatures !== undefined && !Array.isArray(doc.signatures))) {
    return { status: 'error', message: SIGNATURE_SHAPE_ERROR };
  }
  const entries = [doc, ...(doc.signatures ?? [])];
  if (entries.length > MAX_CATALOG_SIGNATURES) {
    return {
      status: 'error',
      message: `Catalog carries ${entries.length} signatures; at most ${MAX_CATALOG_SIGNATURES} are accepted.`,
    };
  }
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.publicKey !== 'string' || typeof entry.signature !== 'string'
        || entry.algorithm !== 'ed25519-sha256') {
      return { status: 'error', message: SIGNATURE_SHAPE_ERROR };
    }
    if (!/^[0-9a-f]{64}$/i.test(entry.publicKey)) {
      return { status: 'error', message: 'publicKey must be 64 hex characters (32-byte Ed25519 key).' };
    }
    if (!/^[0-9a-f]{128}$/i.test(entry.signature)) {
      return { status: 'error', message: 'signature must be 128 hex characters (64-byte Ed25519 signature).' };
    }
  }

  const digest = createHash('sha256').update(catalogBytes).digest();
  const signers = [];
  for (const entry of entries) {
    let valid;
    try {
      const keyObject = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(entry.publicKey, 'hex')]),
        format: 'der',
        type: 'spki',
      });
      valid = verify(null, digest, keyObject, Buffer.from(entry.signature, 'hex'));
    } catch (err) {
      return { status: 'error', message: `Catalog signature verification error: ${err.message}` };
    }

    if (!valid) {
      return {
        status: 'invalid',
        publicKey: entry.publicKey,
        message: 'Catalog signature does not match its contents -- the catalog may have been tampered with in transit.',
      };
    }
    signers.push(entry.publicKey);
  }

  const trustedKeys = (typeof expectedPublicKey === 'string' ? [expectedPublicKey] : (expectedPublicKey ?? []))
    .filter((key) => key.length > 0);
  if (trustedKeys.length === 0) {
    return {
      status: 'verified',
      publicKey: signers[0],
      signers,
      message: `Catalog signature verified (key ${shortKey(signers[0])} recorded on first use).`,
    };
  }

  const trustedSigner = signers.find((signer) =>
    trustedKeys.some((key) => key.toLowerCase() === signer.toLowerCase()));
  if (trustedSigner === undefined) {
    return {
      status: 'untrusted_key',
      publicKey: signers[0],
      signers,
      message:
        `Catalog is signed by a different key than the one previously trusted for this source ` +
        `(expected ${trustedKeys.map(shortKey).join(' or ')}, got ${signers.map(shortKey).join(', ')}). ` +
        'If the publisher rotated keys, delete the entry in catalog-trust.json to accept the new one.',
    };
  }

  return {
    status: 'verified',
    publicKey: trustedSigner,
    signers,
    message: 'Catalog signature verified against the trusted key.',
  };
}

const SIGNATURE_SHAPE_ERROR =
  'Catalog signature has an invalid shape (expected publicKey, signature, algorithm: "ed25519-sha256").';

/** Mirrors `MAX_CATALOG_SIGNATURES` in the desktop's `CatalogSignatureVerifier`. */
const MAX_CATALOG_SIGNATURES = 8;

function shortKey(hex) {
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/** `verified` and `unsigned` may be used; a broken signature may not. */
function isCatalogUsable(result) {
  return result.status === 'verified' || result.status === 'unsigned';
}

// ============================================================================
// Trust-on-first-use record
// ============================================================================

function trustStorePath(modulesDir) {
  return path.join(path.dirname(modulesDir), 'catalog-trust.json');
}

function readTrust(modulesDir, url) {
  try {
    const store = JSON.parse(fs.readFileSync(trustStorePath(modulesDir), 'utf8'));
    return store[url] ?? null;
  } catch {
    return null;
  }
}

function recordTrust(modulesDir, url, entry) {
  const file = trustStorePath(modulesDir);
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* first use */ }
  store[url] = { ...(store[url] ?? {}), ...entry, lastFetched: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

// ============================================================================
// Official pins -- read from the desktop's trustedCatalogKeys.ts
// ============================================================================

let officialTrust = null;

/**
 * The desktop's compiled-in trust anchors, `{ keys, prefixes }`, read from its
 * source so the two can never disagree.  Read with a pattern rather than
 * imported, since this script cannot load TypeScript (`scripts/yubikey-sign.py`
 * does the same).  Throws if the file cannot be read: an official catalog must
 * never quietly fall back to trust-on-first-use.
 */
function readOfficialTrust() {
  if (officialTrust) return officialTrust;

  let source;
  try {
    source = fs.readFileSync(TRUSTED_KEYS_FILE, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read the official signing keys from ${TRUSTED_KEYS_FILE}: ${err.message}`);
  }
  const arrayBody = (name) => {
    const match = source.match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!match) throw new Error(`Cannot find ${name} in ${TRUSTED_KEYS_FILE}.`);
    return match[1];
  };

  officialTrust = {
    keys: [...arrayBody('OFFICIAL_PUBLIC_KEYS').matchAll(/'([0-9a-fA-F]{64})'/g)].map((m) => m[1].toLowerCase()),
    prefixes: [...arrayBody('OFFICIAL_CATALOG_URL_PREFIXES').matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]),
  };
  return officialTrust;
}

/** Checks-only: replace the anchors read from trustedCatalogKeys.ts; `null` restores them. */
function __setOfficialTrustForChecks(trust) {
  officialTrust = trust;
}

/**
 * The official prefix `url` falls under while pinning is in force (at least
 * one key), or undefined.  Mirrors `isPinnedOfficialCatalog`.
 */
function officialScope(url) {
  const { keys, prefixes } = readOfficialTrust();
  if (keys.length === 0) return undefined;
  const lower = url.toLowerCase();
  return prefixes.find((prefix) => lower.startsWith(prefix.toLowerCase()));
}

// Keys the user approved from a vouch.  A separate file from the first-use
// record, mirroring the desktop's ApprovedCatalogKeys.ts.

function approvedKeysPath(modulesDir) {
  return path.join(path.dirname(modulesDir), 'catalog-approved-keys.json');
}

function readApprovedKeys(modulesDir, scope) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(approvedKeysPath(modulesDir), 'utf8'));
  } catch {
    return []; // Missing is normal; unreadable means no approvals, never more.
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.publicKey === 'string' && /^[0-9a-f]{64}$/i.test(e.publicKey)
      && typeof e.scope === 'string' && e.scope.toLowerCase() === scope.toLowerCase())
    .map((e) => e.publicKey.toLowerCase());
}

function recordApprovedKey(modulesDir, entry) {
  const file = approvedKeysPath(modulesDir);
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* first approval */ }
  if (!Array.isArray(list)) list = [];
  list.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
}

// ============================================================================
// Key vouches -- mirrors CatalogKeyVouches.ts
// ============================================================================

/** The exact bytes a vouch signature covers.  Must match the desktop's `vouchMessage`. */
function vouchMessage(vouch) {
  return Buffer.from(
    `${VOUCH_MAGIC}\n` +
    `scope: ${vouch.scope}\n` +
    `vouching-key: ${vouch.vouchingKey.toLowerCase()}\n` +
    `new-key: ${vouch.newKey.toLowerCase()}\n` +
    `issued: ${vouch.issued}\n`,
    'utf8'
  );
}

function isWellFormedVouch(v) {
  return Boolean(v) && typeof v === 'object'
    && typeof v.vouchingKey === 'string' && /^[0-9a-f]{64}$/i.test(v.vouchingKey)
    && typeof v.newKey === 'string' && /^[0-9a-f]{64}$/i.test(v.newKey)
    && typeof v.scope === 'string' && /^https:\/\/\S+$/.test(v.scope)
    && typeof v.issued === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v.issued)
    && typeof v.signature === 'string' && /^[0-9a-f]{128}$/i.test(v.signature);
}

function isVouchSignatureValid(v) {
  try {
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(v.vouchingKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, vouchMessage(v), keyObject, Buffer.from(v.signature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * A catalog signer that a chain of valid vouches links to a trusted key, as
 * `{ newKey, chain }`, or undefined.  Mirrors the desktop's `findVouchedKey`:
 * bad vouches are skipped, a document of the wrong format or size is ignored.
 */
function findVouchedKey(vouchesJson, { trustedKeys, signers, scope }) {
  let doc;
  try {
    doc = JSON.parse(vouchesJson);
  } catch {
    return undefined;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.format !== VOUCH_FORMAT
      || doc.version !== VOUCH_VERSION || !Array.isArray(doc.vouches) || doc.vouches.length > MAX_VOUCHES) {
    return undefined;
  }
  const usable = doc.vouches.filter((v) => isWellFormedVouch(v)
    && v.scope.toLowerCase() === scope.toLowerCase() && isVouchSignatureValid(v));

  // Breadth-first from the trusted keys, so the shortest chain wins.
  const chains = new Map(trustedKeys.map((key) => [key.toLowerCase(), []]));
  let frontier = [...chains.keys()];
  while (frontier.length > 0) {
    const next = [];
    for (const v of usable) {
      const from = v.vouchingKey.toLowerCase();
      const to = v.newKey.toLowerCase();
      if (frontier.includes(from) && !chains.has(to)) {
        chains.set(to, [...chains.get(from), v]);
        next.push(to);
      }
    }
    frontier = next;
  }

  for (const signer of signers) {
    const chain = chains.get(signer.toLowerCase());
    if (chain && chain.length > 0) return { newKey: signer.toLowerCase(), chain };
  }
  return undefined;
}

/**
 * For an official document whose signatures all verify but none is by a pinned
 * or approved key: look for a vouch chain from a trusted key and ask before
 * trusting its key.  Mirrors the desktop's `tryVouchedKey`.  `--yes` never
 * approves; a blank answer or a closed stdin is a no.  Returns the verdict to
 * use -- the original `untrusted_key` (with a clearer message) unless approved.
 */
async function tryVouchedKey(url, scope, trustedKeys, result, { modulesDir, log, assumeYes }) {
  const refused = (why) => ({
    ...result,
    message: `${why}  If the publisher changed keys, update this checkout (trustedCatalogKeys.ts).`,
  });

  let vouchesJson;
  try {
    vouchesJson = (await fetchBuffer(`${url}.vouches`, { maxBytes: VOUCHES_MAX_BYTES })).toString('utf8');
  } catch {
    return refused('It is signed by a key that is not an official key.');
  }
  const vouched = findVouchedKey(vouchesJson, { trustedKeys, signers: result.signers ?? [], scope });
  if (!vouched) {
    return refused('It is signed by a key that is not an official key, and no trusted key vouches for it.');
  }

  log.warn('');
  log.warn(`  ${url} is signed with a key this checkout does not know yet:`);
  log.warn(`    ${vouched.newKey}`);
  log.warn('  A key it already trusts vouched for it:');
  for (const link of vouched.chain) {
    log.warn(`    ${link.vouchingKey}  vouched for  ${link.newKey}  on ${link.issued}`);
  }
  if (assumeYes) {
    return refused('A vouched key needs your approval, which --yes never gives; re-run without it to review the key.');
  }
  const answer = askSync('  Trust the new key? Only if you expected the publisher to change keys. [y/N] ');
  if (!/^y(es)?$/i.test(answer)) {
    return refused('The new key was not approved.');
  }

  const link = vouched.chain[vouched.chain.length - 1];
  recordApprovedKey(modulesDir, {
    publicKey: vouched.newKey,
    scope,
    vouchedBy: link.vouchingKey,
    issued: link.issued,
    approvedAt: new Date().toISOString(),
  });
  return {
    status: 'verified',
    publicKey: vouched.newKey,
    signers: result.signers,
    message: 'Signature verified against a new key you approved.',
  };
}

// ============================================================================
// Catalog fetch
// ============================================================================

/**
 * Fetch a signed JSON document -- a catalog or a catalog index -- and verify
 * its sibling `.sig`.
 *
 * Under the official URL prefix the desktop's pins apply from the very first
 * run: the signature must be by a pinned key (or one the user approved from a
 * vouch), and an unsigned document is refused.  Anywhere else it is
 * trust-on-first-use.
 *
 * `validate(doc)` runs before the signature is looked at, and throws if the
 * document is not the kind expected; nothing is recorded for a document that
 * fails it.  Fetch errors keep their HTTP `status`, so a caller can tell "not
 * published" from "broken".  Returns the parsed document.
 *
 * `context` is `{ modulesDir, log, assumeYes }`.
 */
async function fetchSignedJson(url, { what, maxBytes, unsigned, validate }, context) {
  const { modulesDir, log } = context;
  log.info(`Fetching ${url} ...`);

  const bytes = await fetchBuffer(url, { maxBytes });

  let doc;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${what} at ${url} is not valid JSON.`);
  }
  validate(doc);

  // The signature is a sibling `.sig`; its absence is a verdict, not an error.
  let signatureJson = null;
  try {
    signatureJson = (await fetchBuffer(`${url}.sig`, { maxBytes: 64 * 1024 })).toString('utf8');
  } catch (err) {
    if (!err.status) log.debug(`  (no signature: ${err.message})`);
  }

  const scope = officialScope(url);
  const trusted = scope ? null : readTrust(modulesDir, url);
  const expectedKeys = scope
    ? [...readOfficialTrust().keys, ...readApprovedKeys(modulesDir, scope)]
    : trusted?.publicKey;
  let result = verifyCatalogSignature(bytes, signatureJson, { expectedPublicKey: expectedKeys });

  if (result.status === 'unsigned' && scope) {
    throw new Error(
      `${url} serves no signature, but everything under ${scope} must be signed by an\n` +
      '  official key (trustedCatalogKeys.ts).  Refusing to use it.'
    );
  }

  // Once a source has served a valid signature it may never go back to none:
  // an unsigned document from a source known to sign is a downgrade, not a
  // configuration choice.  Mirrors `isSignatureRequired`.
  if (result.status === 'unsigned' && trusted?.publicKey) {
    throw new Error(
      `${url} previously served a valid signature and now serves none.\n` +
      '  This is what a downgrade attack looks like.  If the publisher genuinely stopped\n' +
      `  signing, remove its entry from ${trustStorePath(modulesDir)} to accept that.`
    );
  }

  // Official, every signature valid, none by a key we trust: a vouch may bridge
  // the gap, with the user's approval.
  if (result.status === 'untrusted_key' && scope) {
    result = await tryVouchedKey(url, scope, expectedKeys, result, context);
  }

  if (!isCatalogUsable(result)) {
    throw new Error(`${what} signature check failed for ${url}:\n  ${result.message}`);
  }

  if (result.status === 'verified') {
    log.info(`  ${result.message}`);
    // Official documents answer to the pins, never to a first-use record.
    if (!scope) recordTrust(modulesDir, url, { publicKey: result.publicKey, signed: true });
  } else {
    log.warn(`  This ${what.toLowerCase()} is UNSIGNED.`);
    log.warn(`  ${unsigned}`);
    log.warn('  Acceptable for a development or self-hosted catalog; not for an untrusted one.');
    recordTrust(modulesDir, url, { signed: false });
  }

  return doc;
}

/** `context` is `{ modulesDir, log, assumeYes }`, as for `fetchSignedJson`. */
async function fetchCatalog(sourceUrl, context) {
  const catalogUrl = resolveCatalogUrl(sourceUrl);
  return fetchSignedJson(catalogUrl, {
    what: 'Catalog',
    maxBytes: CATALOG_MAX_BYTES,
    unsigned: 'Nothing proves the download URLs and checksums below are the publisher\'s.',
    validate: (catalog) => {
      if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.modules)) {
        throw new Error(`Catalog at ${catalogUrl} has no "modules" array -- it does not look like a repository catalog.`);
      }
    },
  }, context);
}

// ============================================================================
// Catalog index -- mirrors CatalogIndex.ts
// ============================================================================

/**
 * The catalogs a `kth-bible-catalog-index` document lists, as absolute URLs.
 *
 * Mirrors the desktop's `parseCatalogIndex`, with one difference: the desktop
 * holds entries to the official URL prefix, while this script -- which has no
 * pins -- holds them to the index's own directory.  Either way an index can
 * only point at catalogs beside or below itself.  Throws when the document is
 * not an index; skips (and reports) bad entries so one cannot hide the rest.
 */
function readCatalogIndex(doc, indexUrl) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)
      || doc.format !== CATALOG_INDEX_FORMAT || doc.version !== CATALOG_INDEX_VERSION) {
    throw new Error(`${indexUrl} is not a version ${CATALOG_INDEX_VERSION} "${CATALOG_INDEX_FORMAT}" document.`);
  }
  if (!Array.isArray(doc.catalogs)) {
    throw new Error(`${indexUrl} has no "catalogs" array.`);
  }
  if (doc.catalogs.length > MAX_INDEX_CATALOGS) {
    throw new Error(`${indexUrl} lists ${doc.catalogs.length} catalogs; at most ${MAX_INDEX_CATALOGS} are read.`);
  }

  const scope = new URL('./', indexUrl).toString().toLowerCase();
  const entries = [];
  const rejected = [];
  const seen = new Set([indexUrl.toLowerCase()]);

  doc.catalogs.forEach((raw, position) => {
    if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string' || raw.url === ''
        || typeof raw.name !== 'string' || raw.name.trim() === '' || raw.name.length > 200
        || (raw.abbreviation !== undefined
          && (typeof raw.abbreviation !== 'string' || raw.abbreviation.length > 20))) {
      rejected.push(`#${position}: needs a "url" and a short "name"`);
      return;
    }

    let url;
    try {
      url = new URL(raw.url, indexUrl).toString();
    } catch {
      rejected.push(`#${position}: "${raw.url}" is not a valid URL`);
      return;
    }
    // The URL parser has already folded any "../" segments.
    if (!url.toLowerCase().startsWith(scope)) {
      rejected.push(`#${position}: ${url} is outside ${scope}`);
      return;
    }
    if (seen.has(url.toLowerCase())) {
      rejected.push(`#${position}: ${url} is the index itself or listed twice`);
      return;
    }

    seen.add(url.toLowerCase());
    entries.push({ url, name: raw.name.trim(), abbreviation: raw.abbreviation });
  });

  return { entries, rejected };
}

/**
 * The catalogs a source offers, as `[{ catalogUrl, catalog }]`.
 *
 * Always looks for `index.json` beside the catalog first.  With one, every
 * catalog it lists is loaded -- each checked against its own signature, so
 * adding a module to one catalog never means re-signing the rest.  Without one
 * (HTTP 404), the source's single catalog is used, as before.
 *
 * The index must pass its own signature check.  A listed catalog that cannot
 * be loaded is skipped with the reason, as the desktop's refresh does; the run
 * fails only if none loads.
 */
async function loadCatalogs(sourceUrl, context) {
  const { log } = context;
  const indexUrl = indexUrlFor(sourceUrl);

  let index;
  try {
    index = await fetchSignedJson(indexUrl, {
      what: 'Catalog index',
      maxBytes: CATALOG_INDEX_MAX_BYTES,
      unsigned: 'Nothing proves the catalogs it lists are the publisher\'s.',
      validate: (doc) => readCatalogIndex(doc, indexUrl),
    }, context);
  } catch (err) {
    if (err.status !== 404) throw err;
    log.info('  No catalog index there; using the single catalog.');
    const catalogUrl = resolveCatalogUrl(sourceUrl);
    return [{ catalogUrl, catalog: await fetchCatalog(catalogUrl, context) }];
  }

  const { entries, rejected } = readCatalogIndex(index, indexUrl);
  for (const problem of rejected) log.warn(`  Ignoring index entry ${problem}`);
  log.info(`  The index lists ${entries.length} catalog(s).`);

  const loaded = [];
  for (const entry of entries) {
    const catalogUrl = resolveCatalogUrl(entry.url);
    try {
      loaded.push({ catalogUrl, catalog: await fetchCatalog(catalogUrl, context) });
    } catch (err) {
      log.warn(`  Skipping ${entry.name}: ${err.message}`);
    }
  }
  if (loaded.length === 0) {
    throw new Error(`None of the catalogs listed in ${indexUrl} could be loaded.`);
  }
  return loaded;
}

/**
 * Every catalog's modules in one list, each remembered with the catalog that
 * listed it (its `download_url` is relative to that catalog).  A module offered
 * by more than one catalog is taken from the first.
 */
function mergeModules(catalogs, log) {
  const entries = [];
  const sourceOf = new Map();
  const seen = new Set();
  for (const { catalogUrl, catalog } of catalogs) {
    for (const entry of catalog.modules) {
      const key = entry.module_id ?? entry.abbreviation;
      if (seen.has(key)) {
        log.warn(`  ${entry.abbreviation ?? key} is offered by more than one catalog; using the first.`);
        continue;
      }
      seen.add(key);
      entries.push(entry);
      sourceOf.set(entry, catalogUrl);
    }
  }
  return { entries, sourceOf };
}

// ============================================================================
// Selection
// ============================================================================

function formatSize(bytes) {
  if (!bytes) return '?';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

/**
 * Ask which modules to install.
 *
 * A numbered list read from stdin rather than an arrow-key checkbox widget:
 * it needs no dependency, it survives a pipe, an SSH session and a terminal
 * that does not do raw mode, and it can be answered in one line.  `--select`
 * and `--yes` cover the non-interactive case, which is the one CI needs.
 *
 * Returns `{ picked, unavailable }`, as `parseSelection` does.
 */
function promptForSelection(entries, presets, log) {
  log.info('');
  log.info('Available modules:');
  entries.forEach((entry, index) => {
    const flag = entry.recommended ? '*' : ' ';
    const number = String(index + 1).padStart(3);
    log.info(`${number}.${flag} ${entry.abbreviation.padEnd(16)} ${formatSize(entry.download_size_bytes).padStart(8)}  ${entry.name}`);
  });
  log.info('');
  log.info('  * = recommended');
  for (const [name, abbrs] of Object.entries(presets)) {
    log.info(`  ${name}: ${abbrs.join(', ')}`);
  }
  log.info('  Enter numbers and/or ranges (e.g. "1 3 5-8"), a preset name above, "recommended",');
  log.info('  "all", or blank to cancel.');

  const answer = askSync('Install which modules? ');
  return parseSelection(answer, entries, presets);
}

/** Read one line from stdin synchronously, so the flow reads top to bottom. */
function askSync(question) {
  process.stdout.write(question);
  const buffer = Buffer.alloc(1024);
  let read = 0;
  try {
    read = fs.readSync(0, buffer, 0, buffer.length, null);
  } catch (err) {
    // EAGAIN on a non-blocking stdin, EOF on a closed one: both mean nobody is
    // there to answer, which is a cancel rather than a crash.
    if (err.code !== 'EOF' && err.code !== 'EAGAIN') throw err;
  }
  return buffer.toString('utf8', 0, read).trim();
}

/** Catalog entries keyed by lower-cased abbreviation. */
function indexByAbbreviation(entries) {
  return new Map(entries.map((e) => [e.abbreviation.toLowerCase(), e]));
}

/** The module list of the preset called `name` (any case), or null. */
function findPreset(name, presets) {
  const key = Object.keys(presets).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? presets[key] : null;
}

/**
 * Split a preset's modules into the entries this catalog offers and the
 * abbreviations it does not.
 *
 * A preset is a wish list, not a contract with any one catalog: the same
 * `starter` is used against the official catalog, the development catalog, a
 * mirror and a self-hosted one, and they do not all carry every module.  So a module the
 * catalog lacks is reported and skipped.  A module named explicitly and
 * missing is still an error -- that is a typo or the wrong catalog.
 */
function expandPreset(abbreviations, byAbbr) {
  const offered = [];
  const unavailable = [];
  for (const abbr of abbreviations) {
    const entry = byAbbr.get(abbr.toLowerCase());
    if (entry) offered.push(entry);
    else unavailable.push(abbr);
  }
  return { offered, unavailable };
}

/**
 * Resolve `--select` names -- abbreviations and preset names -- against the
 * catalog.
 *
 * Returns `{ picked, unknown, unavailable }`: the entries to install, in the
 * order named and without repeats; explicit names the catalog does not offer;
 * and preset members it does not offer.  A preset name wins over a module that
 * happens to share it.
 */
function selectByName(names, entries, presets = {}) {
  const byAbbr = indexByAbbreviation(entries);
  const picked = new Set();
  const unknown = [];
  const unavailable = new Set();

  for (const name of names) {
    const preset = findPreset(name, presets);
    if (preset) {
      const expanded = expandPreset(preset, byAbbr);
      expanded.offered.forEach((entry) => picked.add(entry));
      expanded.unavailable.forEach((abbr) => unavailable.add(abbr));
    } else if (byAbbr.has(name.toLowerCase())) {
      picked.add(byAbbr.get(name.toLowerCase()));
    } else {
      unknown.push(name);
    }
  }
  return { picked: [...picked], unknown, unavailable: [...unavailable] };
}

/**
 * "1 3 5-8", a preset name, "recommended", "all", or empty -- or numbers and
 * presets mixed, as in "starter 12".
 *
 * Returns `{ picked, unavailable }`: the chosen entries in catalog order, and
 * any preset members this catalog does not offer.
 */
function parseSelection(answer, entries, presets = {}) {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === '') return { picked: [], unavailable: [] };
  if (trimmed === 'all') return { picked: [...entries], unavailable: [] };
  if (trimmed === 'recommended' || trimmed === 'rec') {
    return { picked: entries.filter((e) => e.recommended), unavailable: [] };
  }

  const byAbbr = indexByAbbreviation(entries);
  const entryAt = (index) => {
    const entry = entries[index - 1];
    if (!entry) throw new Error(`There is no module ${index}; the list has ${entries.length}.`);
    return entry;
  };

  const chosen = new Set();
  const unavailable = new Set();
  for (const token of trimmed.split(/[\s,]+/).filter(Boolean)) {
    const preset = findPreset(token, presets);
    const range = token.match(/^(\d+)-(\d+)$/);
    if (preset) {
      const expanded = expandPreset(preset, byAbbr);
      expanded.offered.forEach((entry) => chosen.add(entry));
      expanded.unavailable.forEach((abbr) => unavailable.add(abbr));
    } else if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) chosen.add(entryAt(i));
    } else if (/^\d+$/.test(token)) {
      chosen.add(entryAt(Number(token)));
    } else {
      const names = Object.keys(presets).map((name) => `"${name}"`);
      throw new Error(`Not a selection: "${token}". Use numbers, ranges, ${[...names, '"recommended"'].join(', ')} or "all".`);
    }
  }

  return { picked: entries.filter((e) => chosen.has(e)), unavailable: [...unavailable] };
}

/** Say which preset modules the catalog lacked; the rest of the preset still installs. */
function reportUnavailable(unavailable, log) {
  if (unavailable.length === 0) return;
  log.warn(`  Not offered by this catalog, so skipped: ${unavailable.join(', ')}.`);
  log.warn('  The rest of the preset is installed; re-run once the catalog carries them.');
}

// ============================================================================
// Download
// ============================================================================

/**
 * Download one module, verify it, and put it in place.
 *
 * Three details of the real catalog format that are easy to get wrong:
 *
 *   - `download_url` is **relative to the catalog document**, not absolute
 *     ("commentary/commentary_personal.db.gz").  It is resolved against the
 *     catalog URL, which also means a module is fetched from the same origin
 *     that served the catalog unless a publisher deliberately makes it
 *     absolute.
 *   - Payloads are **gzipped**.  The `.gz` is what travels; the `.db` is what
 *     lands.
 *   - The checksum covers the **decompressed** database, not the bytes as
 *     received.  Verified against the live catalog: for `commentary_personal`
 *     the published hash matches the 77,824-byte `.db`, not the 2,170-byte
 *     `.gz`, while `download_size_bytes` is the compressed size.  Note this
 *     disagrees with `DownloadService.verifyChecksum`, which hashes the file it
 *     downloaded and leaves decompression to `InstallationService` -- nothing
 *     in the module install path calls it today (only the semantic-pack
 *     download does), so nothing is broken by it, but the two conventions
 *     cannot both be right and whichever is wrong should be corrected before a
 *     module install is ever routed through that service.
 *
 * Written to a `.part` file and renamed only once the hash matches, so an
 * interrupted or corrupted download can never be mistaken for an installed
 * module by the scan that follows.
 *
 * Skipped outright when the file already on disk has the published checksum.
 * That is what makes re-running setup take a second rather than re-fetching
 * every module, and it is safe precisely because the checksum covers the
 * unpacked `.db`: a matching file is byte-for-byte what a download would
 * produce.  A file that differs -- an older edition, or one a running app has
 * written to -- is downloaded again as before.
 *
 * Returns `{ target, skipped }`.
 */
async function downloadModule(entry, modulesDir, catalogUrl, log) {
  const url = new URL(entry.download_url, catalogUrl).toString();
  const remoteName = path.posix.basename(new URL(url).pathname);
  const compressed = remoteName.endsWith('.gz');
  const fileName = compressed ? remoteName.slice(0, -'.gz'.length) : remoteName;
  if (!fileName.endsWith('.db')) {
    throw new Error(`${entry.abbreviation}: download_url does not name a .db (or .db.gz) file: ${entry.download_url}`);
  }

  const target = path.join(modulesDir, fileName);
  const partial = `${target}.part`;
  const expected = entry.checksum ? entry.checksum.replace(/^sha256:/i, '').toLowerCase() : null;

  if (expected && fs.existsSync(target) && await sha256OfFile(target) === expected) {
    log.info(`  ${entry.abbreviation}: already installed and matches the catalog checksum; skipped.`);
    return { target, skipped: true };
  }

  log.info(`  ${entry.abbreviation} (${formatSize(entry.download_size_bytes)}) ...`);
  const received = await fetchBuffer(url, {});

  let bytes;
  try {
    bytes = compressed ? gunzipSync(received) : received;
  } catch (cause) {
    throw new Error(`${entry.abbreviation}: served payload is not valid gzip (${cause.message})`);
  }

  if (expected) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) {
      throw new Error(
        `Checksum mismatch for ${entry.abbreviation}.
` +
        `    expected ${expected}
    got      ${actual}
` +
        '    The file was not written.'
      );
    }
  } else {
    log.warn(`    No checksum in the catalog for ${entry.abbreviation}; nothing verifies these bytes.`);
  }

  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, target);
  log.info(`    -> ${fileName}${compressed ? ` (${formatSize(bytes.length)} unpacked)` : ''}`);
  return { target, skipped: false };
}

/** SHA-256 of a file, streamed so a large module is never held in memory whole. */
function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Fetch the source's catalogs (every one its index lists, see `loadCatalogs`),
 * pick modules, download them into `modulesDir`.
 *
 * Returns 'installed', 'nothing' (the user chose nothing) or 'aborted'.  The
 * caller then runs its ordinary scan over the directory, so a downloaded module
 * is registered by exactly the same code path as one copied in by hand -- there
 * is no second way for a module to enter the registry.
 *
 * `select` may name presets from `presets` (name -> abbreviations) as well as
 * modules; so may an answer at the prompt.
 */
async function runCatalogInstall({ source, modulesDir, select, presets = {}, assumeYes, log }) {
  const url = source || defaultCatalogUrl();
  if (!url) {
    log.error('No catalog URL: none was given, BIBLE_MODULE_CATALOG_URL is not set, and');
    log.error('branding.json has no settled moduleRepositoryUrl.');
    log.error('For the development catalog:  npm run init:modules:dev');
    log.error('Or pass one explicitly:       npm run init -- --catalog=https://example.org/catalog.json');
    return 'aborted';
  }

  try {
    const catalogs = await loadCatalogs(url, { modulesDir, log, assumeYes });
    for (const { catalog } of catalogs) {
      log.info(`  ${catalog.repository?.name ?? 'Catalog'}: ${catalog.modules.length} module(s) offered.`);
    }
    const { entries, sourceOf } = mergeModules(catalogs, log);
    if (entries.length === 0) {
      log.warn('No catalog lists any modules.');
      return 'nothing';
    }

    let chosen;
    if (select && select.length > 0) {
      const { picked, unknown, unavailable } = selectByName(select, entries, presets);
      if (unknown.length > 0) {
        throw new Error(`The catalog does not offer: ${unknown.join(', ')}`);
      }
      reportUnavailable(unavailable, log);
      chosen = picked;
    } else if (assumeYes) {
      chosen = entries.filter((e) => e.recommended);
      log.info(`  --yes: taking the ${chosen.length} recommended module(s).`);
      if (chosen.length === 0 && Object.keys(presets).length > 0) {
        log.info(`  This catalog marks none; choose a preset instead, e.g. --select=${Object.keys(presets)[0]}.`);
      }
    } else {
      const { picked, unavailable } = promptForSelection(entries, presets, log);
      reportUnavailable(unavailable, log);
      chosen = picked;
    }

    if (chosen.length === 0) {
      log.info('Nothing selected.');
      return 'nothing';
    }

    const total = chosen.reduce((sum, e) => sum + (e.download_size_bytes || 0), 0);
    log.info('');
    log.info(`Installing ${chosen.length} module(s), up to ${formatSize(total)} to download:`);
    let skipped = 0;
    for (const entry of chosen) {
      if ((await downloadModule(entry, modulesDir, sourceOf.get(entry), log)).skipped) skipped += 1;
    }
    if (skipped > 0) {
      log.info(`  ${skipped} of ${chosen.length} were already up to date.`);
    }
    return 'installed';
  } catch (err) {
    log.error('');
    log.error(`Catalog install failed: ${describeError(err)}`);
    return 'aborted';
  }
}

module.exports = {
  runCatalogInstall,
  verifyCatalogSignature,
  isCatalogUsable,
  parseSelection,
  selectByName,
  downloadModule,
  resolveCatalogUrl,
  fetchCatalog,
  indexUrlFor,
  readCatalogIndex,
  mergeModules,
  readOfficialTrust,
  vouchMessage,
  findVouchedKey,
  __setOfficialTrustForChecks,
};
