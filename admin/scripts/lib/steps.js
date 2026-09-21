/* eslint-disable no-console */
/**
 * admin/scripts/lib/steps.js -- run a list of steps, log each one, and say
 * plainly what failed.
 *
 * Shared by verify.js and test-installer.js.  Every step writes its whole
 * output to a log file of its own; the console gets one line per step, and,
 * when a step fails, the end of its log.  So a failed run already shows the
 * error, and the full logs are there for anything more.
 *
 * Nothing here needs an npm package: verify.js runs before `npm ci` has.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/** Lines of a failed step's log shown on the console. */
const TAIL_LINES = 60;

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * How to run npm, on every platform.
 *
 * Under `npm run`, `npm_execpath` is npm's own CLI script, which this Node can
 * run directly.  Otherwise the `npm` on PATH, which on Windows is a .cmd file
 * that only a shell can start.
 */
function npm(args) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.[cm]?js$/.test(npmCli)) return { command: process.execPath, args: [npmCli, ...args], shell: false };
  if (process.platform === 'win32') return { command: 'npm.cmd', args, shell: true };
  return { command: 'npm', args, shell: false };
}

/** Run a command to completion and return its trimmed stdout, or null when it fails. */
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

/** Kill a child and everything it started. */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  // Started with `detached`, so the child leads its own process group.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 5000).unref();
}

/** The last `n` lines of a file, or '' when it cannot be read. */
function tail(file, n = TAIL_LINES) {
  try {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

/**
 * Run one command with all of its output going to `logFile` (and, when
 * `echo` is set, to this console too).
 *
 * Resolves `{ code, signal, timedOut, error }`; never rejects.
 */
function runLogged({ command, args, cwd, env, shell = false, logFile, timeoutMs, echo = false, onRunning, register }) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'a');
    fs.writeSync(out, `$ ${[command, ...args].join(' ')}\n  (in ${cwd})\n\n`);
    let open = true;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(beat);
      if (open) { open = false; fs.closeSync(out); }
      resolve(result);
    };

    let child;
    try {
      child = spawn(command, args, {
        cwd, env, shell,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      finish({ error });
      return;
    }
    if (register) register(child);

    const onData = (chunk) => {
      if (open) fs.writeSync(out, chunk);
      if (echo) process.stdout.write(chunk);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        if (open) fs.writeSync(out, `\n\n*** Timed out after ${formatDuration(timeoutMs)}; stopped. ***\n`);
        killTree(child);
      }, timeoutMs)
      : null;
    const started = Date.now();
    const beat = onRunning && !echo ? setInterval(() => onRunning(Date.now() - started), 60_000) : null;

    child.on('error', (error) => finish({ error }));
    child.on('close', (code, signal) => finish({ code, signal, timedOut }));
  });
}

/**
 * A run of steps with dependencies between them.
 *
 * A step that fails does not stop the run: the steps that do not depend on it
 * still run, so one pass reports every independent failure (a type error and
 * a failing test, say) rather than the first.  A step whose `needs` did not
 * pass is skipped, and says which one it was waiting on.
 */
class StepRunner {
  constructor({ logDir, echo = false, title = 'Run' }) {
    this.logDir = logDir;
    this.echo = echo;
    this.title = title;
    this.results = [];
    this.count = 0;
    this.current = null;
    fs.mkdirSync(logDir, { recursive: true });
  }

  /** Status of an earlier step, or undefined. */
  status(id) {
    return this.results.find((r) => r.id === id)?.status;
  }

  get failed() {
    return this.results.some((r) => r.status === 'fail');
  }

  /**
   * Run one step.  `def` is
   *   { id, title, needs?: [id], command, args, cwd, env?, shell?, timeoutMs? }
   * for a command, or
   *   { id, title, needs?, fn: async ({ log, logFile, logDir }) => detail? }
   * for work done here; `fn` fails the step by throwing.
   *
   * Returns the step's status: 'pass', 'fail' or 'skip'.
   */
  async run(def) {
    this.count += 1;
    const n = String(this.count).padStart(2, '0');
    const logFile = path.join(this.logDir, `${n}-${def.id}.log`);
    const label = `[${n}] ${def.title}`;

    const blocker = (def.needs || []).find((id) => this.status(id) !== 'pass');
    if (blocker) {
      const detail = `needs "${blocker}", which ${this.status(blocker) === 'skip' ? 'was skipped' : this.status(blocker) ? 'failed' : 'did not run'}`;
      console.log(`SKIP  ${label} (${detail})`);
      this.results.push({ id: def.id, title: def.title, status: 'skip', ms: 0, detail, logFile: null });
      return 'skip';
    }

    console.log(`....  ${label}`);
    const started = Date.now();
    this.runningStep = { id: def.id, title: def.title, started, logFile };
    let status = 'pass';
    let detail = '';

    if (def.fn) {
      fs.writeFileSync(logFile, `${def.title}\n\n`);
      const log = (line = '') => {
        fs.appendFileSync(logFile, `${line}\n`);
        if (this.echo) console.log(`      ${line}`);
      };
      try {
        detail = (await def.fn({ log, logFile, logDir: this.logDir, runner: this })) || '';
      } catch (err) {
        status = 'fail';
        detail = err.message.split('\n')[0];
        log('');
        log(`FAILED: ${err.stack || err.message}`);
      }
    } else {
      const result = await runLogged({
        command: def.command,
        args: def.args,
        cwd: def.cwd,
        env: def.env || process.env,
        shell: def.shell,
        logFile,
        timeoutMs: def.timeoutMs,
        echo: this.echo,
        register: (child) => { this.current = child; },
        onRunning: (ms) => console.log(`      ... still running (${formatDuration(ms)})`),
      });
      this.current = null;
      if (result.error) {
        status = 'fail';
        detail = `could not start ${def.command}: ${result.error.message}`;
        fs.appendFileSync(logFile, `\n${detail}\n`);
      } else if (result.timedOut) {
        status = 'fail';
        detail = `timed out after ${formatDuration(def.timeoutMs)}`;
      } else if (result.code !== 0) {
        status = 'fail';
        detail = result.signal ? `killed by ${result.signal}` : `exit code ${result.code}`;
      }
    }

    const ms = Date.now() - started;
    this.results.push({ id: def.id, title: def.title, status, ms, detail, logFile });
    if (status === 'pass') {
      console.log(`PASS  ${label} (${formatDuration(ms)})${detail ? ` -- ${detail}` : ''}`);
    } else {
      console.log(`FAIL  ${label} (${formatDuration(ms)}) -- ${detail}`);
      if (!this.echo) {
        const lines = tail(logFile);
        if (lines) {
          console.log(`      ---- last lines of ${logFile} ----`);
          for (const line of lines.split('\n')) console.log(`      | ${line}`);
          console.log('      ----');
        }
      }
      console.log(`      Full log: ${logFile}`);
      if (def.hint) for (const line of def.hint.split('\n')) console.log(`      Hint: ${line}`);
    }
    return status;
  }

