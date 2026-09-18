#!/usr/bin/env node
/**
 * Copies non-TypeScript assets from `src/` into `dist/` after `tsc` runs.
 *
 * `tsc` emits only what it compiles, so a `.json` file that nothing imports is
 * invisible to it. `ExtensionManifestSchema.json` is exactly that: it is the
 * canonical authoring schema for `extension.json`, consumed by editors through
 * a `$schema` reference rather than by any code path in this package. Without
 * this step it lived in `src/` and reached nobody outside this repository -
 * which is the one audience it exists for.
 *
 * Kept as a script rather than `cp` in the npm script because this repository
 * is developed on Windows, where `cp -r` is not a command.
 */

const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');

/** Paths are relative to `src/`, and land at the same place under `dist/`. */
const ASSETS = ['Extensions/ExtensionManifestSchema.json'];

let copied = 0;
for (const relative of ASSETS) {
  const from = path.join(packageRoot, 'src', relative);
  const to = path.join(packageRoot, 'dist', relative);
  if (!fs.existsSync(from)) {
    console.error(`copy-assets: missing source asset ${relative}`);
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++;
}

console.log(`copy-assets: copied ${copied} asset(s) into dist/`);
