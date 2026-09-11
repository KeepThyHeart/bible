#!/usr/bin/env node

/**
 * stage-extensions.js - Stage the bundled FIRST-PARTY extensions into the
 * extensions root the app scans at startup.
 *
 * `packages/word-count-example` is a real extension package that lives in this
 * repository, but nothing referenced it from a build script, so it never
 * reached a packaged build - and `data/extensions/` was absent from the
 * `extraResources` allowlist in electron-builder.yml, so even a hand-copied
 * folder would not have shipped. This script is the first half of that fix; the
 * matching `extensions/<id>/**` allowlist line in electron-builder.yml is the
 * second.
 *
 * WHERE THE OUTPUT GOES
 * ---------------------
 * Default destination is `apps/desktop/data/extensions/`, which is what
 * `getDataPath()` resolves to in development and what electron-builder.yml
 * copies to `resources/data` at package time. `main.ts` boots the host with
 * `join(getDataPath(), 'extensions')`, and `ExtensionHostDiscovery.loadAll()`
 * scans that directory, so a staged package is picked up as a sideloaded
 * extension and auto-registered with the default permission grant. Staging
 * therefore also makes the extension present in `npm run dev`, which is the
 * cheapest way to notice that a bundled extension has stopped working.
 *
 * `--out=<dir>` retargets it. The curated offline config
 * (electron-builder.curated.yml) ships `build-data/` rather than `data/`, so
 * `npm run package:{win,mac,linux}` stages a second copy into
 * `build-data/extensions/` AFTER `stage-build-data.js` has run - that script
 * deletes and recreates `build-data/` wholesale, so the order matters.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It never wipes the destination root. `data/extensions/` doubles as the
 * per-user install root in a dev tree: everything the developer has sideloaded
 * or installed from a catalog is in there too, alongside each extension's
 * `db/` directory and lifecycle log. Only the directories named in
 * `BUNDLED_EXTENSIONS` below are removed and rewritten.
 *
 * KNOWN LIMITATION (packaged installs, not introduced here)
 * ---------------------------------------------------------
 * The extensions root is derived from `getDataPath()`, which is
 * `process.resourcesPath/data` in a packaged app - read-only for a `.deb`/`.rpm`
 * install, inside the signed bundle on macOS, and a read-only squashfs mount for
 * an AppImage. Discovery only reads, so a bundled extension still loads, but
 * `ExtensionDatabaseRegistry` (which opens `<root>/<id>/db/<name>.db`) and
 * `ExtensionLifecycleLogger` both want to WRITE under that root. A bundled
 * extension that uses `api.storage.openDatabase()` will therefore fail on those
 * platforms until the extensions root is seeded into user-writable storage the
 * way `resolveMainDbPath()` seeds `main.db`. `word-count-example` uses neither,
 * so it is unaffected.
 *
 * Usage:
 *   node scripts/stage-extensions.js
 *   node scripts/stage-extensions.js --out=build-data/extensions
 *
 * Options:
 *   --out=<dir>   Destination extensions root, relative to apps/desktop
 *                 (default: data/extensions).
 */

const fs = require('fs');
const path = require('path');

const DESKTOP = path.resolve(__dirname, '..');
const REPO = path.resolve(DESKTOP, '..', '..');
const PACKAGES = path.join(REPO, 'packages');

/**
 * The bundled set - a DELIBERATE, EXPLICIT list, never a glob over `packages/`.
 *
 * `packages/` also holds `@bible/core`, `@bible/extension-ui`,
 * `@bible/extension-testing` and `create-extension`: libraries and a scaffolder,
 * none of which are extensions. A glob would sweep them into the installer as
 * broken extension directories, and would silently bundle whatever the next
 * package added to `packages/` turns out to be. Adding a line here is the
 * reviewable act, exactly as adding a module to the `extraResources` allowlist
 * in electron-builder.yml is.
 *
 * WHETHER to ship a given extension in v1 is a product decision, not a build
 * one. This list is the mechanism: comment a line out and that extension stops
 * shipping, with no other change needed except dropping the matching
 * `extensions/<id>/**` line from electron-builder.yml's `data` filter.
 *
 * `dir` is the destination directory name. It is free-form as far as the host is
 * concerned - `loadAll()` identifies an extension by the `id` in its
 * `extension.json`, not by the folder - so it is set to the manifest id to make
 * the on-disk layout self-describing and to match what `installExtension()`
 * produces for a user-installed extension.
 */
const BUNDLED_EXTENSIONS = [
  {
    // Reference extension: word count for the current chapter, in the status
    // bar. MIT, deliberately more permissive than the GPL-3.0-or-later
    // repository root, because it is meant to be copied as the starting point
    // for a real extension.
    pkg: 'word-count-example',
    dir: 'ext.bible-app.word-count',
  },
];

