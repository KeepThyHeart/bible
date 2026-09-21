#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * admin/scripts/verify.js -- verify that a commit sets up, tests, builds and runs.
 *
 * It checks that a commit sets up from scratch, passes its tests, builds, and
 * runs, and says exactly what did not.
 *
 * This is the engine behind verify-linux.sh, verify-macos.sh and
 * verify-windows.ps1, which check the platform's prerequisites and then run
 * it.  It needs nothing but Node.js, git and npm: no package is loaded until
 * `npm ci` has installed it.
 *
 * The steps, in order.  One that fails does not stop the ones that do not
 * depend on it, so a run reports every independent failure at once:
 *
 *   prerequisites     Node.js, npm and git versions; free disk space
 *   clone             (--fresh) a clean clone of the commit under test
 *   install           npm ci
 *   setup             npm run setup -- --yes --select=tests (every module a suite names)
 *   init-checks       node scripts/init/checks.js
 *   typecheck         npm run typecheck
 *   sqlite-node       (desktop) the SQLite driver built for Node, so the desktop
 *                     suites that open a real database run instead of skipping
 *   unit-tests        npm test
 *   build-web         npm run build:web
 *   web-runs          start the built web server; check /api/health, the page,
 *                     the module list and a Bible chapter
 *   sqlite-electron   (desktop) the SQLite driver built for Electron again
 *   build-desktop     npm run build:desktop
 *   desktop-runs      start the built desktop app; check it renders a Bible chapter
 *   e2e-desktop, e2e-web   (--e2e) the Playwright suites
 *
 * Each step's full output is in its own log file; the console shows one line
 * per step and the end of the log of any step that failed.  summary.txt and
 * summary.json in the log directory record the result against the commit, so
 * a run can be attached to a sign-off.
 *
 * ## Usage
 *
 *   node admin/scripts/verify.js [options]     (or: npm run verify -- [options])
 *
 *   --fresh[=URL]         Verify a fresh clone instead of this checkout: clone URL
 *                         (default: this checkout, which verifies committed work
 *                         only) into the work directory and check out --ref.
 *   --ref=REF             Branch, tag or commit for --fresh (default: this
 *                         checkout's HEAD when cloning it, else the default branch).
 *   --apps=APPS           web, desktop or both (the default).
 *   --e2e                 Also run the Playwright end-to-end suites (slow; the web
 *                         suite downloads Playwright's browsers).
 *   --reuse-modules=DIR   Copy the module .db files in DIR (another checkout's
 *                         data/modules, say) into place before setup, to save the
 *                         download.  Setup still checks each against the catalog.
 *   --work-dir=DIR        Where the logs, and a --fresh clone, go (default: a new
 *                         directory under the system temp directory).
 *   --verbose             Show every step's output as it runs.
 *   --help
 *
 * Without --fresh this changes the checkout the way setting it up does: `npm
 * ci` replaces node_modules, modules land in data/, and the desktop is left
 * ready for `npm run dev`.
 *
 * Exit code 0 when every step passed, 1 when any failed, 2 for a usage error.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  StepRunner, npm, capture, killTree, tail, timestamp, describeMachine, displayWrapper,
} = require('./lib/steps');

const SCRIPT_REPO = path.resolve(__dirname, '../..');
const MIN_NODE = [20, 19];
const MIN_FREE_GB = 8;
const MINUTE = 60_000;

// ============================================================================
// Options
// ============================================================================

function parseArgs(argv) {
  const o = {
    fresh: false, url: null, ref: null, apps: ['web', 'desktop'], e2e: false,
    reuseModules: null, workDir: null, verbose: false, help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') o.help = true;
    else if (arg === '--fresh') o.fresh = true;
    else if (arg.startsWith('--fresh=')) { o.fresh = true; o.url = arg.slice('--fresh='.length); }
    else if (arg.startsWith('--ref=')) o.ref = arg.slice('--ref='.length);
    else if (arg.startsWith('--apps=')) {
      const v = arg.slice('--apps='.length).toLowerCase();
      o.apps = v === 'both' ? ['web', 'desktop'] : v.split(',').map((s) => s.trim()).filter(Boolean);
      if (o.apps.length === 0 || o.apps.some((a) => !['web', 'desktop'].includes(a))) {
        throw new Error(`--apps takes web, desktop or both, not "${v}"`);
      }
    } else if (arg === '--e2e') o.e2e = true;
    else if (arg.startsWith('--reuse-modules=')) o.reuseModules = path.resolve(arg.slice('--reuse-modules='.length));
    else if (arg.startsWith('--work-dir=')) o.workDir = path.resolve(arg.slice('--work-dir='.length));
    else if (arg === '--verbose' || arg === '-v') o.verbose = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (o.ref && !o.fresh) throw new Error('--ref only makes sense with --fresh (in place, check the ref out yourself)');
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
// Helpers
// ============================================================================

function git(repo, args) {
  return capture('git', ['-C', repo, ...args]);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start the built web server and check that it serves: the health endpoint,
 * the page, the module list and a chapter of a Bible.
 */
async function checkWebServer(repo, { log, logDir }) {
  const webDir = path.join(repo, 'apps', 'web');
  const serverJs = path.join(webDir, 'dist', 'server', 'index.js');
  if (!fs.existsSync(serverJs)) throw new Error(`No built server at ${serverJs}`);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const serverLog = path.join(logDir, 'web-server-output.log');
  const out = fs.openSync(serverLog, 'w');
  log(`Starting ${serverJs} on port ${port}; its output goes to ${serverLog}`);
  const child = spawn(process.execPath, [serverJs], {
    cwd: webDir,
    env: { ...process.env, PORT: String(port), NO_AUTH: '1', DISABLE_RATE_LIMIT: '1', NODE_ENV: 'production' },
    stdio: ['ignore', out, out],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code, signal) => { exited = signal || `exit code ${code}`; });

  const serverTail = () => `\nThe server's last output:\n${tail(serverLog, 30)}`;
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (exited) throw new Error(`The web server stopped (${exited}) before answering.${serverTail()}`);
      const res = await fetchWithTimeout(`${base}/api/health`, 5000).catch(() => null);
      if (res && res.ok) break;
      if (Date.now() > deadline) throw new Error(`The web server did not answer /api/health within 90s.${serverTail()}`);
      await sleep(1000);
    }
    log('GET /api/health: ok');

    const page = await fetchWithTimeout(`${base}/`);
    const html = await page.text();
    if (!page.ok || !html.includes('id="app"')) {
      throw new Error(`GET / answered ${page.status} without the app's page (${html.slice(0, 120).replace(/\s+/g, ' ')})`);
    }
    log('GET /: the app page');

    const modulesRes = await fetchWithTimeout(`${base}/api/modules`);
    const modules = await modulesRes.json().catch(() => null);
    if (!modulesRes.ok || !Array.isArray(modules) || modules.length === 0) {
      throw new Error(`GET /api/modules returned no modules (HTTP ${modulesRes.status}).  Is data/site-config.json listing them?`);
    }
    const bibles = modules.filter((m) => m.type === 'bible');
    log(`GET /api/modules: ${modules.length} module(s); Bibles: ${bibles.map((b) => b.abbreviation).join(', ') || 'none'}`);
    if (bibles.length === 0) throw new Error('No Bible module is visible to the web app.');

    const bible = bibles.find((b) => String(b.abbreviation).toUpperCase() === 'KJV') || bibles[0];
    const chapterRes = await fetchWithTimeout(`${base}/api/bible/${encodeURIComponent(bible.abbreviation)}/43/3`);
    const chapter = await chapterRes.json().catch(() => null);
    const verses = chapter && Array.isArray(chapter.verses) ? chapter.verses.length : 0;
    if (!chapterRes.ok || verses < 30) {
      throw new Error(`GET /api/bible/${bible.abbreviation}/43/3 returned ${verses} verse(s) of John 3 (HTTP ${chapterRes.status}); expected 36.`);
    }
    log(`GET /api/bible/${bible.abbreviation}/43/3: ${verses} verses`);
    if (exited) throw new Error(`The web server stopped (${exited}) during the checks.${serverTail()}`);
    return `${modules.length} modules served; ${bible.abbreviation} John 3 has ${verses} verses`;
  } finally {
    killTree(child);
    await sleep(500);
    fs.closeSync(out);
  }
}

/** Clone `url` into `dest` and check out `ref`, detached. */
function cloneRepo({ url, ref, dest, log }) {
  const run = (args, cwd) => {
    log(`$ git ${args.join(' ')}`);
    const res = require('child_process').spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    if (res.stdout) log(res.stdout.trimEnd());
    if (res.stderr) log(res.stderr.trimEnd());
    if (res.error || res.status !== 0) throw new Error(`git ${args[0]} failed${res.error ? `: ${res.error.message}` : ` (exit code ${res.status})`}`);
  };
  run(['clone', '--quiet', url, dest], path.dirname(dest));
  if (ref) {
    const candidates = [ref, `origin/${ref}`];
    const target = candidates.find((c) => git(dest, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`]));
    if (!target) throw new Error(`The clone has no branch, tag or commit "${ref}".`);
    run(['checkout', '--quiet', '--detach', target], dest);
  }
}

// ============================================================================
// Entry point
// ============================================================================

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`verify: ${err.message}\nTry --help.`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(usageText());
    return;
  }

  const workDir = opts.workDir || path.join(os.tmpdir(), `bible-verify-${timestamp()}`);
  const logDir = path.join(workDir, 'logs');
  const runner = new StepRunner({ logDir, echo: opts.verbose, title: 'Verification' });
  const desktop = opts.apps.includes('desktop');
  const web = opts.apps.includes('web');

  let repo = SCRIPT_REPO;
  const facts = {};
  let finished = false;
  const finish = () => {
    if (finished) return runner.results.every((r) => r.status === 'pass');
    finished = true;
    const commit = git(repo, ['rev-parse', 'HEAD']);
    if (commit) facts.commit = commit;
    const ok = runner.finish(facts);
    console.log(ok
      ? `VERIFIED ${facts.commit || ''} on ${facts.machine}.`
      : 'NOT VERIFIED: see the failures above; each names its full log.');
    return ok;
  };
  process.on('SIGINT', () => {
    console.log('\nInterrupted; stopping the current step.');
    runner.abort();
    finish();
    process.exit(130);
  });

  facts.machine = describeMachine();
  facts.node = process.version;
  facts.apps = opts.apps.join(', ') + (opts.e2e ? ' (with e2e)' : '');

  console.log(`Verifying ${opts.fresh ? `a fresh clone of ${opts.url || SCRIPT_REPO}` : SCRIPT_REPO}`);
  console.log(`Logs:     ${logDir}`);
  console.log('');

  // --- prerequisites ---------------------------------------------------------
  await runner.run({
    id: 'prerequisites',
    title: 'Prerequisites (Node.js, npm, git, disk space)',
    fn: async ({ log }) => {
      const problems = [];
      const [major, minor] = process.versions.node.split('.').map(Number);
      log(`Node.js ${process.version} at ${process.execPath}`);
      if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
        problems.push(`Node.js ${MIN_NODE.join('.')} or newer is needed (24 recommended); this is ${process.version}.`);
      }
      const npmInv = npm(['--version']);
      const npmVersion = capture(npmInv.command, npmInv.args, { shell: npmInv.shell });
      log(`npm ${npmVersion || 'NOT FOUND'}`);
      if (!npmVersion) problems.push('npm was not found (it comes with Node.js).');
      else facts.npm = npmVersion;
      const gitVersion = capture('git', ['--version']);
      log(gitVersion || 'git NOT FOUND');
      if (!gitVersion) problems.push('git was not found.');

      try {
        fs.mkdirSync(workDir, { recursive: true });
        const where = opts.fresh ? workDir : SCRIPT_REPO;
        const stats = fs.statfsSync(where);
        const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
        log(`Free space at ${where}: ${freeGb.toFixed(1)} GB`);
        if (freeGb < MIN_FREE_GB) log(`WARNING: under ${MIN_FREE_GB} GB free; node_modules, modules and builds need several GB.`);
      } catch (err) {
        log(`(could not check free space: ${err.message})`);
      }

      if (desktop) {
        const display = displayWrapper();
        log(display.error ? display.error : display.prefix.length ? 'No display; the desktop checks will use xvfb-run.' : 'A display is available for the desktop checks.');
        if (display.error) problems.push(display.error);
      }
      if (problems.length > 0) throw new Error(problems.join('\n'));
      return `Node ${process.version}, npm ${npmVersion}, ${gitVersion.replace(/^git version /, 'git ')}`;
    },
  });

  // --- clone -----------------------------------------------------------------
  if (opts.fresh) {
    const dest = path.join(workDir, 'bible');
    const url = opts.url || SCRIPT_REPO;
    const ref = opts.ref || (opts.url ? null : git(SCRIPT_REPO, ['rev-parse', 'HEAD']));
    await runner.run({
      id: 'clone',
      title: 'Fresh clone',
      needs: ['prerequisites'],
      fn: async ({ log }) => {
        if (!opts.url) {
          const dirty = git(SCRIPT_REPO, ['status', '--porcelain', '--untracked-files=no']);
          if (dirty) log('Note: this checkout has uncommitted changes; the clone verifies the committed HEAD only.');
        }
        cloneRepo({ url, ref, dest, log });
        return `${git(dest, ['rev-parse', '--short', 'HEAD'])} in ${dest}`;
      },
    });
    repo = dest;
  } else {
    const dirty = git(SCRIPT_REPO, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty) facts.note = 'the checkout had uncommitted changes, so this verifies the working tree, not only the commit';
  }
  const ready = opts.fresh ? ['prerequisites', 'clone'] : ['prerequisites'];
  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch && branch !== 'HEAD') facts.branch = branch;
  else if (opts.ref) facts.ref = opts.ref;

  const inRepo = (inv, extra = {}) => ({ command: inv.command, args: inv.args, shell: inv.shell, cwd: repo, ...extra });

  // --- install and set up ----------------------------------------------------
  await runner.run({
    id: 'install', title: 'Install dependencies (npm ci)', needs: ready,
    ...inRepo(npm(['ci', '--no-audit', '--no-fund'])), timeoutMs: 45 * MINUTE,
    hint: 'A native module failing to compile needs Python 3 and a C++ toolchain; a stalled download is usually DNS or IPv6 (README.md, Troubleshooting).',
  });

  if (opts.reuseModules) {
    await runner.run({
      id: 'reuse-modules', title: `Copy modules from ${opts.reuseModules}`, needs: ['install'],
      fn: async ({ log }) => {
        const target = path.join(repo, 'data', 'modules');
        fs.mkdirSync(target, { recursive: true });
        const files = fs.readdirSync(opts.reuseModules).filter((f) => f.endsWith('.db'));
        if (files.length === 0) throw new Error(`No .db files in ${opts.reuseModules}`);
        for (const f of files) {
          fs.copyFileSync(path.join(opts.reuseModules, f), path.join(target, f));
          log(`copied ${f}`);
        }
        return `${files.length} file(s)`;
      },
    });
  }

  await runner.run({
    id: 'setup', title: 'Set up (npm run setup, test modules)', needs: ['install'],
    ...inRepo({ command: process.execPath, args: ['scripts/init/setup.js', '--yes', '--select=tests', `--apps=${opts.apps.join(',')}`], shell: false }),
    timeoutMs: 45 * MINUTE,
    hint: 'The log names the setup step that failed and how to retry it.',
  });

  await runner.run({
    id: 'init-checks', title: 'Init script self-checks', needs: ['install'],
    ...inRepo({ command: process.execPath, args: ['scripts/init/checks.js'], shell: false }), timeoutMs: 5 * MINUTE,
  });

  await runner.run({
    id: 'typecheck', title: 'Type-check every workspace', needs: ['setup'],
    ...inRepo(npm(['run', 'typecheck'])), timeoutMs: 20 * MINUTE,
  });

  // --- unit tests ------------------------------------------------------------
  const testNeeds = ['setup'];
  if (desktop) {
    await runner.run({
      id: 'sqlite-node', title: 'SQLite driver built for Node (for the desktop suites)', needs: ['setup'],
      ...inRepo(npm(['rebuild', 'better-sqlite3-multiple-ciphers'])), timeoutMs: 20 * MINUTE,
    });
    testNeeds.push('sqlite-node');
  }
  await runner.run({
    id: 'unit-tests', title: 'Unit tests (npm test)', needs: testNeeds,
    ...inRepo(npm(['test'])), timeoutMs: 60 * MINUTE,
    hint: 'The failing suite and assertion are in the log above; search it for "FAIL".',
  });

  // --- the web app -----------------------------------------------------------
  if (web) {
    await runner.run({
      id: 'build-web', title: 'Build the web app', needs: ['setup'],
      ...inRepo(npm(['run', 'build:web'])), timeoutMs: 30 * MINUTE,
      hint: 'The build first downloads the search embedding model (about 130 MB) from huggingface.co into data/models/.\n'
        + '"[fetch-model] ERROR: fetch failed" is a network problem, often the slow DNS lookup described under\n'
        + 'Troubleshooting in README.md; retry with `npm run fetch:model -w @bible/web`.',
    });
    await runner.run({
      id: 'web-runs', title: 'The web app runs', needs: ['build-web'],
      fn: ({ log, logDir: dir }) => checkWebServer(repo, { log, logDir: dir }),
    });
  }

  // --- the desktop app -------------------------------------------------------
  const display = desktop ? displayWrapper() : { prefix: [] };
  if (desktop) {
    await runner.run({
      id: 'sqlite-electron', title: 'SQLite driver built for Electron', needs: ['setup'],
      ...inRepo(npm(['run', 'rebuild-native:force', '-w', '@bible/desktop'])), timeoutMs: 20 * MINUTE,
    });
    await runner.run({
      id: 'build-desktop', title: 'Build the desktop app', needs: ['sqlite-electron'],
      ...inRepo(npm(['run', 'build:desktop'])), timeoutMs: 30 * MINUTE,
    });
    await runner.run({
      id: 'desktop-runs', title: 'The desktop app runs', needs: ['build-desktop'],
      ...inRepo({
        command: process.execPath,
        args: [path.join(__dirname, 'lib', 'electron-smoke.js'), `--repo=${repo}`, '--dev', '--expect-verses', `--out=${path.join(logDir, 'desktop-smoke')}`],
        shell: false,
      }),
      timeoutMs: 10 * MINUTE,
      hint: 'desktop-smoke/ beside this log holds a screenshot and the app\'s own output.',
    });
  }

  // --- end-to-end ------------------------------------------------------------
  if (opts.e2e) {
    if (desktop) {
      const inv = npm(['run', 'test:e2e', '-w', '@bible/desktop']);
      const wrapped = display.prefix.length ? { command: display.prefix[0], args: [...display.prefix.slice(1), inv.command, ...inv.args], shell: false } : inv;
      await runner.run({
        id: 'e2e-desktop', title: 'Desktop end-to-end suite (Playwright)', needs: ['build-desktop'],
        ...inRepo(wrapped, { env: { ...process.env, CI: '1' } }), timeoutMs: 90 * MINUTE,
        hint: 'Reports and traces: apps/desktop/e2e/playwright-report and apps/desktop/e2e/test-results.',
      });
    }
    if (web) {
      await runner.run({
        id: 'e2e-browsers', title: 'Playwright browsers for the web suite', needs: ['install'],
        ...inRepo(npm(['exec', '--', 'playwright', 'install', 'chromium', 'webkit']), { cwd: path.join(repo, 'apps', 'web') }),
        timeoutMs: 30 * MINUTE,
        hint: 'On Linux the browsers also need system libraries: `sudo npx playwright install-deps chromium webkit`.',
      });
      await runner.run({
        id: 'e2e-web', title: 'Web end-to-end suite (Playwright)', needs: ['setup', 'e2e-browsers'],
        ...inRepo(npm(['run', 'test:e2e', '-w', '@bible/web']), { env: { ...process.env, CI: '1' } }), timeoutMs: 60 * MINUTE,
      });
    }
  }

  const ok = finish();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`verify: ${err.stack || err.message}`);
  process.exit(1);
});
