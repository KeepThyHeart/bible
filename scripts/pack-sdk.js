#!/usr/bin/env node
/**
 * Packs the extension-authoring SDK into installable tarballs.
 *
 * `@bible/core` and `@bible/extension-testing` are not on any registry, so a
 * project created outside this repository cannot resolve them by version -
 * `npm install` fails on the first command an author is told to run. Until the
 * packages are published, `npm pack` output is the bridge: a tarball installs
 * with the same resolution, hoisting and lifecycle behaviour as a registry
 * install, which a `file:` link to a workspace directory does not (npm symlinks
 * those, so an author ends up typechecking against `src/` and can silently
 * depend on something `files` would never ship).
 *
 * Output lands in `build/sdk/`, which `create-bible-extension --local-sdk=<dir>`
 * consumes.
 *
 * Usage:  npm run pack:sdk [-- --out=<dir>]
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

/**
 * Built in this order: extension-testing's types resolve against core.
 *
 * `@bible/extension-ui` is here because a panel author has no other way to get
 * it. The panel iframe is served under `script-src 'self' ext-ui://host`, and
 * nothing serves the SDK from that host origin, so the only way a panel can
 * use it is bundled into a file inside the extension package - which means the
 * author has to be able to install it first.
 */
const SDK_PACKAGES = [
  { name: '@bible/core', dir: 'packages/core' },
  { name: '@bible/extension-testing', dir: 'packages/extension-testing' },
  { name: '@bible/extension-ui', dir: 'packages/extension-ui' },
];

function parseOutDir() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--out='));
  return path.resolve(repoRoot, arg ? arg.slice('--out='.length) : 'build/sdk');
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    // npm is a .cmd shim on Windows, which execFile cannot launch directly.
    shell: process.platform === 'win32',
  });
}

function main() {
  const outDir = parseOutDir();
  fs.mkdirSync(outDir, { recursive: true });

  for (const pkg of SDK_PACKAGES) {
    const packageDir = path.join(repoRoot, pkg.dir);

    console.log(`\n=== building ${pkg.name} ===`);
    run('npm', ['run', 'build', '-w', pkg.name], repoRoot);

    // Clear this package's previous tarballs so a stale version cannot be the
    // one `--local-sdk` picks up after a version bump.
    const prefix = `${pkg.name.replace('@', '').replace('/', '-')}-`;
    for (const file of fs.readdirSync(outDir)) {
      if (file.startsWith(prefix) && file.endsWith('.tgz')) {
        fs.rmSync(path.join(outDir, file));
      }
    }

    console.log(`=== packing ${pkg.name} ===`);
    run('npm', ['pack', '--pack-destination', outDir], packageDir);
  }

  const tarballs = fs.readdirSync(outDir).filter((f) => f.endsWith('.tgz')).sort();
  console.log(`\nSDK packed into ${outDir}:`);
  for (const t of tarballs) console.log(`  ${t}`);
  console.log(
    `\nScaffold against it with:\n` +
      `  npx @bible/create-extension my-extension --local-sdk=${path.relative(process.cwd(), outDir).split(path.sep).join('/')}\n`,
  );
}

main();
