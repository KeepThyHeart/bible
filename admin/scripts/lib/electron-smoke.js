#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * admin/scripts/lib/electron-smoke.js -- start the desktop app and check that
 * it comes up.
 *
 * Used by verify.js, against the development build in apps/desktop/out/, and
 * by test-installer.js, against an app an installer put on disk.  Either way
 * the app runs with a throwaway profile (ELECTRON_USER_DATA), so it never
 * touches the profile of a desktop install on the same machine.
 *
 * What it checks:
 *   - the app starts and opens a window;
 *   - the window renders the UI (`[data-testid="app-loaded"]`), getting past
 *     the first-run dialog when it appears;
 *   - with --expect-verses: a Bible chapter is on screen (`verse-1`);
 *   - it reports, without failing on them, errors the renderer logged.
 * It saves a screenshot and the app's own output next to its log.
 *
 * Playwright drives it, resolved from the repository given by --repo (it is a
 * devDependency of apps/desktop), so that checkout must have had `npm ci`.
 *
 * ## Usage
 *
 *   node admin/scripts/lib/electron-smoke.js --repo=DIR [options]
 *
 *   --repo=DIR           Repository whose Playwright (and, with --dev, whose
 *                        build) to use.  Default: this script's repository.
 *   --dev                Launch the development build, apps/desktop/out/main/index.js,
 *                        under the Electron binary in node_modules.
 *   --executable=PATH    Launch this packaged app binary instead.
 *   --expect-verses      Fail unless Bible text appears.
 *   --out=DIR            Where to write the screenshot and app output (default: a temp dir).
 *   --timeout=SECONDS    How long to wait for each stage (default: 60).
 *
 * On Linux with no display it re-runs itself under `xvfb-run` when that is
 * installed.  Exit code 0 when every check passed, 1 otherwise.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { displayWrapper } = require('./steps');

const DEFAULT_REPO = path.resolve(__dirname, '../../..');

function loadPlaywright(repoRoot) {
  const from = [path.join(repoRoot, 'apps', 'desktop'), repoRoot];
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    let resolved;
    try {
      resolved = require.resolve(name, { paths: from });
    } catch {
      continue;
    }
    const mod = require(resolved);
    if (mod._electron) return mod;
  }
  throw new Error(`Playwright is not installed in ${repoRoot}; run \`npm ci\` (or \`npm install\`) there first.`);
}

/**
 * The Electron binary the development build runs under.
 *
 * The `electron` package's main export is that path, and requiring it throws
 * "Electron failed to install correctly" when the binary was never
 * downloaded, which is exactly the message worth passing on.
 */
function devElectronPath(repoRoot) {
  const pkg = require.resolve('electron', { paths: [path.join(repoRoot, 'apps', 'desktop'), repoRoot] });
  return require(pkg);
}

/**
 * Get past the first-run dialog when it is up.  The same steps as
 * dismissFirstRunDialog() in apps/desktop/e2e/fixtures/electron.fixture.ts,
 * which explains why each is needed.
 */
async function dismissFirstRunDialog(window) {
  const dialog = window.locator('[data-testid="first-run-language-dialog"]');
  const appeared = await dialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
  if (!appeared) return 'not shown';
  for (let step = 0; step < 4; step++) {
    const done = window.locator('[data-testid="first-run-language-done"]:visible');
    const advance = (await done.count()) > 0
      ? done.first()
      : window.locator('[data-testid="first-run-language-continue"]:visible').first();
    if (await advance.count() === 0) break;
    await advance.click();
    if (await dialog.waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false)) return 'dismissed';
  }
  await dialog.waitFor({ state: 'detached', timeout: 5000 });
  return 'dismissed';
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Launch the app and run the checks.
 *
 * `options`: { repoRoot, executablePath?, dev?, expectVerses?, outDir, timeoutMs?, log? }
 * Resolves { ok, checks: [{ name, status: 'pass'|'fail'|'warn', detail }], info }.
 */
