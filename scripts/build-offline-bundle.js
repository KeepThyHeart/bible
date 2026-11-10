#!/usr/bin/env node
/**
 * Builds an offline bundle - one `.biblepack` holding a whole starter pack's
 * modules - from the official module repository, for people who install the
 * app on a machine that will not go online (the "Install from files instead"
 * route on first run, and Module Manager -> Install from a file).
 *
 * Which modules go in is not decided here: it is a starter pack's `module_ids`
 * from `packages/core/src/Data/Core/starter-packs.json` (the list first run
 * offers online), so the offline bundle and the online pack cannot drift apart.
 * Every module comes from the repository's own `catalog.json`, and is checked
 * against it before it is packed:
 *
 *   - the catalog's signature, against the pinned official keys the app itself
 *     trusts (`apps/desktop/electron/services/trustedCatalogKeys.ts`);
 *   - each `.db.gz`'s size against `download_size_bytes`;
 *   - the SHA-256 of each decompressed `.db` against the catalog `checksum`.
 *
 * The module files are packed exactly as the repository serves them (gzipped),
 * via `scripts/build-module-pack.js` - the same manifest (`pack.json`), the same
 * optional `yubikey-sign.py sign-pack` signature and the same zip writer. So the
 * steps are:
 *
 *   node scripts/build-offline-bundle.js stage --pack essentials --repo <dir|url> --out <dir>
 *   python scripts/yubikey-sign.py sign-pack <out>/essentials-en-<version>/pack.json   # optional
 *   node scripts/build-offline-bundle.js bundle --pack essentials --out <dir>
 *
 * or, for an unsigned bundle (the app installs it after an "install anyway?"
 * prompt), `all` runs `stage` then `bundle` in one go.
 *
 * `bundle` writes `<out>/<bundle-id>-<version>.biblepack` and a
 * `<file>.sha256` beside it (`sha256sum` format) for the download page.
 *
 * Options:
 *   --pack <id>        Starter pack to bundle. Default: essentials.
 *   --repo <dir|url>   Module repository: a local folder holding catalog.json
 *                      (e.g. ..\Personal\bible-modules) or its URL. Default:
 *                      https://modules.bible.keepthyheart.com/modules/en/
 *   --out <dir>        Output folder. Default: dist/offline-bundles
 *   --language <tag>   Language the bundle is for; must be one of the pack's.
 *                      Default: the pack's first language.
 *   --version <v>      Bundle version. Default: the starter pack's version.
 *   --name <text>      Display name. Default: "<pack name> (<Language>)".
 *   --allow-unsigned   Accept a catalog with no valid official signature (a
 *                      local staging catalog that has not been signed yet).
 *
 * Needs Node 18+ (global fetch). Writes nothing outside --out.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const STARTER_PACKS = path.join(REPO_ROOT, 'packages/core/src/Data/Core/starter-packs.json');
const TRUSTED_KEYS = path.join(REPO_ROOT, 'apps/desktop/electron/services/trustedCatalogKeys.ts');
const BUILD_MODULE_PACK = path.join(__dirname, 'build-module-pack.js');
const DEFAULT_REPO = 'https://modules.bible.keepthyheart.com/modules/en/';
/** DER prefix for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', 'pt-BR': 'Portuguese', ru: 'Russian', zh: 'Chinese', hi: 'Hindi', ar: 'Arabic' };

function fail(message) {
  console.error(`build-offline-bundle: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!['stage', 'bundle', 'all'].includes(command)) {
    fail('Usage: node scripts/build-offline-bundle.js <stage|bundle|all> [--pack essentials] [--repo <dir|url>] [--out <dir>]');
  }
  const flags = { pack: 'essentials', repo: DEFAULT_REPO, out: path.join(REPO_ROOT, 'dist', 'offline-bundles') };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--allow-unsigned') { flags.allowUnsigned = true; continue; }
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const value = rest[++i];
    if (value === undefined) fail(`${arg} needs a value`);
    flags[arg.slice(2)] = value;
  }
  flags.out = path.resolve(flags.out);
  return { command, flags };
}

/** The starter pack, the language, and the bundle's id/version/name. */
function resolveBundle(flags) {
  const { packs } = JSON.parse(fs.readFileSync(STARTER_PACKS, 'utf8'));
  const pack = packs.find((p) => p.pack_id === flags.pack);
  if (!pack) fail(`No starter pack "${flags.pack}" in ${STARTER_PACKS}.`);
  const language = flags.language ?? pack.languages[0];
  if (!pack.languages.includes(language)) fail(`Starter pack "${pack.pack_id}" is not offered for "${language}".`);
  const version = flags.version ?? pack.version;
  const id = `${pack.pack_id}-${language.toLowerCase()}`;
  return {
    pack,
    language,
    version,
    id,
    name: flags.name ?? `${pack.name} (${LANGUAGE_NAMES[language] ?? language})`,
    stageDir: path.join(flags.out, `${id}-${version}`),
    bundlePath: path.join(flags.out, `${id}-${version}.biblepack`),
  };
}

