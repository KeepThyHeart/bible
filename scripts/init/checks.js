/* eslint-disable no-console */
/**
 * Self-checks for the pure functions in `catalog.js`.
 *
 * These live here rather than as a Vitest suite because `scripts/` is not an
 * npm workspace, so `npm test` (which runs `--workspaces`) would never reach
 * them.  Run directly:  node scripts/init/checks.js
 *
 * The signature cases matter most: this file's verification has to agree with
 * the desktop's `CatalogSignatureVerifier` exactly, and these sign a real
 * Ed25519 catalog to prove the construction matches rather than merely looks
 * like it.
 */
'use strict';

const { generateKeyPairSync, createHash, sign } = require('crypto');
const { verifyCatalogSignature, isCatalogUsable, parseSelection, resolveCatalogUrl } = require('./catalog');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
}

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
check('numbers and ranges', abbrs(parseSelection('1 3-4', entries)), ['KJV', 'BSB', 'YLT']);
check('commas work too', abbrs(parseSelection('2,4', entries)), ['ASV', 'YLT']);
check('"all"', abbrs(parseSelection('all', entries)), ['KJV', 'ASV', 'BSB', 'YLT']);
check('"recommended"', abbrs(parseSelection('recommended', entries)), ['KJV', 'BSB']);
check('blank cancels', parseSelection('', entries), []);
check('duplicates collapse', abbrs(parseSelection('1 1 1', entries)), ['KJV']);

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

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
