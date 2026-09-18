#!/usr/bin/env node
/**
 * Compile `bible` to single-file executables with `bun build --compile`.
 *
 *   node scripts/build.js            all four targets
 *   node scripts/build.js --local    just this machine's target
 *   node scripts/build.js --entry=smoke --local   the compile probe
 *
 * Run with Node, not Bun, so that the root `npm run build --workspaces` can
 * invoke it on a machine that has no Bun and get a clear skip rather than a
 * spawn error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(PKG_DIR, 'build');
const EXE = process.platform === 'win32' ? '.exe' : '';

/**
 * Locate the real Bun executable.
 *
 * Deliberately not `shell: true` with a bare `bun`: on Windows that routes
 * through `node_modules/.bin/bun.cmd` and cmd.exe strips the quotes out of
 * `--define __BIBLE_CLI_VERSION__="0.1.0"`, so Bun receives bare `0.1.0` and
 * fails to parse it as JSON. Resolving the binary and spawning it directly
 * keeps argv intact.
 */
function resolveBun() {
  const candidates = [
    join(PKG_DIR, 'node_modules', 'bun', 'bin', `bun${EXE}`),
    join(PKG_DIR, '..', '..', 'node_modules', 'bun', 'bin', `bun${EXE}`),
  ];
  return candidates.find((p) => existsSync(p)) ?? 'bun';
}

const BUN = resolveBun();

/** `bun build --compile --target` value → output filename. */
const TARGETS = [
  { target: 'bun-windows-x64', out: 'bible-windows-x64.exe' },
  { target: 'bun-linux-x64', out: 'bible-linux-x64' },
  { target: 'bun-darwin-arm64', out: 'bible-darwin-arm64' },
  { target: 'bun-darwin-x64', out: 'bible-darwin-x64' },
];

function hostTarget() {
  const { platform, arch } = process;
  if (platform === 'win32') return 'bun-windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'bun-darwin-arm64' : 'bun-darwin-x64';
  if (platform === 'linux') return 'bun-linux-x64';
  return undefined;
}

function bunVersion() {
  const r = spawnSync(BUN, ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const local = argv.includes('--local');
  const entryArg = argv.find((a) => a.startsWith('--entry='));
  const entry = entryArg ? entryArg.slice('--entry='.length) : 'index';

  const version = bunVersion();
  if (!version) {
    // Not a failure. Bun is only needed to produce the executable; every other
    // workspace script (typecheck, tests) runs without it.
    process.stderr.write(
      '@bible/cli: bun not found on PATH — skipping the compile step.\n' +
        '            Install it from https://bun.sh, then re-run `npm run build -w @bible/cli`.\n',
    );
    return 0;
  }

  // The bundle pulls `@bible/core` from its compiled CommonJS output, so that
  // has to exist first. Check rather than fail inside Bun with a resolution
  // error that does not say what is wrong.
  const coreDist = join(PKG_DIR, '..', '..', 'packages', 'core', 'dist', 'index.js');
  if (!existsSync(coreDist)) {
    process.stderr.write(
      '@bible/cli: @bible/core is not built — skipping the compile step.\n' +
        '            Run `npm run build:core` from the repo root first.\n',
    );
    return 0;
  }

  // The bundler resolves `src/assets/bible_kjv.db` statically and fails if it
  // is absent. The file is generated rather than checked in: build it from the
  // repo's `data/modules/bible_kjv.db`. With no module library (CI, a fresh
  // clone) fall back to an empty placeholder, which `firstRun` reports as
  // `no-bundled-module`, so that build runs but ships no Bible.
  const kjvAsset = join(PKG_DIR, 'src', 'assets', 'bible_kjv.db');
  if (!existsSync(kjvAsset) || statSync(kjvAsset).size === 0) {
    const r = spawnSync(BUN, [join(PKG_DIR, 'scripts', 'build-kjv.ts')], {
      cwd: PKG_DIR,
      stdio: 'inherit',
    });
    if (r.status !== 0) {
      writeFileSync(kjvAsset, '');
      process.stderr.write(
        '@bible/cli: could not build the bundled KJV — building with an empty placeholder.\n' +
          '            Put a bible_kjv.db in data/modules and run `npm run kjv -w @bible/cli`.\n',
      );
    }
  }

  const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
  const entryPath = join('src', `${entry}.ts`);
  mkdirSync(OUT_DIR, { recursive: true });

  const host = hostTarget();
  const selected = local ? TARGETS.filter((t) => t.target === host) : TARGETS;

  if (selected.length === 0) {
    process.stderr.write(`@bible/cli: no Bun target for ${process.platform}/${process.arch}\n`);
    return 1;
  }

  process.stdout.write(`@bible/cli: bun ${version}, entry ${entryPath}\n`);

  let failed = 0;
  for (const { target, out } of selected) {
    const outName = entry === 'index' ? out : out.replace(/^bible-/, `${entry}-`);
    const outPath = join(OUT_DIR, outName);

    const args = [
      'build',
      entryPath,
      '--compile',
      '--target',
      target,
      '--outfile',
      outPath,
      '--define',
      `__BIBLE_CLI_VERSION__=${JSON.stringify(pkg.version)}`,
    ];

    process.stdout.write(`  ${target} → build/${outName}\n`);
    const r = spawnSync(BUN, args, { cwd: PKG_DIR, stdio: 'inherit' });
    if (r.status !== 0) {
      failed += 1;
      process.stderr.write(`  FAILED: ${target}\n`);
    }
  }

  return failed === 0 ? 0 : 1;
}

process.exit(main());
