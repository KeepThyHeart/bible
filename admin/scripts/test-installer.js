#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * admin/scripts/test-installer.js -- check that a desktop installer works.
 *
 * It installs the installer somewhere harmless, starts what it installed, and
 * checks that it works.
 *
 * Given a file the release build produced (or a download of one), it:
 *
 *   inspect     reads the file: size, SHA-256, and what the platform says of
 *               its signature (Authenticode, codesign) or package metadata (deb)
 *   install     installs or unpacks it into a scratch directory:
 *                 .exe       (Windows) the NSIS installer, silently, with /S /D=<dir>
 *                 .AppImage  (Linux) extracted with --appimage-extract
 *                 .deb       (Linux) unpacked with dpkg-deb -x (no root, no system change)
 *                 .dmg       (macOS) mounted read-only, the .app copied out, unmounted
 *                 .zip       (macOS) the .app unzipped with ditto
 *                 directory  an unpacked build (win-unpacked, linux-unpacked, X.app)
 *   contents    checks that what landed has what the app needs at run time:
 *               app.asar, the SQLite native binding, data/main.db, locales, LICENSE
 *   runs        starts the installed app with a throwaway profile and checks it
 *               renders (and, with bundled modules or --expect-verses, shows a
 *               Bible chapter); saves a screenshot
 *   uninstall   (.exe) runs the uninstaller silently and checks the files went
 *
 * Every step logs to a file of its own; the console shows one line per step and
 * the end of the log of any step that failed.
 *
 * It uses Playwright from this checkout, so run `npm install` here first.  The
 * installer does not have to come from this checkout.
 *
 * ## Usage
 *
 *   node admin/scripts/test-installer.js <installer> [options]
 *   npm run test:installer -- <installer> [options]
 *
 *   --expect-verses       Fail unless a Bible chapter appears (the default when
 *                         the installer bundles modules).
 *   --yes                 Windows: install without asking first (see below).
 *   --keep                Keep the installed or unpacked copy (Windows: skip the
 *                         uninstall).
 *   --work-dir=DIR        Where logs and the scratch install go (default: a new
 *                         directory under the system temp directory).
 *   --timeout=SECONDS     How long to wait for each stage of start-up (default 90).
 *   --verbose             Show every step's output as it runs.
 *   --help
 *
 * Windows: the NSIS installer really installs, for the current user, into the
 * scratch directory, and registers an uninstaller, shortcuts included, until
 * the uninstall step removes them.  If this app is already installed for the
 * current user, the installer replaces that install.  So it asks before
 * installing, unless --yes; a test VM is the best place for it.
 *
 * Exit code 0 when every step passed, 1 when any failed, 2 for a usage error.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { StepRunner, capture, timestamp, describeMachine, displayWrapper } = require('./lib/steps');
const { runSmoke } = require('./lib/electron-smoke');

const REPO = path.resolve(__dirname, '../..');

// ============================================================================
// Options
// ============================================================================

function parseArgs(argv) {
  const o = { installer: null, expectVerses: false, yes: false, keep: false, workDir: null, timeoutMs: 90_000, verbose: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') o.help = true;
    else if (arg === '--expect-verses') o.expectVerses = true;
    else if (arg === '--yes' || arg === '-y') o.yes = true;
    else if (arg === '--keep') o.keep = true;
    else if (arg === '--verbose' || arg === '-v') o.verbose = true;
    else if (arg.startsWith('--work-dir=')) o.workDir = path.resolve(arg.slice('--work-dir='.length));
    else if (arg.startsWith('--timeout=')) o.timeoutMs = Number(arg.slice('--timeout='.length)) * 1000;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (o.installer) throw new Error(`one installer at a time (got ${o.installer} and ${arg})`);
    else o.installer = path.resolve(arg);
  }
  if (!o.help && !o.installer) throw new Error('name the installer to test, e.g. apps/desktop/dist/<name>.AppImage');
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) throw new Error('--timeout takes a number of seconds');
  return o;
}