async function runSmoke(options) {
  const repoRoot = options.repoRoot || DEFAULT_REPO;
  const timeoutMs = options.timeoutMs || 60000;
  const outDir = options.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'bible-smoke-out-'));
  const log = options.log || ((line) => console.log(line));
  fs.mkdirSync(outDir, { recursive: true });

  const checks = [];
  const record = (name, status, detail = '') => {
    checks.push({ name, status, detail });
    log(`${status.toUpperCase().padEnd(4)}  ${name}${detail ? ` -- ${detail}` : ''}`);
  };

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-smoke-profile-'));
  const appOutput = path.join(outDir, 'app-output.log');
  const info = { profile: userData };
  let app = null;

  try {
    const { _electron: electron } = loadPlaywright(repoRoot);

    let executablePath;
    const args = [];
    if (options.dev) {
      const mainJs = path.join(repoRoot, 'apps', 'desktop', 'out', 'main', 'index.js');
      if (!fs.existsSync(mainJs)) throw new Error(`No development build at ${mainJs}; run \`npm run build:desktop\`.`);
      executablePath = devElectronPath(repoRoot);
      args.push(mainJs);
    } else {
      executablePath = options.executablePath;
      if (!executablePath || !fs.existsSync(executablePath)) throw new Error(`No app binary at ${executablePath}`);
    }

    // Before the app path: Chromium switches.  --no-sandbox because an
    // extracted or unpacked Linux app's chrome-sandbox is not setuid root;
    // basic password store so no keyring prompt can stall a headless run.
    const switches = [];
    if (process.platform === 'linux') switches.push('--no-sandbox', '--disable-dev-shm-usage', '--password-store=basic');
    args.unshift(...switches);

    const env = { ...process.env, ELECTRON_USER_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    if (options.dev) env.NODE_ENV = 'test';
    else delete env.NODE_ENV;

    log(`Launching ${executablePath}${options.dev ? ` ${args[args.length - 1]}` : ''}`);
    log(`Profile: ${userData}`);
    app = await electron.launch({ executablePath, args, env, timeout: timeoutMs });
    const out = fs.createWriteStream(appOutput);
    app.process().stdout?.on('data', (chunk) => out.write(chunk));
    app.process().stderr?.on('data', (chunk) => out.write(chunk));
    record('the app starts', 'pass');

    Object.assign(info, await app.evaluate(({ app: electronApp }) => ({
      name: electronApp.getName(),
      version: electronApp.getVersion(),
      packaged: electronApp.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    })));
    log(`App: ${info.name} ${info.version}, Electron ${info.electron}, ${info.packaged ? 'packaged' : 'development build'}`);

    const window = await app.firstWindow({ timeout: timeoutMs });
    const rendererErrors = [];
    window.on('console', (msg) => { if (msg.type() === 'error') rendererErrors.push(msg.text()); });
    window.on('pageerror', (err) => rendererErrors.push(String(err && err.message ? err.message : err)));
    record('a window opens', 'pass', await window.title().catch(() => ''));

    await window.waitForSelector('[data-testid="app-loaded"]', { timeout: timeoutMs });
    record('the window renders the app', 'pass');

    const firstRun = await dismissFirstRunDialog(window);
    record('first-run dialog', 'pass', firstRun);

    if (options.expectVerses) {
      const verse = window.locator('[data-testid="verse-1"]').first();
      await verse.waitFor({ state: 'visible', timeout: timeoutMs });
      const text = ((await verse.textContent()) || '').replace(/\s+/g, ' ').trim();
      record('a Bible chapter is shown', text.length > 0 ? 'pass' : 'fail', text.slice(0, 70));
    }

    await window.screenshot({ path: path.join(outDir, 'screenshot.png') }).then(
      () => log(`Screenshot: ${path.join(outDir, 'screenshot.png')}`),
      (err) => log(`(no screenshot: ${err.message})`),
    );

    if (rendererErrors.length > 0) {
      record('renderer errors', 'warn', `${rendererErrors.length} logged; first: ${rendererErrors[0].slice(0, 200)}`);
      fs.writeFileSync(path.join(outDir, 'renderer-errors.txt'), `${rendererErrors.join('\n')}\n`);
    } else {
      record('renderer errors', 'pass', 'none');
    }

    const profileFiles = fs.readdirSync(userData);
    info.profileFiles = profileFiles;
    // A packaged app keeps its registry under <userData>/data/ (appPaths.ts);
    // the development build keeps it in apps/desktop/data/ instead.
    info.profileMainDb = ['main.db', path.join('data', 'main.db')].find((rel) => fs.existsSync(path.join(userData, rel))) || null;
    log(`Profile now holds: ${profileFiles.join(', ') || '(nothing)'}${info.profileMainDb ? `; registry at ${info.profileMainDb}` : ''}`);
  } catch (err) {
    record('smoke test', 'fail', err.message.split('\n')[0]);
    log(err.stack || err.message);
    if (app) {
      const window = app.windows()[0];
      if (window) await window.screenshot({ path: path.join(outDir, 'screenshot-failure.png') }).catch(() => undefined);
    }
  } finally {
    if (app) {
      await withTimeout(app.close(), 20000, 'Closing the app').catch((err) => {
        log(`(${err.message}; killing it)`);
        try { app.process().kill('SIGKILL'); } catch { /* already gone */ }
      });
    }
    if (fs.existsSync(appOutput)) log(`App output: ${appOutput}`);
    if (!options.keepProfile) fs.rmSync(userData, { recursive: true, force: true });
  }

  const ok = checks.length > 0 && checks.every((c) => c.status !== 'fail');
  return { ok, checks, info, outDir };
}

function parseArgs(argv) {
  const o = { repoRoot: DEFAULT_REPO, dev: false, executablePath: null, expectVerses: false, outDir: null, timeoutMs: 60000 };
  for (const arg of argv) {
    if (arg === '--dev') o.dev = true;
    else if (arg === '--expect-verses') o.expectVerses = true;
    else if (arg.startsWith('--repo=')) o.repoRoot = path.resolve(arg.slice('--repo='.length));
    else if (arg.startsWith('--executable=')) o.executablePath = path.resolve(arg.slice('--executable='.length));
    else if (arg.startsWith('--out=')) o.outDir = path.resolve(arg.slice('--out='.length));
    else if (arg.startsWith('--timeout=')) o.timeoutMs = Number(arg.slice('--timeout='.length)) * 1000;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!o.dev && !o.executablePath) throw new Error('give --dev or --executable=PATH');
  return o;
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`electron-smoke: ${err.message}`);
    process.exit(2);
  }

  const display = process.env.BIBLE_SMOKE_UNDER_XVFB ? { prefix: [] } : displayWrapper();
  if (display.error) {
    console.error(display.error);
    process.exit(1);
  }
  if (display.prefix.length > 0) {
    console.log('No display; running under xvfb-run.');
    const result = spawnSync(display.prefix[0], [...display.prefix.slice(1), process.execPath, __filename, ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, BIBLE_SMOKE_UNDER_XVFB: '1' },
    });
    process.exit(result.status ?? 1);
  }

  runSmoke(options).then((result) => {
    console.log(result.ok ? 'Desktop smoke test passed.' : 'Desktop smoke test FAILED.');
    process.exit(result.ok ? 0 : 1);
  }, (err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { runSmoke, loadPlaywright };