  /**
   * Stop whatever step is running (Ctrl+C), and record it as failed: a run
   * that was cut short must never read as a pass, whatever finished before.
   */
  abort() {
    this.interrupted = true;
    if (this.current) killTree(this.current);
    const running = this.runningStep;
    if (running && !this.results.some((r) => r.id === running.id)) {
      this.results.push({ id: running.id, title: running.title, status: 'fail', ms: Date.now() - running.started, detail: 'interrupted', logFile: running.logFile });
    }
  }

  /**
   * Print the summary table and write it, with `facts`, to summary.txt and
   * summary.json in the log directory.  Returns true when every step passed
   * and the run was not interrupted.
   */
  finish(facts = {}) {
    const ok = !this.interrupted && this.results.length > 0 && this.results.every((r) => r.status === 'pass');
    const lines = [];
    lines.push(`${this.title}: ${ok ? 'PASSED' : this.interrupted ? 'INTERRUPTED (not a pass)' : 'FAILED'}`);
    for (const [key, value] of Object.entries(facts)) lines.push(`  ${`${key}:`.padEnd(12)} ${value}`);
    lines.push('');
    for (const r of this.results) {
      lines.push(`  ${r.status.toUpperCase().padEnd(5)} ${r.title.padEnd(52)} ${formatDuration(r.ms).padStart(7)}${r.status !== 'pass' && r.detail ? `  ${r.detail}` : ''}`);
    }
    lines.push('');
    lines.push(`  Logs: ${this.logDir}`);
    const text = lines.join('\n');

    console.log('');
    console.log('='.repeat(78));
    console.log(text);
    console.log('='.repeat(78));

    fs.writeFileSync(path.join(this.logDir, 'summary.txt'), `${text}\n`);
    fs.writeFileSync(path.join(this.logDir, 'summary.json'), `${JSON.stringify({
      ok, facts, finished: new Date().toISOString(),
      steps: this.results.map((r) => ({ ...r, logFile: r.logFile && path.relative(this.logDir, r.logFile) })),
    }, null, 2)}\n`);
    return ok;
  }
}

/** A short description of this machine, for the summary. */
function describeMachine() {
  let osName = `${os.type()} ${os.release()}`;
  if (process.platform === 'darwin') {
    const version = capture('sw_vers', ['-productVersion']);
    if (version) osName = `macOS ${version}`;
  } else if (process.platform === 'linux') {
    try {
      const release = fs.readFileSync('/etc/os-release', 'utf8');
      const pretty = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (pretty) osName = pretty[1];
    } catch { /* keep the kernel description */ }
  } else if (process.platform === 'win32') {
    osName = `Windows ${os.release()}`;
  }
  return `${osName} (${process.arch})`;
}

/**
 * On Linux, make sure there is a display for Electron to open a window on.
 *
 * Returns how to run a GUI command: `{ prefix: [] }` when a display is there,
 * `{ prefix: ['xvfb-run', '-a'] }` when there is none but xvfb-run is
 * installed, or `{ error }` when there is neither.
 */
function displayWrapper() {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return { prefix: [] };
  if (capture('sh', ['-c', 'command -v xvfb-run'])) return { prefix: ['xvfb-run', '-a'] };
  return {
    error: 'There is no display (DISPLAY is not set) and xvfb-run is not installed, so the desktop app cannot\n'
      + 'open a window.  Install it (Debian/Ubuntu: sudo apt install xvfb; Fedora: sudo dnf install\n'
      + 'xorg-x11-server-Xvfb) or run this from a desktop session.',
  };
}

module.exports = {
  StepRunner, runLogged, npm, capture, killTree, tail, formatDuration, timestamp, describeMachine, displayWrapper,
};