function usageText() {
  const source = fs.readFileSync(__filename, 'utf8');
  const start = source.indexOf('/**');
  const header = source.slice(start + 3, source.indexOf('*/', start))
    .split('\n').map((line) => line.replace(/^ \* ?| \*$/u, '')).join('\n');
  return `${header.trim().split('\n')[0]}\n\n${header.slice(header.indexOf('## Usage') + 8).trim()}\n`;
}

// ============================================================================
// Kinds of installer
// ============================================================================

/** What the file is, and the platform it can be tested on. */
function detectKind(file) {
  const stat = fs.statSync(file);
  if (stat.isDirectory()) {
    if (file.endsWith('.app')) return { kind: 'app-dir', platform: 'darwin' };
    return { kind: 'dir', platform: process.platform };
  }
  const lower = file.toLowerCase();
  if (lower.endsWith('.exe')) return { kind: 'nsis', platform: 'win32' };
  if (lower.endsWith('.appimage')) return { kind: 'appimage', platform: 'linux' };
  if (lower.endsWith('.deb')) return { kind: 'deb', platform: 'linux' };
  if (lower.endsWith('.dmg')) return { kind: 'dmg', platform: 'darwin' };
  if (lower.endsWith('.zip')) return { kind: 'mac-zip', platform: 'darwin' };
  throw new Error(`Not an installer this script knows: ${path.basename(file)} (expected .exe, .AppImage, .deb, .dmg, .zip or an unpacked directory)`);
}

const PLATFORM_NAMES = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (c) => hash.update(c)).on('end', () => resolve(hash.digest('hex')));
  });
}

/** Run a command, logging it and its output; throw when it fails. */
function run(log, command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`);
  const res = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
  if (res.stdout && res.stdout.trim()) log(res.stdout.trimEnd());
  if (res.stderr && res.stderr.trim()) log(res.stderr.trimEnd());
  if (res.error) throw new Error(`${command} could not run: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${command} ${args[0] || ''} failed (exit code ${res.status})`);
  return res.stdout || '';
}

/** Files and directories directly inside `dir` (empty when it cannot be read). */
function list(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** The Electron helpers that sit beside the app binary but are not it. */
const NOT_THE_APP = new Set(['chrome-sandbox', 'chrome_crashpad_handler', 'apprun', 'elevate.exe', 'squirrel.exe']);

/**
 * The app binary in an unpacked Windows or Linux build directory: the largest
 * executable at the top level that is not a known helper, a library or an
 * uninstaller.
 */
function findAppBinary(dir) {
  const candidates = list(dir)
    .map((name) => ({ name, full: path.join(dir, name) }))
    .filter(({ name, full }) => {
      const lower = name.toLowerCase();
      if (NOT_THE_APP.has(lower) || lower.startsWith('uninstall')) return false;
      let stat;
      try { stat = fs.statSync(full); } catch { return false; }
      if (!stat.isFile()) return false;
      if (process.platform === 'win32') return lower.endsWith('.exe');
      return !name.includes('.') && (stat.mode & 0o111) !== 0;
    })
    .map((c) => ({ ...c, size: fs.statSync(c.full).size }))
    .sort((a, b) => b.size - a.size);
  return candidates[0]?.full ?? null;
}

/** The binary and resources directory of a macOS .app bundle. */
function macAppLayout(appDir) {
  const macosDir = path.join(appDir, 'Contents', 'MacOS');
  const plist = path.join(appDir, 'Contents', 'Info.plist');
  const named = capture('plutil', ['-extract', 'CFBundleExecutable', 'raw', plist]);
  const binary = named ? path.join(macosDir, named) : path.join(macosDir, list(macosDir)[0] || '');
  return { binary, resources: path.join(appDir, 'Contents', 'Resources') };
}

/** The first `*.app` directly inside `dir`. */
function findApp(dir) {
  const app = list(dir).find((name) => name.endsWith('.app'));
  return app ? path.join(dir, app) : null;
}

// ============================================================================
// Steps
// ============================================================================

/** Ask on the terminal; false when nobody is there to answer. */
function confirm(question) {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  const buffer = Buffer.alloc(256);
  let read = 0;
  try {
    read = fs.readSync(0, buffer, 0, buffer.length, null);
  } catch {
    return false;
  }
  return /^y(es)?$/i.test(buffer.toString('utf8', 0, read).trim());
}

async function inspect(ctx, { log }) {
  const { installer, kind } = ctx;
  if (kind === 'dir' || kind === 'app-dir') {
    log(`An unpacked build: ${installer}`);
    return 'unpacked build';
  }
  const size = fs.statSync(installer).size;
  ctx.sha256 = await sha256(installer);
  log(`File:    ${installer}`);
  log(`Size:    ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`SHA-256: ${ctx.sha256}`);
  if (size < 10 * 1024 * 1024) throw new Error(`Only ${(size / 1024).toFixed(0)} KB: too small to be a complete desktop installer (a partial download?).`);

  if (kind === 'nsis') {
    const status = capture('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${installer.replace(/'/g, "''")}').Status`]);
    log(`Authenticode signature: ${status || 'unknown'}`);
    ctx.signature = status === 'Valid' ? 'signed' : `not signed (${status || 'unknown'}); SmartScreen will warn users`;
  } else if (kind === 'deb') {
    const fields = run(log, 'dpkg-deb', ['--field', installer, 'Package', 'Version', 'Architecture', 'Depends']);
    ctx.debPackage = /^Package:\s*(\S+)/m.exec(fields)?.[1];
  } else if (kind === 'appimage') {
    const fuse = capture('sh', ['-c', 'ldconfig -p 2>/dev/null | grep -c "libfuse.so.2"']);
    ctx.fuseNote = Number(fuse) > 0
      ? 'libfuse2 is installed, so this machine can run the AppImage directly'
      : 'libfuse2 is NOT installed here; users on this distribution need it (e.g. sudo apt install libfuse2t64) to run the AppImage directly';
    log(ctx.fuseNote);
  }
  return `${(size / 1024 / 1024).toFixed(0)} MB, sha256 ${ctx.sha256.slice(0, 12)}...${ctx.signature ? `, ${ctx.signature}` : ''}`;
}