const isUrl = (repo) => /^https?:\/\//i.test(repo);

async function readRepoFile(repo, relative) {
  if (isUrl(repo)) {
    const url = new URL(relative, repo.endsWith('/') ? repo : `${repo}/`).href;
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) fail(`GET ${url} -> HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const file = path.join(repo, ...relative.split('/'));
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function officialKeys() {
  const source = fs.readFileSync(TRUSTED_KEYS, 'utf8');
  const block = source.match(/OFFICIAL_PUBLIC_KEYS[^=]*=\s*\[([\s\S]*?)\]/);
  const keys = block ? [...block[1].matchAll(/'([0-9a-f]{64})'/gi)].map((m) => m[1].toLowerCase()) : [];
  if (keys.length === 0) fail(`Could not read OFFICIAL_PUBLIC_KEYS from ${TRUSTED_KEYS}.`);
  return keys;
}

/** Same digest and key encoding as CatalogSignatureVerifier.ts / verify-catalog-dir.js. */
function verifyCatalogSignature(catalogBytes, sigBytes) {
  if (!sigBytes) return 'no catalog.json.sig';
  let sig;
  try {
    sig = JSON.parse(sigBytes.toString('utf8'));
  } catch {
    return 'catalog.json.sig is not JSON';
  }
  const publicKey = String(sig.publicKey ?? '').toLowerCase();
  if (!officialKeys().includes(publicKey)) return `signed by ${publicKey.slice(0, 16)}…, which is not a pinned official key`;
  const key = crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  const digest = crypto.createHash('sha256').update(catalogBytes).digest();
  return crypto.verify(null, digest, key, Buffer.from(String(sig.signature ?? ''), 'hex'))
    ? null
    : 'signature does not verify against catalog.json';
}

async function stage(flags, bundle) {
  console.log(`Repository: ${flags.repo}`);
  const catalogBytes = await readRepoFile(flags.repo, 'catalog.json');
  if (!catalogBytes) fail(`No catalog.json in ${flags.repo}.`);
  const sigProblem = verifyCatalogSignature(catalogBytes, await readRepoFile(flags.repo, 'catalog.json.sig'));
  if (sigProblem && !flags.allowUnsigned) fail(`Catalog is not officially signed (${sigProblem}). Pass --allow-unsigned to accept it.`);
  console.log(sigProblem ? `Catalog signature: NOT VERIFIED (${sigProblem}) - accepted by --allow-unsigned` : 'Catalog signature: verified (pinned official key)');

  const catalog = JSON.parse(catalogBytes.toString('utf8'));
  const byId = new Map((catalog.modules ?? []).map((m) => [m.module_id, m]));

  fs.rmSync(bundle.stageDir, { recursive: true, force: true });
  fs.mkdirSync(bundle.stageDir, { recursive: true });

  const included = [];
  for (const moduleId of bundle.pack.module_ids) {
    const entry = byId.get(moduleId);
    if (!entry) fail(`Module "${moduleId}" (in starter pack "${bundle.pack.pack_id}") is not in the catalog.`);
    if (entry.language_code && entry.language_code !== bundle.language) {
      console.warn(`  note: ${moduleId} is language "${entry.language_code}"`);
    }
    const relative = String(entry.download_url);
    if (isUrl(relative) || relative.includes('..') || !/\.db\.gz$/i.test(relative)) {
      fail(`Unexpected download_url for ${moduleId}: ${relative}`);
    }
    process.stdout.write(`  ${moduleId.padEnd(28)} `);
    const gz = await readRepoFile(flags.repo, relative);
    if (!gz) fail(`${relative} is missing from the repository.`);
    if (gz.length !== entry.download_size_bytes) {
      fail(`${relative} is ${gz.length} bytes; the catalog says ${entry.download_size_bytes}.`);
    }
    const db = zlib.gunzipSync(gz);
    const sha = crypto.createHash('sha256').update(db).digest('hex');
    if (sha !== String(entry.checksum).toLowerCase()) fail(`${relative} does not match the catalog checksum.`);
    const fileName = path.posix.basename(relative);
    fs.writeFileSync(path.join(bundle.stageDir, fileName), gz);
    included.push({ module_id: moduleId, name: entry.name, version: entry.version, license: entry.license, file: fileName, size: gz.length });
    console.log(`${(gz.length / 1024 / 1024).toFixed(1).padStart(6)} MB  ok`);
  }

  const result = spawnSync(
    process.execPath,
    [BUILD_MODULE_PACK, 'manifest', bundle.stageDir, '--id', bundle.id, '--name', bundle.name, '--version', bundle.version, '--languages', bundle.language],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) fail('build-module-pack.js manifest failed.');

  // A record of what went in, for the download page and release notes. Not
  // part of the bundle (bundle only packs pack.json, its signature and modules).
  const contents = {
    bundle: bundle.id,
    version: bundle.version,
    starter_pack: bundle.pack.pack_id,
    repository: flags.repo,
    catalog_last_updated: catalog.repository?.last_updated ?? null,
    catalog_signature: sigProblem ? `not verified: ${sigProblem}` : 'verified',
    modules: included,
  };
  fs.writeFileSync(path.join(flags.out, `${bundle.id}-${bundle.version}.contents.json`), `${JSON.stringify(contents, null, 2)}\n`);
}

function bundleStage(bundle) {
  if (!fs.existsSync(path.join(bundle.stageDir, 'pack.json'))) fail(`${bundle.stageDir} has no pack.json - run "stage" first.`);
  const result = spawnSync(process.execPath, [BUILD_MODULE_PACK, 'bundle', bundle.stageDir, '--out', bundle.bundlePath], { stdio: 'inherit' });
  if (result.status !== 0) fail('build-module-pack.js bundle failed.');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(bundle.bundlePath)).digest('hex');
  const shaLine = `${sha}  ${path.basename(bundle.bundlePath)}\n`;
  fs.writeFileSync(`${bundle.bundlePath}.sha256`, shaLine);
  console.log(`${path.basename(bundle.bundlePath)}  ${(fs.statSync(bundle.bundlePath).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`SHA-256  ${sha}`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const bundle = resolveBundle(flags);
  fs.mkdirSync(flags.out, { recursive: true });
  if (command === 'stage' || command === 'all') await stage(flags, bundle);
  if (command === 'bundle' || command === 'all') bundleStage(bundle);
  if (command === 'stage') {
    console.log('Next (optional): sign the manifest, then bundle:');
    console.log(`  python scripts/yubikey-sign.py sign-pack ${path.join(bundle.stageDir, 'pack.json')}`);
    console.log(`  node scripts/build-offline-bundle.js bundle --pack ${flags.pack} --out ${flags.out}`);
  }
}

main().catch((error) => fail(error.stack ?? String(error)));
