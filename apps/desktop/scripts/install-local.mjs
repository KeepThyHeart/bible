#!/usr/bin/env node
/**
 * Install the desktop app from this checkout as a real, packaged app — no
 * installer — and update it in place by running the same command again.
 *
 * WHY
 * ---
 * `pnpm run dev` runs the app from the source tree under the Vite dev server:
 * no asar, no `process.resourcesPath`, no unpacked native modules, data in the
 * checkout. Bugs that live in exactly those places only show up in a packaged
 * build, and building a full installer (NSIS/AppImage/deb) every time is slow.
 * `electron-builder --dir` does all of the packaging and stops before the
 * installer step, which is where most of the time goes. This script builds
 * that folder and copies it into a per-user location with a launcher.
 *
 * DEV IDENTITY
 * ------------
 * By default the install is branded "<product> (Dev)" with appId
 * "<appId>.dev", via the BIBLE_PRODUCT_NAME / BIBLE_APP_ID variables that
 * electron.vite.config.ts (build-time defines) and electron-builder.branding.cjs
 * already read, plus `productName` written into the packaged package.json
 * (see the electron-builder call below), from which Electron derives the
 * userData directory. So the dev install gets its OWN profile, shortcut,
 * install directory and Windows AUMID, and cannot touch `pnpm run dev`'s
 * profile or a release installed on the same machine.
 * Set either variable yourself to override it; installing under the official
 * identity is refused (use a real installer for that).
 *
 * WHERE IT GOES
 * -------------
 *   Linux:   ~/.local/opt/<name>/                       the app
 *            ~/.local/bin/<name>                        symlink to the binary
 *            ~/.local/share/applications/<name>.desktop launcher
 *            ~/.local/share/icons/hicolor/512x512/apps/<name>.png
 *   Windows: %LOCALAPPDATA%\Programs\<Product Name>\    the app
 *            Start Menu\Programs\<Product Name>.lnk     shortcut
 * User data (~/.config/<Product Name>, %APPDATA%\<Product Name>) is never
 * touched, by install, update or uninstall.
 *
 * Usage (from the repo root):
 *   pnpm run install:local [--profile=code-only|lean|curated] [--skip-build]
 *   pnpm run uninstall:local
 *
 *   --profile     Which electron-builder config to package with. Default
 *                 `code-only`: the app plus main.db, buildable from any
 *                 checkout that has run `pnpm run setup`. `lean` and `curated`
 *                 bundle content modules and need the developer data assets.
 *   --skip-build  Re-package the existing `out/` without running the Vite build.
 *                 Only safe if the last build used the same identity.
 *   --uninstall   Remove the install (same as `uninstall:local`).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Keep in sync with electron-builder.branding.cjs.
const OFFICIAL_PRODUCT_NAME = 'Keep Thy Heart Bible Reader';
const OFFICIAL_APP_ID = 'com.keepthyheart.bible.desktop';

// `freshRegistry`: the config bundles `data/main.db` straight from the checkout.
// On CI that is a clean template, but on a developer machine it is the live
// registry listing every module the developer has, so the packaged app thinks
// modules are installed that it does not ship, never downloads them, and fails
// to open them. For those profiles a template main.db is generated and swapped
// in (curated needs nothing: stage-build-data already empties the registry).
const PROFILES = {
  'code-only': { config: 'electron-builder.code-only.yml', prep: [], freshRegistry: true },
  lean: { config: 'electron-builder.yml', prep: [['stage-extensions']], freshRegistry: true },
  curated: {
    config: 'electron-builder.curated.yml',
    prep: [['stage-build-data'], ['stage-extensions', '--out=build-data/extensions']],
    freshRegistry: false,
  },
};
const workDir = path.join(appDir, 'dist', '.install-local');

// --- arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const uninstall = flag('uninstall');
const skipBuild = flag('skip-build');
const profileName = option('profile', 'code-only');
const profile = PROFILES[profileName];
if (!profile) fail(`Unknown --profile=${profileName}. Use one of: ${Object.keys(PROFILES).join(', ')}.`);

const platform = process.platform;
if (platform !== 'linux' && platform !== 'win32') {
  fail(`install:local supports Linux and Windows only (this is ${platform}).`);
}

// --- identity ------------------------------------------------------------------

const envStr = (name) => process.env[name]?.trim() || undefined;
const productName = envStr('BIBLE_PRODUCT_NAME') || `${OFFICIAL_PRODUCT_NAME} (Dev)`;
const appId = envStr('BIBLE_APP_ID') || `${OFFICIAL_APP_ID}.dev`;
if (productName === OFFICIAL_PRODUCT_NAME || appId === OFFICIAL_APP_ID) {
  fail(
    'Refusing to install under the official product name or appId: it would share the\n' +
      "release build's user data (and on Windows its install directory). Unset\n" +
      'BIBLE_PRODUCT_NAME / BIBLE_APP_ID to use the dev identity, or pick other values.'
  );
}
/** Same derivation as linuxName() in electron-builder.branding.cjs. */
const linuxName = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bible';

