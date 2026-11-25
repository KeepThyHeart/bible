#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * admin/scripts/set-version.js -- set the release version everywhere it lives.
 *
 *   pnpm run set-version 1.0.0-beta.2   write it to every file below
 *   pnpm run set-version                show the version in each file and
 *                                       exit 1 if they disagree
 *
 * The release workflow (.github/workflows/release.yml) refuses a tag that does
 * not match apps/desktop/package.json, so set the version here, commit, then
 * tag v<version>. Add any new place that records the version to TARGETS.
 *
 * Each file is edited in place with a single targeted replacement, so its
 * formatting is kept. It commits nothing.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

// Semver 2.0 without build metadata (release.yml compares the tag exactly).
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

const PACKAGE_VERSION = /^(\s*"version":\s*")([^"]+)(")/m;

/** Every file that records the release version, and how to find it there. */
const TARGETS = [
  { file: 'package.json', pattern: PACKAGE_VERSION },
  { file: 'apps/desktop/package.json', pattern: PACKAGE_VERSION },
  { file: 'apps/cli/package.json', pattern: PACKAGE_VERSION },
  { file: 'apps/web/package.json', pattern: PACKAGE_VERSION },
  // The fallback for an uncompiled run; the build replaces it with package.json's.
  { file: 'apps/cli/src/version.ts', pattern: /(__BIBLE_CLI_VERSION__ : ')([^']+?)(-dev')/ },
];

function read(target) {
  const full = path.join(ROOT, target.file);
  const text = fs.readFileSync(full, 'utf8');
  const match = text.match(target.pattern);
  if (!match) throw new Error(`${target.file}: no version found (pattern ${target.pattern})`);
  return { full, text, version: match[2] };
}

function main(argv) {
  const wanted = argv[0];
  if (argv.length > 1 || wanted === '--help' || wanted === '-h') {
    console.log('Usage: node admin/scripts/set-version.js [<version>]');
    return argv.length > 1 ? 2 : 0;
  }

  const current = TARGETS.map((t) => ({ ...t, ...read(t) }));

  if (!wanted) {
    for (const t of current) console.log(`${t.version.padEnd(16)} ${t.file}`);
    const distinct = new Set(current.map((t) => t.version));
    if (distinct.size > 1) {
      console.error(`\nVersions disagree: ${[...distinct].join(', ')}`);
      return 1;
    }
    return 0;
  }

  const version = wanted.replace(/^v/, '');
  if (!SEMVER.test(version)) {
    console.error(`Not a semver version: ${wanted} (expected e.g. 1.0.0-beta.2 or 1.0.0)`);
    return 2;
  }

  for (const t of current) {
    if (t.version === version) {
      console.log(`unchanged  ${t.file}`);
      continue;
    }
    fs.writeFileSync(t.full, t.text.replace(t.pattern, `$1${version}$3`));
    console.log(`${t.version} -> ${version}  ${t.file}`);
  }

  console.log(`\nNext: commit, push, wait for CI, then
  git tag -a v${version} -m "${version}" && git push origin v${version}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
