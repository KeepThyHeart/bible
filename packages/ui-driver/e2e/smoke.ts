/**
 * End-to-end smoke test: drives the real CLI the way an agent would, against the
 * built web and desktop apps (nothing is built here).
 *
 *   node e2e/smoke.ts [web|desktop]     default: both, one after the other
 *
 * Prints one line per step with the reply size in chars; exits 1 with the
 * offending reply on the first failure. `stop` always runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkgDir = join(import.meta.dirname, '..');

interface AppSpec {
  name: 'web' | 'desktop';
  /** A button that exists in the app, found by text. */
  find: string;
  /** Desktop opens first-run dialogs (language, then online/offline); click these buttons first, in order. */
  dismiss?: string[];
}
const APPS: AppSpec[] = [
  { name: 'web', find: 'Settings' },
  { name: 'desktop', find: 'Preferences', dismiss: ['Continue', 'Stay offline'] },
];

class StepFailure extends Error {}

function run(dir: string, argv: string[]): { ok: boolean; text: string } {
  const r = spawnSync(process.execPath, ['bin/drive.ts', ...argv], {
    cwd: pkgDir,
    env: { ...process.env, DRIVE_DIR: dir },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const text = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\n+$/, '');
  return { ok: r.status === 0, text };
}

function smokeApp(app: AppSpec): void {
  const dir = mkdtempSync(join(tmpdir(), `drive-smoke-${app.name}-`));
  // Ctrl-C / kill: stop the app and remove the temp dir even though the steps are synchronous.
  const onExit = () => {
    try { run(dir, ['stop']); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  };
  process.on('exit', onExit);
  const onSignal = (code: number) => () => process.exit(code);
  process.on('SIGINT', onSignal(130));
  process.on('SIGTERM', onSignal(143));
  const step = (label: string, argv: string[], check?: (text: string) => string | undefined): string => {
    const t0 = Date.now();
    const r = run(dir, argv);
    const problem = !r.ok ? 'command failed' : check?.(r.text);
    console.log(`${app.name.padEnd(7)} ${label.padEnd(22)} ${String(r.text.length).padStart(6)} chars  ${((Date.now() - t0) / 1000).toFixed(1)}s${problem ? '  FAIL' : ''}`);
    if (problem) throw new StepFailure(`${app.name}: step "${label}" failed: ${problem}\n--- reply ---\n${r.text}`);
    return r.text;
  };
  /** Ref of the first line of `find` output that is a button. */
  const findButton = (text: string): string => {
    const out = step(`find ${text}`, ['find', text, '--role', 'button'], (t) => (/\[r\d+\]/.test(t) ? undefined : 'no ref in find output'));
    return /\[(r\d+)\]/.exec(out)![1];
  };
  const pathIn = (re: RegExp, text: string): string => {
    const m = re.exec(text);
    if (!m) throw new StepFailure(`${app.name}: no path in reply\n--- reply ---\n${text}`);
    return m[1];
  };

  try {
    step('start', ['start', app.name], (t) => (/^started /.test(t) ? undefined : 'reply does not start with "started"'));
    step('snapshot', ['snapshot'], (t) => (!t.includes('[r1]') ? 'no [r1]' : t.length >= 8000 ? `reply too long (${t.length})` : undefined));

    for (const label of app.dismiss ?? []) {
      const probe = run(dir, ['find', label, '--role', 'button']);
      if (/\[r\d+\]/.test(probe.text)) step(`click ${label}`, ['click', findButton(label)]);
    }

    const ref = findButton(app.find);
    step(`click ${ref}`, ['click', ref]);
    step('diff', ['diff']);
    step('errors', ['errors']);
    step('check', ['check']);
    const shot = pathIn(/^saved (.+)$/m, step('screenshot', ['screenshot'], (t) => (/^saved /m.test(t) ? undefined : 'no "saved" line')));
    if (!existsSync(shot)) throw new StepFailure(`${app.name}: screenshot file missing: ${shot}`);
    const spec = pathIn(/^wrote (.+?) \(/m, step('log --playwright', ['log', '--playwright'], (t) => (/^wrote /m.test(t) ? undefined : 'no "wrote" line')));
    if (!existsSync(spec)) throw new StepFailure(`${app.name}: repro file missing: ${spec}`);
    if (!readFileSync(spec, 'utf8').includes('test(')) throw new StepFailure(`${app.name}: repro file has no test(`);
  } finally {
    const stop = run(dir, ['stop']);
    console.log(`${app.name.padEnd(7)} ${'stop'.padEnd(22)} ${String(stop.text.length).padStart(6)} chars${stop.ok ? '' : '  FAIL'}`);
    const status = run(dir, ['status']);
    const gone = status.text.includes('not running');
    console.log(`${app.name.padEnd(7)} ${'status'.padEnd(22)} ${String(status.text.length).padStart(6)} chars${gone ? '' : '  FAIL'}`);
    rmSync(dir, { recursive: true, force: true });
    process.off('exit', onExit);
    if ((!stop.ok || !gone) && process.exitCode === undefined) {
      console.error(`${app.name}: stop/status failed\nstop: ${stop.text}\nstatus: ${status.text}`);
      process.exitCode = 1;
    }
  }
}

const which = process.argv[2];
const chosen = APPS.filter((a) => !which || a.name === which);
if (!chosen.length) {
  console.error('usage: node e2e/smoke.ts [web|desktop]');
  process.exit(2);
}
for (const app of chosen) {
  try {
    smokeApp(app);
  } catch (e) {
    console.error(e instanceof StepFailure ? e.message : e);
    process.exit(1);
  }
}
if (process.exitCode) process.exit(process.exitCode);
console.log('smoke ok');