const home = os.homedir();
const paths =
  platform === 'linux'
    ? {
        installDir: path.join(home, '.local', 'opt', linuxName),
        executable: path.join(home, '.local', 'opt', linuxName, linuxName),
        unpacked: path.join(appDir, 'dist', 'linux-unpacked'),
        binLink: path.join(home, '.local', 'bin', linuxName),
        desktopFile: path.join(home, '.local', 'share', 'applications', `${linuxName}.desktop`),
        iconFile: path.join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', `${linuxName}.png`),
        userData: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), productName),
      }
    : (() => {
        const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        const installDir = path.join(localAppData, 'Programs', productName);
        return {
          installDir,
          executable: path.join(installDir, `${productName}.exe`),
          unpacked: path.join(appDir, 'dist', 'win-unpacked'),
          shortcut: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${productName}.lnk`),
          userData: path.join(appData, productName),
        };
      })();

// --- main ----------------------------------------------------------------------

assertNotRunning();

if (uninstall) {
  removeInstall();
  log(`Uninstalled ${productName}.`);
  log(`User data was left in place: ${paths.userData}`);
  process.exit(0);
}

log(`Installing ${productName} (${appId}) with the ${profileName} profile`);
const env = { ...process.env, BIBLE_PRODUCT_NAME: productName, BIBLE_APP_ID: appId };

if (!skipBuild) {
  step('Building the app');
  run('pnpm', ['run', 'build'], env);
}
for (const [script, ...scriptArgs] of profile.prep) {
  step(`Running ${script}`);
  run('pnpm', ['run', script, ...scriptArgs], env);
}

let builderConfig = profile.config;
if (profile.freshRegistry) {
  step('Generating a template main.db (no modules registered)');
  builderConfig = configWithFreshRegistry(profile.config);
}

step('Packaging (electron-builder --dir)');
fs.rmSync(paths.unpacked, { recursive: true, force: true });
// electron-builder does NOT copy `productName` into the packaged package.json,
// so Electron names the app after the npm package ("@bible/desktop") and puts
// userData in ~/.config/@bible/desktop: the SAME profile `pnpm run dev` uses.
// Writing productName into the packaged metadata gives the dev install its own.
run(
  'pnpm',
  [
    'exec',
    'electron-builder',
    platform === 'linux' ? '--linux' : '--win',
    '--dir',
    '--config',
    builderConfig,
    '--publish',
    'never',
    `-c.extraMetadata.productName=${productName}`,
  ],
  env
);
if (!fs.existsSync(paths.executable.replace(paths.installDir, paths.unpacked))) {
  fail(`electron-builder finished but ${paths.unpacked} has no ${path.basename(paths.executable)}.`);
}

step(`Copying to ${paths.installDir}`);
replaceDir(paths.unpacked, paths.installDir);

if (platform === 'linux') integrateLinux();
else integrateWindows();

log('');
log(`Installed ${productName}.`);
log(`  App:       ${paths.installDir}`);
log(`  User data: ${paths.userData}`);
if (platform === 'linux') {
  log(`  Launch:    from your app menu, or \`${linuxName}\` (pass --inspect=9229 / --remote-debugging-port=9222 to debug)`);
  if (!(process.env.PATH || '').split(path.delimiter).includes(path.dirname(paths.binLink))) {
    log(`  Note:      ${path.dirname(paths.binLink)} is not on your PATH.`);
  }
  warnIfSandboxBlocked();
} else {
  log(`  Launch:    from the Start Menu, or "${paths.executable}"`);
}
log('Run the same command again to update in place.');

/**
 * Generate an empty-registry main.db under dist/ (never touching data/main.db)
 * and write a copy of the profile's config that bundles it instead.
 */
function configWithFreshRegistry(configFile) {
  const templateDir = path.join(workDir, 'data');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(templateDir, { recursive: true });
  const repoRoot = path.join(appDir, '..', '..');
  run('node', [
    path.join(repoRoot, 'scripts', 'init', 'index.js'),
    '--target=desktop',
    '--no-modules',
    '--no-link',
    '--quiet',
    `--data-dir=${templateDir}`,
    `--modules-dir=${templateDir}`,
  ]);

  const config = loadYaml(path.join(appDir, configFile));
  // Relative `file:` extends would resolve against the generated file's folder.
  if (typeof config.extends === 'string' && config.extends.startsWith('file:')) {
    config.extends = `file:${path.join(appDir, config.extends.slice('file:'.length))}`;
  }
  let replaced = false;
  config.extraResources = (config.extraResources || []).flatMap((entry) => {
    if (typeof entry !== 'object' || entry.from !== 'data' || !entry.filter?.includes('main.db')) return [entry];
    replaced = true;
    const filter = entry.filter.filter((pattern) => pattern !== 'main.db');
    // Drop the entry outright when main.db was all it copied: an empty filter
    // would make electron-builder copy the whole (multi-GB) data/ directory.
    return filter.some((pattern) => !pattern.startsWith('!')) ? [{ ...entry, filter }] : [];
  });
  if (!replaced) fail(`${configFile} no longer bundles data/main.db the way this script expects; update configWithFreshRegistry().`);
  config.extraResources.push({ from: path.join(templateDir, 'main.db'), to: 'data/main.db' });

  const generated = path.join(workDir, `${path.basename(configFile, '.yml')}.json`);
  fs.writeFileSync(generated, JSON.stringify(config, null, 2));
  return generated;
}

/** js-yaml, resolved through electron-builder (which depends on it). */
function loadYaml(file) {
  const fromApp = createRequire(path.join(appDir, 'package.json'));
  const builderLib = path.dirname(
    createRequire(fromApp.resolve('electron-builder')).resolve('app-builder-lib/package.json')
  );
  const yaml = createRequire(path.join(builderLib, 'package.json'))('js-yaml');
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

// --- platform integration ---------------------------------------------------------

function integrateLinux() {
  step('Adding launcher, icon and PATH symlink');
  fs.mkdirSync(path.dirname(paths.iconFile), { recursive: true });
  fs.copyFileSync(path.join(appDir, 'resources', 'icon.png'), paths.iconFile);

  fs.mkdirSync(path.dirname(paths.binLink), { recursive: true });
  fs.rmSync(paths.binLink, { force: true });
  fs.symlinkSync(paths.executable, paths.binLink);

  // Without desktopName in package.json, Electron uses the app name (the
  // productName electron-builder writes into the packaged package.json) as
  // WM_CLASS, so that is what StartupWMClass must match.
  const desktopEntry = [
    '[Desktop Entry]',
    `Name=${productName}`,
    'Comment=Development build installed from a source checkout',
    `Exec="${paths.executable}" %U`,
    `Icon=${linuxName}`,
    'Type=Application',
    'Terminal=false',
    'Categories=Education;',
    `StartupWMClass=${productName}`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(paths.desktopFile), { recursive: true });
  fs.writeFileSync(paths.desktopFile, desktopEntry);

  // Best effort: refresh the menu/icon caches where the tools exist.
  spawnSync('update-desktop-database', [path.dirname(paths.desktopFile)], { stdio: 'ignore' });
  spawnSync('gtk-update-icon-cache', ['-q', '-t', path.join(home, '.local', 'share', 'icons', 'hicolor')], { stdio: 'ignore' });
}

function integrateWindows() {
  step('Adding Start Menu shortcut');
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:KTH_LNK)',
    '$s.TargetPath = $env:KTH_EXE',
    '$s.WorkingDirectory = $env:KTH_DIR',
    '$s.IconLocation = "$($env:KTH_EXE),0"',
    '$s.Save()',
  ].join('; ');
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    ...process.env,
    KTH_LNK: paths.shortcut,
    KTH_EXE: paths.executable,
    KTH_DIR: paths.installDir,
  });
}