/**
 * Files and directories copied out of a bundled package, in that order:
 * `[relativePath, required]`. An allowlist rather than "copy the folder minus
 * node_modules" for the usual reason - a denylist fails open, and what fails
 * open here ends up inside a signed installer.
 *
 * `package.json` is not read by the extension host (the manifest is
 * `extension.json`), but it carries the `smoke` script the README documents and
 * makes the shipped copy a working starting point when a user copies it back
 * out. LICENSE ships because the package's licence differs from the repository
 * root's and must travel with the code.
 */
const PACKAGE_CONTENTS = [
  ['extension.json', true],
  ['src', true],
  ['package.json', false],
  ['LICENSE', false],
  ['README.md', false],
];

/** Never copied, even from inside an allowlisted directory. */
const EXCLUDED_NAMES = new Set(['node_modules', 'dist', '.git', '.DS_Store']);

function parseOutDir(argv) {
  const flag = argv.find((a) => a.startsWith('--out='));
  const rel = flag ? flag.slice('--out='.length) : path.join('data', 'extensions');
  return path.resolve(DESKTOP, rel);
}

function copyEntry(srcAbs, destAbs) {
  fs.cpSync(srcAbs, destAbs, {
    recursive: true,
    filter: (src) => !EXCLUDED_NAMES.has(path.basename(src)),
  });
}

/**
 * Read and minimally check the manifest. This is not the full validator
 * (`ExtensionManifestLoader` in the app is), just enough to fail the build
 * rather than ship a directory the host would log as "manifest invalid" and
 * skip - which is a silent feature loss on a user's machine, discovered only
 * from a log file.
 */
function readManifest(pkgAbs, pkgName) {
  const manifestAbs = path.join(pkgAbs, 'extension.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
  } catch (err) {
    throw new Error(`${pkgName}: could not read ${manifestAbs}: ${err.message}`);
  }
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    throw new Error(`${pkgName}: extension.json has no "id"`);
  }
  if (typeof manifest.main !== 'string' || manifest.main.length === 0) {
    throw new Error(`${pkgName}: extension.json has no "main"`);
  }
  return manifest;
}

function main() {
  const outRoot = parseOutDir(process.argv.slice(2));
  console.log('Staging bundled first-party extensions ->', outRoot);

  fs.mkdirSync(outRoot, { recursive: true });

  for (const entry of BUNDLED_EXTENSIONS) {
    const pkgAbs = path.join(PACKAGES, entry.pkg);
    if (!fs.existsSync(pkgAbs)) {
      throw new Error(`Missing bundled extension package: ${pkgAbs}`);
    }

    const manifest = readManifest(pkgAbs, entry.pkg);
    if (manifest.id !== entry.dir) {
      // Not fatal - the host keys off the manifest id, not the folder - but it
      // means this list has drifted from the manifest, and the same mismatch in
      // electron-builder.yml's per-extension allowlist line WOULD be fatal
      // (the pattern names the directory).
      console.warn(
        `  [WARN] ${entry.pkg}: manifest id "${manifest.id}" != staged directory "${entry.dir}".`,
      );
      console.warn(
        '  [WARN] Check the matching extensions/<dir>/** line in electron-builder.yml.',
      );
    }

    // Replace only this extension's directory. See the header: the destination
    // root also holds the developer's own sideloaded extensions and every
    // extension's db/ and log files.
    const destAbs = path.join(outRoot, entry.dir);
    fs.rmSync(destAbs, { recursive: true, force: true });
    fs.mkdirSync(destAbs, { recursive: true });

    for (const [rel, required] of PACKAGE_CONTENTS) {
      const srcAbs = path.join(pkgAbs, rel);
      if (!fs.existsSync(srcAbs)) {
        if (required) throw new Error(`${entry.pkg}: missing required ${rel}`);
        console.log(`    (skip, absent) ${rel}`);
        continue;
      }
      copyEntry(srcAbs, path.join(destAbs, rel));
      console.log(`    ${rel}`);
    }

    // The manifest's entry point has to exist in the STAGED copy, not just in
    // the source package: an entry point outside PACKAGE_CONTENTS above copies
    // cleanly and then fails at activation time on the user's machine.
    const mainAbs = path.join(destAbs, manifest.main);
    if (!fs.existsSync(mainAbs)) {
      throw new Error(
        `${entry.pkg}: manifest main "${manifest.main}" was not staged. ` +
          'Add the file (or its directory) to PACKAGE_CONTENTS in this script.',
      );
    }

    console.log(`  ${manifest.id} v${manifest.version ?? '?'} -> ${entry.dir}`);
  }

  console.log('Done. Bundled extensions staged.');
}

try {
  main();
} catch (err) {
  console.error('Extension staging failed:', err.message);
  process.exit(1);
}
