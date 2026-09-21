#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * scripts/init/setup.js -- from a fresh clone to apps that run, in one command.
 *
 * `npm run setup` runs this.  It performs the steps the README lists, in
 * order, each of which is also a script of its own:
 *
 *   build-core   npm run build:core           compile @bible/core, which both apps import
 *   modules      scripts/init/index.js --catalog ...
 *                                             download modules, build data/main.db
 *   desktop      npm run init:desktop         desktop registry and the modules link
 *   electron     npm run init:electron        download the Electron binary
 *   sqlite       npm run rebuild-sqlite       Electron build of the desktop's SQLite driver
 *
 * Every choice can be given on the command line.  On a terminal, whatever was
 * not given is asked for, with the default one Enter away.  With --yes, when
 * stdin is not a terminal, or when CI is set, nothing is asked and the
 * defaults stand, so `npm run setup -- --yes` does what the plain chain of npm
 * scripts used to.
 *
 * ## Usage
 *
 *   npm run setup -- [options]      (or: node scripts/init/setup.js [options])
 *
 *   --apps=APPS         web, desktop, or both (the default).  Web alone skips
 *                       the desktop registry, the Electron download and the
 *                       native rebuild.
 *   --select=SET        Modules to download: a preset (starter, the default;
 *                       tests), module abbreviations (KJV,ASV), `choose` to
 *                       pick from the catalog's list, or `none` to download
 *                       nothing and register the files already in
 *                       data/modules/.
 *   --catalog=URL       Where modules come from: `official` (the signed
 *                       catalog, the default), `dev` (the unsigned development
 *                       catalog), or any catalog URL.
 *   --skip=STEPS        Leave steps out: build-core, modules, desktop,
 *                       electron, sqlite (comma-separated).
 *   --yes, -y           Ask nothing: defaults for everything not given.
 *   --help, -h
 *
 *   npm run setup:web   The same as --apps=web.
 *
 * Re-running is safe and quick: modules whose SHA-256 already matches are not
 * downloaded again, an existing site-config.json is kept, and the Electron
 * download and native rebuild are skipped when already done.
 *
 * Exit codes: 0 success, 1 a step failed, 2 usage error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { nodeVersionProblem, PRESETS } = require('./index');

const REPO_ROOT = path.resolve(__dirname, '../..');
const INIT_SCRIPT = path.join(__dirname, 'index.js');

/** The unsigned development catalog, as `npm run init:modules:dev` uses it. */
const DEV_CATALOG_URL = 'https://modules-dev.bible.keepthyheart.com/modules/';

const ALL_APPS = ['web', 'desktop'];
const STEP_IDS = ['build-core', 'modules', 'desktop', 'electron', 'sqlite'];
const DEFAULT_SELECT = ['starter'];

// ============================================================================
// Options
// ============================================================================

function parseApps(value) {
  const v = value.trim().toLowerCase();
  if (v === 'both' || v === 'all') return [...ALL_APPS];
  const apps = v.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = apps.filter((a) => !ALL_APPS.includes(a));
  if (apps.length === 0 || unknown.length > 0) {
    throw new Error(`--apps takes web, desktop or both, not "${value}"`);
  }
  return ALL_APPS.filter((a) => apps.includes(a));
}

function parseCatalog(value) {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'official') return 'official';
  if (v.toLowerCase() === 'dev') return DEV_CATALOG_URL;
  return v;
}

function parseArgs(argv) {
  const options = { apps: null, select: null, catalog: null, skip: new Set(), yes: false, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg.startsWith('--apps=')) options.apps = parseApps(arg.slice('--apps='.length));
    else if (arg.startsWith('--select=')) {
      options.select = arg.slice('--select='.length).split(',').map((s) => s.trim()).filter(Boolean);
      if (options.select.length === 0) throw new Error('--select needs a value, e.g. --select=starter');
    } else if (arg.startsWith('--catalog=')) options.catalog = parseCatalog(arg.slice('--catalog='.length));
    else if (arg.startsWith('--skip=')) {
      for (const id of arg.slice('--skip='.length).split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!STEP_IDS.includes(id)) throw new Error(`--skip: unknown step "${id}" (steps: ${STEP_IDS.join(', ')})`);
        options.skip.add(id);
      }
    } else throw new Error(`unknown option: ${arg}`);
  }
  if (options.select && options.select.length > 1) {
    const special = options.select.filter((s) => ['choose', 'none'].includes(s.toLowerCase()));
    if (special.length > 0) throw new Error(`--select=${special[0]} cannot be combined with other names`);
  }
  return options;
}

/** `choose`, `none`, or null when `select` names presets and modules. */
function selectMode(select) {
  const only = select.length === 1 ? select[0].toLowerCase() : '';
  return only === 'choose' || only === 'none' ? only : null;
}

// ============================================================================
// Questions
// ============================================================================

/**
 * Ask one numbered question; Enter takes the first choice.
 *
 * Returns the chosen entry's `value`.  An answer that is not a listed number
 * is asked again rather than guessed at.
 */