/**
 * The unpacked chrome-sandbox helper is not setuid root (a deb's postinst does
 * that), so Electron needs unprivileged user namespaces instead. Ubuntu 24.04+
 * restricts them through AppArmor, and the app then aborts at start.
 */
function warnIfSandboxBlocked() {
  const readFlag = (file) => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  };
  const blocked =
    readFlag('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' ||
    readFlag('/proc/sys/kernel/unprivileged_userns_clone') === '0';
  if (!blocked) return;
  const sandbox = path.join(paths.installDir, 'chrome-sandbox');
  log('');
  log('  Warning: this system restricts unprivileged user namespaces, so the app will');
  log("  likely fail to start with a sandbox error. Make Electron's sandbox helper setuid");
  log('  (needed again after each update):');
  log(`    sudo chown root:root "${sandbox}" && sudo chmod 4755 "${sandbox}"`);
}

// --- helpers ---------------------------------------------------------------------

/**
 * Swap the new build in with renames, so a failed copy leaves the previous
 * install intact rather than half-overwritten.
 */
function replaceDir(from, to) {
  const staging = `${to}.new`;
  const previous = `${to}.old`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, staging, { recursive: true, verbatimSymlinks: true });
  if (fs.existsSync(to)) fs.renameSync(to, previous);
  fs.renameSync(staging, to);
  fs.rmSync(previous, { recursive: true, force: true });
}