async function install(ctx, { log }) {
  const { installer, kind, scratch } = ctx;
  fs.mkdirSync(scratch, { recursive: true });

  if (kind === 'dir') {
    ctx.binary = findAppBinary(installer);
    ctx.resources = path.join(installer, 'resources');
  } else if (kind === 'app-dir') {
    ctx.appDir = installer;
    Object.assign(ctx, macAppLayout(installer));
    ctx.resources = macAppLayout(installer).resources;
  } else if (kind === 'nsis') {
    const target = path.join(scratch, 'installed');
    // /D must be the last argument and must not be quoted: NSIS takes the rest
    // of the command line as the path.
    const res = spawnSync(installer, ['/S', `/D=${target}`], { stdio: 'ignore', timeout: 15 * 60_000, windowsHide: true });
    log(`$ ${installer} /S /D=${target}`);
    if (res.error) throw new Error(`The installer could not run: ${res.error.message}`);
    if (res.status !== 0) throw new Error(`The installer exited with code ${res.status}.`);
    ctx.installDir = target;
    ctx.binary = findAppBinary(target);
    ctx.resources = path.join(target, 'resources');
    ctx.uninstaller = list(target).map((n) => path.join(target, n)).find((f) => /^uninstall.*\.exe$/i.test(path.basename(f))) || null;
    log(`Installed into ${target}; uninstaller: ${ctx.uninstaller || 'NOT FOUND'}`);
  } else if (kind === 'appimage') {
    const copy = path.join(scratch, path.basename(installer));
    fs.copyFileSync(installer, copy);
    fs.chmodSync(copy, 0o755);
    run(log, copy, ['--appimage-extract'], { cwd: scratch, stdio: ['ignore', 'ignore', 'pipe'] });
    const root = path.join(scratch, 'squashfs-root');
    if (!fs.existsSync(root)) throw new Error('--appimage-extract produced no squashfs-root.');
    ctx.binary = findAppBinary(root);
    ctx.resources = path.join(root, 'resources');
    const desktopFile = list(root).find((n) => n.endsWith('.desktop'));
    log(`Desktop entry: ${desktopFile || 'NONE'}`);
    if (!desktopFile) throw new Error('The AppImage has no .desktop entry.');
  } else if (kind === 'deb') {
    const root = path.join(scratch, 'root');
    run(log, 'dpkg-deb', ['-x', installer, root]);
    const optDirs = list(path.join(root, 'opt')).map((n) => path.join(root, 'opt', n));
    const appDir = optDirs.find((d) => findAppBinary(d));
    if (!appDir) throw new Error(`No app under /opt in the package (found: ${optDirs.join(', ') || 'nothing'}).`);
    ctx.binary = findAppBinary(appDir);
    ctx.resources = path.join(appDir, 'resources');
    const desktopFiles = list(path.join(root, 'usr', 'share', 'applications'));
    log(`Desktop entries: ${desktopFiles.join(', ') || 'NONE'}`);
    if (desktopFiles.length === 0) throw new Error('The package installs no .desktop entry, so the app would not appear in the menu.');
  } else if (kind === 'dmg') {
    const mount = path.join(scratch, 'mount');
    fs.mkdirSync(mount, { recursive: true });
    run(log, 'hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, installer]);
    try {
      const app = findApp(mount);
      if (!app) throw new Error(`The disk image holds no .app (found: ${list(mount).join(', ')}).`);
      log(`Disk image holds: ${list(mount).join(', ')}`);
      ctx.appDir = path.join(scratch, path.basename(app));
      run(log, 'ditto', [app, ctx.appDir]);
    } finally {
      run(log, 'hdiutil', ['detach', mount, '-force']);
    }
    Object.assign(ctx, macAppLayout(ctx.appDir));
  } else if (kind === 'mac-zip') {
    const out = path.join(scratch, 'unzipped');
    run(log, 'ditto', ['-x', '-k', installer, out]);
    const app = findApp(out);
    if (!app) throw new Error(`The zip holds no .app (found: ${list(out).join(', ')}).`);
    ctx.appDir = app;
    Object.assign(ctx, macAppLayout(app));
  }

  if (ctx.appDir) {
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', ctx.appDir], { encoding: 'utf8' });
    ctx.signature = verify.status === 0 ? 'code signature valid' : 'not signed (Gatekeeper will block a downloaded copy)';
    log(`codesign: ${ctx.signature}${verify.stderr ? ` -- ${verify.stderr.trim()}` : ''}`);
  }

  if (!ctx.binary || !fs.existsSync(ctx.binary)) throw new Error(`Could not find the app binary (looked in ${path.dirname(ctx.binary || ctx.resources)}).`);
  log(`App binary: ${ctx.binary}`);
  log(`Resources:  ${ctx.resources}`);
  return path.basename(ctx.binary);
}

async function contents(ctx, { log }) {
  const res = ctx.resources;
  const need = [
    ['app.asar', 'the application code'],
    [path.join('data', 'main.db'), 'the reference database template copied into a new profile'],
    ['locales', 'the translations for the language picker'],
    ['LICENSE', 'the GPL licence text, which must accompany the binary'],
    ['THIRD-PARTY-NOTICES.md', 'the third-party attributions and licence notices'],
    ['FONT-LICENSES.md', 'the OFL notice for the bundled fonts'],
  ];
  const missing = [];
  for (const [rel, why] of need) {
    const ok = fs.existsSync(path.join(res, rel));
    log(`${ok ? 'ok     ' : 'MISSING'} ${rel}  (${why})`);
    if (!ok) missing.push(`${rel} (${why})`);
  }

  // The SQLite driver's native binding must be unpacked from the asar, or the
  // app cannot open a database and shows a blank window.
  const sqliteDir = path.join(res, 'app.asar.unpacked', 'node_modules', 'better-sqlite3-multiple-ciphers', 'build', 'Release');
  const binding = list(sqliteDir).find((f) => f.endsWith('.node'));
  log(`${binding ? 'ok     ' : 'MISSING'} ${path.relative(res, path.join(sqliteDir, binding || '*.node'))}  (the SQLite driver)`);
  if (!binding) missing.push('the unpacked better-sqlite3-multiple-ciphers binding');

  const modules = list(path.join(res, 'data', 'modules')).filter((f) => f.endsWith('.db'));
  ctx.bundledModules = modules;
  log(`Bundled modules: ${modules.length > 0 ? modules.join(', ') : 'none (a code-only build: modules are installed from the app)'}`);

  if (missing.length > 0) throw new Error(`Missing from the install: ${missing.join('; ')}`);
  return modules.length > 0 ? `${modules.length} bundled module(s)` : 'code only, no bundled modules';
}

async function runs(ctx, { log, logDir }) {
  const expectVerses = ctx.expectVerses || (ctx.bundledModules || []).some((m) => m.startsWith('bible_'));
  log(expectVerses ? 'Expecting a Bible chapter on screen.' : 'No Bible is bundled, so only the UI is expected.');
  const result = await runSmoke({
    repoRoot: REPO,
    executablePath: ctx.binary,
    expectVerses,
    outDir: path.join(logDir, 'app'),
    timeoutMs: ctx.timeoutMs,
    log,
  });
  ctx.appInfo = result.info;
  if (!result.ok) {
    const failed = result.checks.filter((c) => c.status === 'fail').map((c) => `${c.name}: ${c.detail}`);
    throw new Error(`The installed app did not come up: ${failed.join('; ')}.  See app/ beside this log for its output and a screenshot.`);
  }
  if (!result.info.profileMainDb) {
    throw new Error('The app started, but no main.db appeared in its new profile: the template in resources/data was not copied.');
  }
  log(`The new profile got its registry: ${result.info.profileMainDb}`);

  let detail = `${result.info.name} ${result.info.version}, Electron ${result.info.electron}`;
  try {
    const built = require(require.resolve('electron/package.json', { paths: [path.join(REPO, 'apps', 'desktop'), REPO] })).version;
    if (built !== result.info.electron) {
      const note = `the installed app runs Electron ${result.info.electron}, but this checkout develops against ${built}`;
      log(`Note: ${note}.`);
      detail += ` (note: ${note})`;
    }
  } catch { /* no electron here to compare with */ }
  return detail;
}

async function uninstall(ctx, { log }) {
  if (!ctx.uninstaller) throw new Error('The install left no uninstaller.');
  const res = spawnSync(ctx.uninstaller, ['/S'], { stdio: 'ignore', timeout: 5 * 60_000, windowsHide: true });
  log(`$ ${ctx.uninstaller} /S  -> exit code ${res.status}`);
  if (res.error) throw new Error(`The uninstaller could not run: ${res.error.message}`);
  // The NSIS uninstaller copies itself to a temp directory and returns before
  // it has finished, so wait for the files to go.
  const deadline = Date.now() + 120_000;
  while (fs.existsSync(ctx.binary) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
  if (fs.existsSync(ctx.binary)) throw new Error(`Uninstalling left ${ctx.binary} behind.`);
  const left = list(ctx.installDir);
  log(left.length > 0 ? `Left in the install directory: ${left.join(', ')}` : 'The install directory is empty or gone.');
  return 'removed';
}

// ============================================================================
// Entry point
// ============================================================================

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`test-installer: ${err.message}\nTry --help.`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(usageText());
    return;
  }
  if (!fs.existsSync(opts.installer)) {
    console.error(`test-installer: no such file: ${opts.installer}`);
    process.exit(2);
  }

  let detected;
  try {
    detected = detectKind(opts.installer);
  } catch (err) {
    console.error(`test-installer: ${err.message}`);
    process.exit(2);
  }
  if (detected.platform !== process.platform) {
    console.error(`test-installer: ${path.basename(opts.installer)} is a ${PLATFORM_NAMES[detected.platform]} installer; test it on ${PLATFORM_NAMES[detected.platform]}.`);
    process.exit(2);
  }

  // Electron needs a display.  Re-run under xvfb-run when there is none.
  const display = process.env.BIBLE_SMOKE_UNDER_XVFB ? { prefix: [] } : displayWrapper();
  if (display.error) {
    console.error(display.error);
    process.exit(1);
  }
  if (display.prefix.length > 0) {
    console.log('No display; running under xvfb-run.');
    const res = spawnSync(display.prefix[0], [...display.prefix.slice(1), process.execPath, __filename, ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, BIBLE_SMOKE_UNDER_XVFB: '1' },
    });
    process.exit(res.status ?? 1);
  }

  if (detected.kind === 'nsis' && !opts.yes) {
    console.log('This installs the app for the current user (into a scratch directory, with shortcuts and an');
    console.log('uninstaller entry), then uninstalls it.  An existing install of the same app is replaced.');
    if (!confirm('Go ahead?')) {
      console.log('Not installed.  Pass --yes to install without asking.');
      process.exit(1);
    }
  }

  const workDir = opts.workDir || path.join(os.tmpdir(), `bible-installer-test-${timestamp()}`);
  const logDir = path.join(workDir, 'logs');
  const runner = new StepRunner({ logDir, echo: opts.verbose, title: 'Installer test' });
  const ctx = {
    installer: opts.installer, kind: detected.kind, scratch: path.join(workDir, 'scratch'),
    expectVerses: opts.expectVerses, timeoutMs: opts.timeoutMs,
  };
  process.on('SIGINT', () => {
    console.log('\nInterrupted.');
    runner.finish({ installer: opts.installer });
    process.exit(130);
  });

  console.log(`Testing ${opts.installer}`);
  console.log(`Logs:    ${logDir}`);
  console.log('');

  await runner.run({ id: 'inspect', title: 'Inspect the installer', fn: (s) => inspect(ctx, s) });
  await runner.run({ id: 'install', title: 'Install or unpack it', needs: ['inspect'], fn: (s) => install(ctx, s) });
  await runner.run({ id: 'contents', title: 'Installed files', needs: ['install'], fn: (s) => contents(ctx, s) });
  await runner.run({
    id: 'runs', title: 'The installed app runs', needs: ['install'], fn: (s) => runs(ctx, s),
    hint: 'app/ beside this log holds the app\'s own output and a screenshot.',
  });
  if (ctx.kind === 'nsis' && !opts.keep) {
    await runner.run({ id: 'uninstall', title: 'Uninstall it', needs: ['install'], fn: (s) => uninstall(ctx, s) });
  }

  if (!opts.keep && ctx.kind !== 'nsis') fs.rmSync(ctx.scratch, { recursive: true, force: true });

  const facts = { installer: path.basename(opts.installer), kind: ctx.kind, machine: describeMachine() };
  if (ctx.sha256) facts.sha256 = ctx.sha256;
  if (ctx.appInfo?.version) facts.app = `${ctx.appInfo.name} ${ctx.appInfo.version} (Electron ${ctx.appInfo.electron})`;
  if (ctx.signature) facts.signature = ctx.signature;
  if (ctx.fuseNote) facts.appimage = ctx.fuseNote;
  if (opts.keep && fs.existsSync(ctx.scratch)) facts.kept = ctx.scratch;
  const ok = runner.finish(facts);
  console.log(ok ? 'The installer works.' : 'The installer FAILED: see the failures above; each names its full log.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`test-installer: ${err.stack || err.message}`);
  process.exit(1);
});
