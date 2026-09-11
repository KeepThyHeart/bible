/* eslint-disable no-console */
/**
 * Self-checks for the pure functions in `catalog.js` and `index.js`.
 *
 * These live here rather than as a Vitest suite because `scripts/` is not an
 * npm workspace, so `npm test` (which runs `--workspaces`) would never reach
 * them.  Run directly:  node scripts/init/checks.js
 *
 * The signature cases matter most: this file's verification has to agree with
 * the desktop's `CatalogSignatureVerifier` exactly, and these sign a real
 * Ed25519 catalog to prove the construction matches rather than merely looks
 * like it.
 *
 * Nothing here touches the network or the repository's `data/`: the link and
 * download cases work in a throwaway directory under the OS temp dir.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateKeyPairSync, createHash, sign } = require('crypto');
const {
  verifyCatalogSignature, isCatalogUsable, parseSelection, selectByName, downloadModule, resolveCatalogUrl,
} = require('./catalog');
const { linkSharedModules, chooseDefaultBible, nodeVersionProblem } = require('./index');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
}

const silent = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

// A publisher's keypair, and a catalog signed the way the format specifies:
// Ed25519 over the SHA-256 digest of the exact catalog bytes.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

const catalogBytes = Buffer.from(JSON.stringify({ repository: { name: 'Dev' }, modules: [] }), 'utf8');
const digest = createHash('sha256').update(catalogBytes).digest();
const signature = sign(null, digest, privateKey).toString('hex');
const sigDoc = (over) => JSON.stringify({ publicKey: over ?? rawPublic, signature, algorithm: 'ed25519-sha256' });

check('a correctly signed catalog verifies',
  verifyCatalogSignature(catalogBytes, sigDoc()).status, 'verified');

check('tampered catalog bytes are rejected',
  verifyCatalogSignature(Buffer.concat([catalogBytes, Buffer.from(' ')]), sigDoc()).status, 'invalid');

const otherKey = generateKeyPairSync('ed25519').publicKey
  .export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
check('a signature from an unpinned key is untrusted',
  verifyCatalogSignature(catalogBytes, sigDoc(), { expectedPublicKey: otherKey }).status, 'untrusted_key');

check('the pinned key accepts its own signature',
  verifyCatalogSignature(catalogBytes, sigDoc(), { expectedPublicKey: rawPublic }).status, 'verified');

check('no .sig served is "unsigned"', verifyCatalogSignature(catalogBytes, null).status, 'unsigned');
check('malformed signature JSON is an error', verifyCatalogSignature(catalogBytes, '{oops').status, 'error');
check('wrong algorithm is an error',
  verifyCatalogSignature(catalogBytes, JSON.stringify({ publicKey: rawPublic, signature, algorithm: 'rsa' })).status, 'error');
check('a short public key is an error',
  verifyCatalogSignature(catalogBytes, JSON.stringify({ publicKey: 'abcd', signature, algorithm: 'ed25519-sha256' })).status, 'error');

check('verified is usable', isCatalogUsable({ status: 'verified' }), true);
check('unsigned is usable', isCatalogUsable({ status: 'unsigned' }), true);
check('invalid is NOT usable', isCatalogUsable({ status: 'invalid' }), false);
check('untrusted_key is NOT usable', isCatalogUsable({ status: 'untrusted_key' }), false);

check('a directory URL gains /catalog.json',
  resolveCatalogUrl('https://example.org/'), 'https://example.org/catalog.json');
check('an explicit .json URL is left alone',
  resolveCatalogUrl('https://example.org/a.json'), 'https://example.org/a.json');

const entries = [
  { abbreviation: 'KJV', recommended: true },
  { abbreviation: 'ASV', recommended: false },
  { abbreviation: 'BSB', recommended: true },
  { abbreviation: 'YLT', recommended: false },
];
const abbrs = (list) => list.map((e) => e.abbreviation);
const picked = (answer, presets) => abbrs(parseSelection(answer, entries, presets).picked);
check('numbers and ranges', picked('1 3-4'), ['KJV', 'BSB', 'YLT']);
check('commas work too', picked('2,4'), ['ASV', 'YLT']);
check('"all"', picked('all'), ['KJV', 'ASV', 'BSB', 'YLT']);
check('"recommended"', picked('recommended'), ['KJV', 'BSB']);
check('blank cancels', picked(''), []);
check('duplicates collapse', picked('1 1 1'), ['KJV']);

try {
  parseSelection('99', entries);
  check('out-of-range is refused', 'no error', 'an error');
} catch (err) {
  check('out-of-range is refused', err.message.includes('no module 99'), true);
}
try {
  parseSelection('kjv', entries);
  check('garbage is refused', 'no error', 'an error');
} catch (err) {
  check('garbage is refused', err.message.includes('Not a selection'), true);
}

// Presets.  `starter` names a module (NASB) this catalog does not carry, which
// must cost a warning, not the whole install.
const presets = { starter: ['YLT', 'KJV', 'NASB'] };
const byName = selectByName(['Starter', 'ASV', 'kjv'], entries, presets);
check('--select expands a preset, keeps the order named, and drops repeats',
  abbrs(byName.picked), ['YLT', 'KJV', 'ASV']);
check('--select reports preset members the catalog lacks, without failing',
  { unknown: byName.unknown, unavailable: byName.unavailable }, { unknown: [], unavailable: ['NASB'] });
check('--select still refuses an explicit name the catalog lacks',
  selectByName(['starter', 'NASB2'], entries, presets).unknown, ['NASB2']);
const prompted = parseSelection('starter 2', entries, presets);
check('the prompt takes a preset mixed with numbers, in catalog order',
  { picked: abbrs(prompted.picked), unavailable: prompted.unavailable },
  { picked: ['KJV', 'ASV', 'YLT'], unavailable: ['NASB'] });

// The default Bible a generated site-config.json names.
const mod = (abbreviation, moduleType) => ({ info: { abbreviation, module_type: moduleType } });
check('the default Bible is KJV when it is installed',
  chooseDefaultBible([mod('Barnes', 'commentary'), mod('ASV', 'bible'), mod('KJV', 'bible')]), 'KJV');
check('otherwise the first installed Bible',
  chooseDefaultBible([mod('Barnes', 'commentary'), mod('ASV', 'bible'), mod('YLT', 'bible')]), 'ASV');
check('and none when no Bible is installed', chooseDefaultBible([mod('Barnes', 'commentary')]), null);

check('Node 20.19 is new enough', nodeVersionProblem('20.19.0'), null);
check('Node 20.18 is not', nodeVersionProblem('20.18.1') !== null, true);
check('Node 22 is', nodeVersionProblem('22.0.0'), null);

async function checkOnDisk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-init-checks-'));
  const shared = path.join(root, 'data', 'modules');
  const link = path.join(root, 'apps', 'desktop', 'data', 'modules');
  try {
    // A junction on Windows, a relative symlink elsewhere; either way the
    // desktop side must see files written to the shared side.
    check('the desktop modules directory is linked to the shared store',
      linkSharedModules(link, shared, silent), 'linked');
    fs.writeFileSync(path.join(shared, 'probe.db'), 'x');
    check('a file in the shared store is visible through the link',
      fs.existsSync(path.join(link, 'probe.db')), true);
    check('re-running leaves a correct link alone', linkSharedModules(link, shared, silent), 'already-linked');

    fs.unlinkSync(link);
    fs.mkdirSync(link);
    fs.writeFileSync(path.join(link, 'own.db'), 'x');
    check('a directory holding its own files is never replaced',
      linkSharedModules(link, shared, silent), 'own-copy');
    check('...and its files are untouched', fs.existsSync(path.join(link, 'own.db')), true);

    // A module whose file already matches the catalog checksum is not fetched:
    // the URL below does not resolve, so reaching the network would throw.
    const modules = path.join(root, 'skip');
    fs.mkdirSync(modules);
    const bytes = Buffer.from('already here');
    fs.writeFileSync(path.join(modules, 'bible_test.db'), bytes);
    const entry = {
      abbreviation: 'TEST',
      download_url: 'bible/bible_test.db.gz',
      checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    };
    const result = await downloadModule(entry, modules, 'https://catalog.invalid/catalog.json', silent);
    check('a module already matching its checksum is skipped, not downloaded', result.skipped, true);
  } finally {
    // Remove the link itself first, so the recursive delete below cannot
    // follow it into the shared directory.
    if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

checkOnDisk().then(() => {
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
});
