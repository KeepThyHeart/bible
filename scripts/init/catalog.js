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
 * Unsigned catalogs are permitted, matching `isCatalogUsable` -- self-hosted
 * and development catalogs are unsigned by default -- but the fact is printed
 * every time, and once a source has served a valid signature this script will
 * not accept an unsigned one from it again.
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

/** Bounded like the desktop's NetworkGateway; a redirect chain is not a maze. */
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

const BRAND_DIR = path.resolve(__dirname, '../../admin/brand');

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
function fetchBuffer(url, { maxBytes, redirectsLeft = MAX_REDIRECTS } = {}) {
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

    const request = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (response) => {
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`Too many redirects fetching ${url}`));
          return;
        }
        const next = new URL(response.headers.location, url).toString();
        resolve(fetchBuffer(next, { maxBytes, redirectsLeft: redirectsLeft - 1 }));
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
      reject(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms fetching ${url}`));
    });
    request.on('error', reject);
  });
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
 * Verdicts match the desktop's `CatalogSignatureStatus`.
 */
function verifyCatalogSignature(catalogBytes, signatureJson, { expectedPublicKey } = {}) {
  if (signatureJson === null) {
    return { status: 'unsigned', message: 'No signature was served alongside this catalog.' };
  }

  let sig;
  try {
    sig = JSON.parse(signatureJson);
  } catch (err) {
    return { status: 'error', message: `Failed to parse catalog signature: ${err.message}` };
  }

  if (!sig || typeof sig.publicKey !== 'string' || typeof sig.signature !== 'string'
      || sig.algorithm !== 'ed25519-sha256') {
    return {
      status: 'error',
      message: 'Catalog signature has an invalid shape (expected publicKey, signature, algorithm: "ed25519-sha256").',
    };
  }
  if (!/^[0-9a-f]{64}$/i.test(sig.publicKey)) {
    return { status: 'error', message: 'publicKey must be 64 hex characters (32-byte Ed25519 key).' };
  }
  if (!/^[0-9a-f]{128}$/i.test(sig.signature)) {
    return { status: 'error', message: 'signature must be 128 hex characters (64-byte Ed25519 signature).' };
  }

  let valid;
  try {
    const keyObject = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(sig.publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const digest = createHash('sha256').update(catalogBytes).digest();
    valid = verify(null, digest, keyObject, Buffer.from(sig.signature, 'hex'));
  } catch (err) {
    return { status: 'error', message: `Catalog signature verification error: ${err.message}` };
  }

  if (!valid) {
    return {
      status: 'invalid',
      publicKey: sig.publicKey,
      message: 'Catalog signature does not match its contents -- the catalog may have been tampered with in transit.',
    };
  }

  if (expectedPublicKey && expectedPublicKey.toLowerCase() !== sig.publicKey.toLowerCase()) {
    return {
      status: 'untrusted_key',
      publicKey: sig.publicKey,
      message:
        `Catalog is signed by a different key than the one previously trusted for this source ` +
        `(expected ${shortKey(expectedPublicKey)}, got ${shortKey(sig.publicKey)}). ` +
        'If the publisher rotated keys, delete the entry in catalog-trust.json to accept the new one.',
    };
  }

  return {
    status: 'verified',
    publicKey: sig.publicKey,
    message: expectedPublicKey
      ? 'Catalog signature verified against the trusted key.'
      : `Catalog signature verified (key ${shortKey(sig.publicKey)} recorded on first use).`,
  };
}

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
// Catalog fetch
// ============================================================================

async function fetchCatalog(sourceUrl, modulesDir, log) {
  const catalogUrl = resolveCatalogUrl(sourceUrl);
  log.info(`Fetching ${catalogUrl} ...`);

  const bytes = await fetchBuffer(catalogUrl, { maxBytes: CATALOG_MAX_BYTES });

  let catalog;
  try {
    catalog = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`Catalog at ${catalogUrl} is not valid JSON.`);
  }
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.modules)) {
    throw new Error(`Catalog at ${catalogUrl} has no "modules" array -- it does not look like a repository catalog.`);
  }

  // The signature is a sibling `.sig`; its absence is a verdict, not an error.
  let signatureJson = null;
  try {
    signatureJson = (await fetchBuffer(`${catalogUrl}.sig`, { maxBytes: 64 * 1024 })).toString('utf8');
  } catch (err) {
    if (!err.status) log.debug(`  (no signature: ${err.message})`);
  }

  const trusted = readTrust(modulesDir, catalogUrl);
  const result = verifyCatalogSignature(bytes, signatureJson, {
    expectedPublicKey: trusted?.publicKey,
  });

  // Once a source has served a valid signature it may never go back to none:
  // an unsigned catalog from a source known to sign is a downgrade, not a
  // configuration choice.  Mirrors `isSignatureRequired`.
  if (result.status === 'unsigned' && trusted?.publicKey) {
    throw new Error(
      `${catalogUrl} previously served a valid signature and now serves none.\n` +
      '  This is what a downgrade attack looks like.  If the publisher genuinely stopped\n' +
      `  signing, remove its entry from ${trustStorePath(modulesDir)} to accept that.`
    );
  }

  if (!isCatalogUsable(result)) {
    throw new Error(`Catalog signature check failed for ${catalogUrl}:\n  ${result.message}`);
  }

  if (result.status === 'verified') {
    log.info(`  ${result.message}`);
    recordTrust(modulesDir, catalogUrl, { publicKey: result.publicKey, signed: true });
  } else {
    log.warn('  This catalog is UNSIGNED.');
    log.warn('  Nothing proves the download URLs and checksums below are the publisher\'s.');
    log.warn('  Acceptable for a development or self-hosted catalog; not for an untrusted one.');
    recordTrust(modulesDir, catalogUrl, { signed: false });
  }

  return catalog;
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
 * `starter` is used against the development catalog, a mirror and a
 * self-hosted one, and they do not all carry every module.  So a module the
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
 * Fetch a catalog, pick modules, download them into `modulesDir`.
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
    log.error('For the development catalog:  npm run init:modules');
    log.error('Or pass one explicitly:       npm run init -- --catalog=https://example.org/catalog.json');
    return 'aborted';
  }

  try {
    const catalogUrl = resolveCatalogUrl(url);
    const catalog = await fetchCatalog(url, modulesDir, log);
    const entries = catalog.modules;
    if (entries.length === 0) {
      log.warn('The catalog lists no modules.');
      return 'nothing';
    }
    log.info(`  ${catalog.repository?.name ?? 'Catalog'}: ${entries.length} module(s) offered.`);

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
      if ((await downloadModule(entry, modulesDir, catalogUrl, log)).skipped) skipped += 1;
    }
    if (skipped > 0) {
      log.info(`  ${skipped} of ${chosen.length} were already up to date.`);
    }
    return 'installed';
  } catch (err) {
    log.error('');
    log.error(`Catalog install failed: ${err.message}`);
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
};
