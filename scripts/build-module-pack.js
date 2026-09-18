#!/usr/bin/env node
/**
 * Builds a signed (or unsigned) `.biblepack` from a directory of `*.db`/
 * `*.db.gz` module files - the offline counterpart to a catalog's online
 * starter pack (see `packages/core/src/Data/Core/StarterPackTypes.ts` and
 * `apps/desktop/electron/services/ModulePackSignature.ts`, which is the format
 * this produces and the app's own verification logic).
 *
 * Two subcommands, meant to run in this order:
 *
 *   node scripts/build-module-pack.js manifest <dir> \
 *     --id en-starter --name "English starter" --version 1.0.0 --languages en
 *
 *   python scripts/yubikey-sign.py sign-pack <dir>/pack.json   # optional
 *
 *   node scripts/build-module-pack.js bundle <dir> --out en-starter.biblepack
 *
 * `manifest` writes `<dir>/pack.json` listing every `*.db`/`*.db.gz` file
 * directly inside `<dir>`, with its exact size and SHA-256. Signing (with
 * `yubikey-sign.py sign-pack`) is a separate, optional step so a pack can ship
 * unsigned (the app still installs it, after an explicit "install anyway?").
 *
 * `bundle` re-hashes the files in `<dir>` and refuses to build anything if
 * they no longer match `pack.json` (the manifest is stale - re-run `manifest`
 * and re-sign). It warns, but proceeds, when there is no `pack.json.sig`. The
 * output zip contains exactly `pack.json`, `pack.json.sig` (if present), and
 * the module files - nothing else from `<dir>` is included.
 *
 * The zip writer (`scripts/lib/createZip.js`) is a small, dependency-free
 * port of `packages/extension-testing`'s internal `createZip` (the same
 * algorithm `bible-ext package` uses) - not an import of it. That package
 * has no `prepare`/`postinstall` step, so its `dist/` does not exist right
 * after a fresh `npm install`; a build tool under `scripts/` has to work
 * without depending on another package having been built first. See
 * `scripts/lib/createZip.js`'s own doc comment for the details.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Mirror `PACK_MANIFEST_FORMAT` in `ModulePackSignature.ts` - keep in sync.
const PACK_MANIFEST_FORMAT = 'keepthyheart.biblepack/1';
const PACK_MANIFEST_FILENAME = 'pack.json';
const PACK_SIGNATURE_FILENAME = 'pack.json.sig';
const MODULE_FILE_RE = /\.db(\.gz)?$/i;

function usageAndExit(message) {
  if (message) console.error(`build-module-pack: ${message}\n`);
  console.error(
    [
      'Usage:',
      '  node scripts/build-module-pack.js manifest <dir> --id <id> --name <name> --version <v> --languages en[,es]',
      '  node scripts/build-module-pack.js bundle <dir> --out <file.biblepack>',
    ].join('\n')
  );
  process.exit(message ? 1 : 0);
}

/** Very small `--flag value` parser - this script has no other argument shapes. */
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        usageAndExit(`--${key} needs a value`);
      }
      flags[key] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/** `*.db`/`*.db.gz` files directly inside `dir`, sorted for reproducible output. */
function listModuleFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MODULE_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readManifest(dir) {
  const manifestPath = path.join(dir, PACK_MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    usageAndExit(`${manifestPath} not found - run the "manifest" subcommand first.`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    usageAndExit(`${manifestPath} is not valid JSON: ${err.message}`);
  }
  if (manifest.format !== PACK_MANIFEST_FORMAT) {
    usageAndExit(`${manifestPath} has format "${manifest.format}", expected "${PACK_MANIFEST_FORMAT}".`);
  }
  return manifest;
}

function cmdManifest(dir, flags) {
  for (const required of ['id', 'name', 'version', 'languages']) {
    if (!flags[required]) usageAndExit(`--${required} is required for "manifest".`);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    usageAndExit(`${dir} is not a directory.`);
  }

  const fileNames = listModuleFiles(dir);
  if (fileNames.length === 0) {
    usageAndExit(`No *.db/*.db.gz files found directly inside ${dir}.`);
  }

  const modules = fileNames.map((name) => {
    const data = fs.readFileSync(path.join(dir, name));
    return { path: name, sha256: sha256Hex(data), size_bytes: data.length };
  });

  const manifest = {
    format: PACK_MANIFEST_FORMAT,
    pack_id: flags.id,
    name: flags.name,
    version: flags.version,
    languages: flags.languages.split(',').map((tag) => tag.trim()).filter(Boolean),
    created: new Date().toISOString(),
    modules,
  };

  const manifestPath = path.join(dir, PACK_MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifestPath} (${modules.length} module file(s)).`);
  console.log('Next: sign it (optional) with:');
  console.log(`  python scripts/yubikey-sign.py sign-pack ${manifestPath}`);
  console.log('Then bundle:');
  console.log(`  node scripts/build-module-pack.js bundle ${dir} --out <name>.biblepack`);
}

function cmdBundle(dir, flags) {
  if (!flags.out) usageAndExit('--out is required for "bundle".');
  const manifest = readManifest(dir);

  // Re-hash every file the manifest lists against what is on disk NOW - a
  // manifest that no longer matches the files must not be silently bundled;
  // that is exactly the drift `ModulePackSignature`'s manifest cross-check
  // exists to catch on the install side, and it is cheaper to refuse here.
  for (const entry of manifest.modules) {
    const filePath = path.join(dir, entry.path);
    if (!fs.existsSync(filePath)) {
      usageAndExit(`pack.json lists "${entry.path}", which is missing from ${dir}. Re-run "manifest".`);
    }
    const data = fs.readFileSync(filePath);
    if (data.length !== entry.size_bytes || sha256Hex(data) !== entry.sha256.toLowerCase()) {
      usageAndExit(`"${entry.path}" no longer matches pack.json (it changed since "manifest" was run). Re-run "manifest" and re-sign.`);
    }
  }

  const signaturePath = path.join(dir, PACK_SIGNATURE_FILENAME);
  const hasSignature = fs.existsSync(signaturePath);
  if (!hasSignature) {
    console.warn(
      `Warning: no ${PACK_SIGNATURE_FILENAME} next to pack.json - building an UNSIGNED pack. ` +
        'The app will ask the user to confirm before installing it.'
    );
  }

  const { createZip } = require('./lib/createZip');

  const entries = [
    { path: PACK_MANIFEST_FILENAME, content: fs.readFileSync(path.join(dir, PACK_MANIFEST_FILENAME)) },
  ];
  if (hasSignature) {
    entries.push({ path: PACK_SIGNATURE_FILENAME, content: fs.readFileSync(signaturePath) });
  }
  for (const entry of manifest.modules) {
    entries.push({ path: entry.path, content: fs.readFileSync(path.join(dir, entry.path)) });
  }

  const archive = createZip(entries);
  fs.writeFileSync(flags.out, archive);
  console.log(
    `Wrote ${flags.out} (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, ` +
      `${hasSignature ? 'signed' : 'UNSIGNED'}).`
  );
}

function main() {
  const [command, dir, ...rest] = process.argv.slice(2);
  if (!command || !dir) usageAndExit();
  const { flags } = parseFlags(rest);

  if (command === 'manifest') return cmdManifest(dir, flags);
  if (command === 'bundle') return cmdBundle(dir, flags);
  usageAndExit(`Unknown subcommand "${command}".`);
}

main();