async function choose(rl, question, choices) {
  console.log('');
  console.log(question);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}${i === 0 ? '  (default)' : ''}`));
  for (;;) {
    const answer = (await new Promise((resolve) => rl.question(`Choice [1-${choices.length}, Enter for 1]: `, resolve))).trim();
    if (answer === '') return choices[0].value;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;
    console.log(`  Please enter a number from 1 to ${choices.length}.`);
  }
}

async function askText(rl, question) {
  return (await new Promise((resolve) => rl.question(question, resolve))).trim();
}

/**
 * Fill in whatever the command line left open, by asking.
 *
 * Every question is asked before the first step runs, and the readline
 * interface is closed again before any child starts: a child that prompts
 * (the catalog list, under `--select=choose`) reads the same stdin, and an
 * open interface here would swallow its answer.
 */
async function askMissing(options) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Setting up this checkout.  Press Enter to take the default for each question;');
    console.log('`npm run setup -- --help` lists the options that skip these questions.');

    if (!options.apps) {
      options.apps = await choose(rl, 'Which apps?', [
        { label: 'Web and desktop', value: ['web', 'desktop'] },
        { label: 'Web only (skips the Electron download and the native rebuild)', value: ['web'] },
        { label: 'Desktop only', value: ['desktop'] },
      ]);
    }

    if (!options.select && !options.skip.has('modules')) {
      options.select = await choose(rl, 'Which modules?', [
        { label: `starter: about 80 MB (${PRESETS.starter.join(', ')})`, value: ['starter'] },
        { label: 'tests: about 170 MB, starter plus every module a test suite names', value: ['tests'] },
        { label: 'Choose from the catalog\'s list', value: ['choose'] },
        { label: 'None: download nothing, register the files already in data/modules/', value: ['none'] },
      ]);
    }

    const downloads = !options.skip.has('modules') && selectMode(options.select ?? DEFAULT_SELECT) !== 'none';
    if (!options.catalog && downloads) {
      options.catalog = await choose(rl, 'Which module catalog?', [
        { label: 'The official catalog (signed)', value: 'official' },
        { label: 'The development catalog (unsigned; for testing modules before release)', value: DEV_CATALOG_URL },
        { label: 'Another catalog URL', value: 'ask' },
      ]);
      if (options.catalog === 'ask') {
        let url = '';
        while (!url) url = await askText(rl, 'Catalog URL: ');
        options.catalog = url;
      }
    }
  } finally {
    rl.close();
  }
}

// ============================================================================
// Steps
// ============================================================================

/**
 * How to run npm from here, on every platform.
 *
 * Under `npm run`, `npm_execpath` is npm's own CLI script, which the running
 * Node can execute directly: no shell, no PATH lookup, and the same npm that
 * started us.  Run directly with `node`, fall back to the `npm` on PATH, which
 * on Windows is a .cmd file that only a shell can start.
 */
function npmInvocation(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.[cm]?js$/.test(npmCli)) return { command: process.execPath, args: [npmCli, ...args], shell: false };
  if (process.platform === 'win32') return { command: 'npm.cmd', args, shell: true };
  return { command: 'npm', args, shell: false };
}

function nodeInvocation(args) {
  return { command: process.execPath, args, shell: false };
}

/** What a person would type to run one step by hand. */
function displayCommand(step) {
  return step.display;
}

function buildSteps(options) {
  const apps = options.apps;
  const desktop = apps.includes('desktop');
  const select = options.select ?? DEFAULT_SELECT;
  const mode = selectMode(select);
  const steps = [];

  steps.push({
    id: 'build-core',
    title: 'Build @bible/core',
    run: npmInvocation(['run', 'build:core']),
    display: 'npm run build:core',
    hint: 'The errors above come from compiling packages/core.  If node_modules looks incomplete, run `npm install` again.',
  });

  // The web registry is built even for a desktop-only setup: data/ is the
  // shared module store the desktop links to, and downloads land there.
  const initArgs = [INIT_SCRIPT];
  if (mode !== 'none') {
    initArgs.push(options.catalog && options.catalog !== 'official' ? `--catalog=${options.catalog}` : '--catalog');
    if (mode !== 'choose') initArgs.push(`--select=${select.join(',')}`);
  }
  if (options.nonInteractive) initArgs.push('--yes');
  if (!apps.includes('web')) initArgs.push('--no-config');
  steps.push({
    id: 'modules',
    title: mode === 'none' ? 'Register the modules in data/modules/' : 'Download and register modules',
    run: nodeInvocation(initArgs),
    display: ['node scripts/init/index.js', ...initArgs.slice(1)].join(' '),
    hint: mode === 'none'
      ? 'Copy module .db files into data/modules/ first, or let setup download them: `npm run setup -- --select=starter`.'
      : 'If the catalog could not be reached, see Troubleshooting in README.md.  To work offline, copy module\n'
        + '.db files into data/modules/ and run `npm run setup -- --select=none`.',
  });

  if (desktop) {
    steps.push({
      id: 'desktop',
      title: 'Desktop registry and modules link',
      run: nodeInvocation([INIT_SCRIPT, '--target=desktop']),
      display: 'npm run init:desktop',
      hint: 'See the messages above; `npm run init -- --help` describes the desktop target.',
    });
    steps.push({
      id: 'electron',
      title: 'Download the Electron binary',
      run: npmInvocation(['run', 'init:electron']),
      display: 'npm run init:electron',
      hint: 'The Electron binary comes from GitHub.  `TypeError: fetch failed` usually means a slow DNS lookup or\n'
        + 'broken IPv6 to github.com; see "Electron failed to install correctly" under Troubleshooting in README.md.',
    });
    steps.push({
      id: 'sqlite',
      title: 'Electron build of the desktop\'s SQLite driver',
      run: npmInvocation(['run', 'rebuild-sqlite']),
      display: 'npm run rebuild-sqlite',
      hint: 'No prebuilt binary could be fetched and compiling it failed.  Compiling needs Python 3 and a C++\n'
        + 'toolchain (see Prerequisites in README.md); a stalled download usually means a DNS or IPv6 problem\n'
        + '(see Troubleshooting).',
    });
  }

  return steps.filter((step) => !options.skip.has(step.id));
}

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Run the steps in order, output straight to the terminal; stop at the first failure. */
function runSteps(steps) {
  const started = Date.now();
  for (const [index, step] of steps.entries()) {
    console.log('');
    console.log(`==> [${index + 1}/${steps.length}] ${step.title}`);
    console.log(`    ${displayCommand(step)}`);
    const t0 = Date.now();
    const result = spawnSync(step.run.command, step.run.args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: step.run.shell,
      env: process.env,
    });
    const took = formatDuration(Date.now() - t0);
    if (result.error || result.status !== 0) {
      const why = result.error
        ? `could not start: ${result.error.message}`
        : result.signal ? `killed by ${result.signal}` : `exit code ${result.status}`;
      console.error('');
      console.error(`Setup FAILED at step ${index + 1} of ${steps.length}, "${step.title}" (${why}, after ${took}).`);
      console.error('');
      for (const line of step.hint.split('\n')) console.error(`  ${line}`);
      console.error('');
      console.error(`  Retry just this step:   ${displayCommand(step)}`);
      console.error('  Or re-run setup; the steps already done are quick to repeat.');
      return false;
    }
    console.log(`    done in ${took}`);
  }
  console.log('');
  console.log(`Setup complete in ${formatDuration(Date.now() - started)}.`);
  return true;
}

// ============================================================================
// Entry point
// ============================================================================

function usageText() {
  const source = fs.readFileSync(__filename, 'utf8');
  const start = source.indexOf('/**');
  const header = source.slice(start + '/**'.length, source.indexOf('*/', start))
    .split('\n')
    .map((line) => line.replace(/^ \* ?| \*$/u, ''))
    .join('\n');
  const usage = header.slice(header.indexOf('## Usage') + '## Usage'.length).trim();
  return `${header.trim().split('\n')[0]}\n\n${usage}\n`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`setup: ${err.message}`);
    console.error('Try --help.');
    process.exit(2);
  }
  if (options.help) {
    console.log(usageText());
    return;
  }

  const versionProblem = nodeVersionProblem();
  if (versionProblem) {
    for (const line of versionProblem) console.error(`setup: ${line}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'typescript'))) {
    console.error('setup: the dependencies are not installed.  Run `npm install` at the repository root first.');
    process.exit(1);
  }

  options.nonInteractive = options.yes || !process.stdin.isTTY || !process.stdout.isTTY || Boolean(process.env.CI);
  if (!options.nonInteractive) await askMissing(options);
  options.apps = options.apps ?? [...ALL_APPS];

  if (options.nonInteractive && options.select && selectMode(options.select) === 'choose') {
    console.error('setup: --select=choose needs a terminal to choose at; name a preset or modules instead.');
    process.exit(2);
  }

  const steps = buildSteps(options);
  console.log('');
  console.log(`Apps:    ${options.apps.join(' and ')}`);
  if (!options.skip.has('modules')) {
    const select = options.select ?? DEFAULT_SELECT;
    const mode = selectMode(select);
    console.log(`Modules: ${mode === 'none' ? 'none downloaded; registering data/modules/' : mode === 'choose' ? 'chosen from the catalog' : select.join(', ')}`);
    if (mode !== 'none') console.log(`Catalog: ${!options.catalog || options.catalog === 'official' ? 'official (signed)' : options.catalog}`);
  }
  console.log(`Steps:   ${steps.map((s) => s.id).join(', ') || 'none'}`);

  if (!runSteps(steps)) process.exit(1);

  console.log('');
  if (options.apps.includes('web')) console.log('  npm run dev:web    web app: open http://localhost:5173/');
  if (options.apps.includes('desktop')) console.log('  npm run dev        desktop app');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('');
    console.error(`setup failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, buildSteps, selectMode };