function removeInstall() {
  const targets =
    platform === 'linux'
      ? [paths.installDir, paths.binLink, paths.desktopFile, paths.iconFile]
      : [paths.installDir, paths.shortcut];
  for (const target of targets) {
    if (fs.existsSync(target) || isDanglingLink(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      log(`  removed ${target}`);
    }
  }
  if (platform === 'linux') {
    spawnSync('update-desktop-database', [path.dirname(paths.desktopFile)], { stdio: 'ignore' });
  }
}

function isDanglingLink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Replacing files under a running app breaks it (and Windows locks them). */
function assertNotRunning() {
  if (!fs.existsSync(paths.executable)) return;
  let running = false;
  if (platform === 'linux') {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        if (fs.readlinkSync(`/proc/${pid}/exe`).startsWith(paths.installDir + path.sep)) {
          running = true;
          break;
        }
      } catch {
        // process gone or not ours
      }
    }
  } else {
    const result = spawnSync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${path.basename(paths.executable)}`, '/NH', '/FO', 'CSV'],
      { encoding: 'utf8' }
    );
    running = (result.stdout || '').toLowerCase().includes(path.basename(paths.executable).toLowerCase());
  }
  if (running) fail(`${productName} is running from ${paths.installDir}. Quit it (including the tray icon) and try again.`);
}

function run(command, commandArgs, runEnv = process.env) {
  const result = spawnSync(command, commandArgs, {
    cwd: appDir,
    env: runEnv,
    stdio: 'inherit',
    // pnpm is a .cmd shim on Windows, which spawn cannot start without a shell.
    shell: platform === 'win32' && command === 'pnpm',
  });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} exited with code ${result.status}.`);
}

function step(message) {
  log(`\n==> ${message}`);
}

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`install:local: ${message}`);
  process.exit(1);
}
