#!/usr/bin/env node
/**
 * Smoke test for `build-module-pack.js`'s `manifest` and `bundle`
 * subcommands.
 *
 * A plain Node script rather than a vitest test: `scripts/` sits outside every
 * package's test project, and this exercises the CLI exactly as a publisher
 * would run it (`execFileSync`, not an in-process function call).
 *
 * Covers:
 *   - `manifest` writes a well-formed pack.json for the `*.db` files present;
 *   - `bundle` produces a `.biblepack` containing pack.json and every module
 *     file, byte-identical to what was on disk;
 *   - `bundle` REFUSES when a file changed after `manifest` ran (a stale
 *     manifest must never be silently bundled).
 *
 * Usage:  node scripts/build-module-pack.test.js
 */

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-module-pack.js');
// `unzipper` is a dependency of apps/desktop (which reads .biblepack archives
// at install time) - reused here to inspect the archive this script builds,
// rather than adding a second zip-reading dependency just for this test.
// Resolved via `require.resolve` from apps/desktop's own package.json rather
// than a hard-coded node_modules path, since npm workspaces may hoist it
// anywhere up the tree.
const UNZIPPER_PATH = require.resolve('unzipper', { paths: [path.join(REPO_ROOT, 'apps', 'desktop')] });

function run(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-module-pack-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`not ok - ${name}`);
    console.error(err.stack || err.message);
  }
}

async function main() {
  await test('manifest writes a well-formed pack.json for the *.db files present', () =>
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'kjv.db'), 'kjv-content');
      fs.writeFileSync(path.join(dir, 'mhc.db.gz'), 'mhc-content');
      fs.writeFileSync(path.join(dir, 'README.md'), 'not a module - must be ignored');

      run(['manifest', dir, '--id', 'en-starter', '--name', 'English starter', '--version', '1.0.0', '--languages', 'en']);

      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
      assert.equal(manifest.format, 'keepthyheart.biblepack/1');
      assert.equal(manifest.pack_id, 'en-starter');
      assert.equal(manifest.languages.length, 1);
      assert.equal(manifest.modules.length, 2);

      const byPath = Object.fromEntries(manifest.modules.map((m) => [m.path, m]));
      assert.equal(byPath['kjv.db'].sha256, sha256Hex(Buffer.from('kjv-content')));
      assert.equal(byPath['kjv.db'].size_bytes, Buffer.from('kjv-content').length);
      assert.ok(!('README.md' in byPath), 'non-module files must not be listed');
    })
  );

  await test('manifest -> bundle round trip: the .biblepack contains pack.json and every module file, unchanged', () =>
    withTempDir(async (dir) => {
      const kjv = Buffer.from('kjv-content');
      const mhc = Buffer.from('mhc-content');
      fs.writeFileSync(path.join(dir, 'kjv.db'), kjv);
      fs.writeFileSync(path.join(dir, 'mhc.db'), mhc);
      run(['manifest', dir, '--id', 'en-starter', '--name', 'English starter', '--version', '1.0.0', '--languages', 'en']);

      const outFile = path.join(dir, 'out.biblepack');
      const output = run(['bundle', dir, '--out', outFile]);
      assert.match(output, /UNSIGNED/, 'no pack.json.sig was written, so bundling must warn it is unsigned');
      assert.ok(fs.existsSync(outFile));

      const { Open } = require(UNZIPPER_PATH);
      const archive = await Open.file(outFile);
      const names = archive.files.map((f) => f.path).sort();
      assert.deepEqual(names, ['kjv.db', 'mhc.db', 'pack.json']);

      const kjvEntry = archive.files.find((f) => f.path === 'kjv.db');
      const extracted = await kjvEntry.buffer();
      assert.deepEqual(extracted, kjv);
    })
  );

  await test('bundle refuses when a file changed after manifest ran, and writes nothing', () =>
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'kjv.db'), 'original-content');
      run(['manifest', dir, '--id', 'en-starter', '--name', 'English starter', '--version', '1.0.0', '--languages', 'en']);

      // Tamper with the file after the manifest was built.
      fs.writeFileSync(path.join(dir, 'kjv.db'), 'CHANGED-content');

      const outFile = path.join(dir, 'out.biblepack');
      assert.throws(() => run(['bundle', dir, '--out', outFile]), /no longer matches pack\.json/);
      assert.ok(!fs.existsSync(outFile), 'a refused bundle must not write a partial archive');
    })
  );

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll build-module-pack.js tests passed.');
}

main();
