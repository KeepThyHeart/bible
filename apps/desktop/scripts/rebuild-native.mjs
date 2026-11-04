#!/usr/bin/env node
/**
 * Make sure the desktop's SQLite driver (better-sqlite3-multiple-ciphers) is built for Electron.
 *
 * `electron-rebuild` without `-f` decides from the `build/Release/.forge-meta` marker, and that
 * marker outlives the binary: `pnpm install` (or `pnpm rebuild`) puts a Node build back next to a
 * marker that still says Electron, so a plain rebuild reports "Rebuild Complete" and leaves the
 * Node build in place. The app then fails at start with NODE_MODULE_VERSION. Instead of trusting
 * the marker, this loads the driver in Electron itself (ELECTRON_RUN_AS_NODE) and rebuilds, forced,
 * only when that fails. `--force` rebuilds regardless.
 *
 * Usage: node scripts/rebuild-native.mjs [--force]
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE = 'better-sqlite3-multiple-ciphers';
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(appDir, 'package.json'));
const force = process.argv.includes('--force');

/** Path to the Electron binary (`require('electron')` from Node returns it). */
function electronBinary() {
  try {
    return require('electron');
  } catch {
    return null;
  }
}

/** Whether the driver opens a database inside Electron's runtime. */
function loadsInElectron(binary) {
  const probe = `new (require(${JSON.stringify(MODULE)}))(':memory:').close()`;
  const result = spawnSync(binary, ['-e', probe], {
    cwd: appDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return result.status === 0;
}

const binary = electronBinary();
if (!force && binary && loadsInElectron(binary)) {
  console.log(`${MODULE} is already built for Electron; nothing to do.`);
  process.exit(0);
}
if (!binary) {
  console.log('The Electron binary is not downloaded yet (pnpm run init:electron); rebuilding without the load check.');
}

const result = spawnSync('pnpm', ['exec', 'electron-rebuild', '--only', MODULE, '-f'], {
  cwd: appDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) process.exit(result.status ?? 1);

if (binary && !loadsInElectron(binary)) {
  console.error(`${MODULE} still does not load in Electron after the rebuild. See "Troubleshooting" in the root README.md.`);
  process.exit(1);
}
