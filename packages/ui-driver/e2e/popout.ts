/**
 * End-to-end check of popped-out windows on the built desktop app: a note is opened, the notes pane is
 * popped out to its own window (`pages`, `page 1`), and the window is driven there.
 *
 *   node e2e/popout.ts          (Linux without a display: xvfb-run -a node e2e/popout.ts)
 *
 * Covers: the pop-out button exists in the main window and is absent in the popped-out notes window;
 * the editor toolbar there (indent / outdent buttons change the note and the Decrease button's enabled
 * state); Ctrl+F opens the note find bar, counts and steps matches, and Escape closes it; hovering a
 * verse reference opens the preview popup (verse text when a Bible is installed, "Verse not found"
 * only when no Bible is installed; with apps/desktop/data/main.db present the verse text is required).
 *
 * Skips (exit 0, says why) when the desktop build or a display is missing, like nothing was run.
 * Uses a throwaway profile; with no `apps/desktop/data/main.db` it points the app at an empty data dir
 * (BIBLE_DESKTOP_DATA_DIR), so no installed Bible is needed. Prints one line per step; exits 1 with the
 * offending reply on the first failure. `stop` always runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkgDir = join(import.meta.dirname, '..');
const repoRoot = join(pkgDir, '..', '..');
const desktopDir = join(repoRoot, 'apps', 'desktop');

class StepFailure extends Error {}

const skip = (why: string): never => {
  console.log(`popout: skipped (${why})`);
  process.exit(0);
};

if (!existsSync(join(desktopDir, 'out', 'main', 'index.js'))) skip('desktop is not built: pnpm run build:desktop');
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) skip('no display: run under xvfb-run -a');

const dir = mkdtempSync(join(tmpdir(), 'drive-popout-'));
const env: NodeJS.ProcessEnv = { ...process.env, DRIVE_DIR: dir };
if (!existsSync(join(desktopDir, 'data', 'main.db')) && !env.BIBLE_DESKTOP_DATA_DIR) {
  env.BIBLE_DESKTOP_DATA_DIR = join(dir, 'data');
  mkdirSync(join(dir, 'data', 'modules'), { recursive: true });
}

function run(argv: string[]): { ok: boolean; text: string } {
  const r = spawnSync(process.execPath, ['bin/drive.ts', ...argv], { cwd: pkgDir, env, encoding: 'utf8', timeout: 120_000 });
  return { ok: r.status === 0, text: ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\n+$/, '') };
}

function step(label: string, argv: string[], check?: (text: string) => string | undefined): string {
  const t0 = Date.now();
  const r = run(argv);
  const problem = !r.ok ? 'command failed' : check?.(r.text);
  console.log(`${label.padEnd(34)} ${String(r.text.length).padStart(6)} chars  ${((Date.now() - t0) / 1000).toFixed(1)}s${problem ? '  FAIL' : ''}`);
  if (problem) throw new StepFailure(`step "${label}" failed: ${problem}\n--- reply ---\n${r.text}`);
  return r.text;
}

/** The last `find` line whose role matches and whose text contains `name`; its ref. */
function ref(name: string, role: string): string {
  const out = step(`find ${role} ${name}`, ['find', name, '--role', role], (t) => (/\[r\d+\]/.test(t) ? undefined : `no ${role} "${name}"`));
  const lines = out.split('\n').filter((l) => /^\[r\d+\]/.test(l));
  return /^\[(r\d+)\]/.exec(lines[lines.length - 1])![1];
}

/** True when `find` sees no such element (never fails the step). */
const absent = (name: string, role: string): boolean => !/\[r\d+\]/.test(run(['find', name, '--role', role]).text);

const expectIn = (needle: string | RegExp, what: string) => (t: string) =>
  (typeof needle === 'string' ? t.includes(needle) : needle.test(t)) ? undefined : `${what} not found`;

function waitFor(label: string, argv: string[], ok: (text: string) => boolean, ms = 15_000): string {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    last = run(argv).text;
    if (ok(last)) {
      console.log(`${label.padEnd(34)} ok`);
      return last;
    }
    spawnSync('sleep', ['0.5']);
  }
  throw new StepFailure(`waiting for ${label} timed out\n--- last reply ---\n${last}`);
}

try {
  step('start desktop', ['start', 'desktop'], expectIn(/^started /, 'started line'));
  for (const label of ['Continue', 'Stay offline']) {
    if (!absent(label, 'button')) step(`click ${label}`, ['click', ref(label, 'button')]);
  }

  // A note in a Notes pane of the main window.
  const newTabs = run(['find', 'New tab', '--role', 'button']).text.split('\n').filter((l) => /^\[r\d+\]/.test(l));
  if (!newTabs.length) throw new StepFailure('no "New tab" button in the main window');
  step('new tab', ['click', /^\[(r\d+)\]/.exec(newTabs[newTabs.length - 1])![1]]);
  step('open Notes', ['click', ref('Notes', 'button')]);
  if (!absent('Use This Folder', 'button')) step('accept notes folder', ['click', ref('Use This Folder', 'button')]);
  step('new note', ['click', ref('New Note', 'button')]);
  step('title', ['fill', ref('Title', 'textbox'), 'Popout Test']);
  step('create', ['click', ref('Create', 'button')]);
  const editor = ref('Note text', 'textbox');
  step('type text', ['type', editor, 'alpha beta alpha gamma see John 3:16 now'], expectIn('John 3:16', 'text'));

  // The editor toolbar (main window): indent enables outdent.
  const dec = run(['find', 'Decrease Indent', '--role', 'button']).text;
  if (!/disabled/.test(dec)) throw new StepFailure(`Decrease Indent should start disabled\n${dec}`);
  step('Increase Indent', ['click', ref('Increase Indent', 'button')]);
  const dec2 = run(['find', 'Decrease Indent', '--role', 'button']).text;
  if (/disabled/.test(dec2)) throw new StepFailure(`Decrease Indent still disabled after indenting\n${dec2}`);
  step('pop-out button in main window', ['find', 'Pop out to separate window', '--role', 'button'], expectIn('Pop out', 'pop-out button'));

  // Pop out and drive the new window.
  step('pop out', ['click', ref('Pop out to separate window', 'button')]);
  waitFor('second window', ['pages'], (t) => /detached\.html/.test(t));
  step('page 1', ['page', '1'], expectIn('Detached Pane', 'detached window'));
  waitFor('note in popped-out window', ['find', 'Note text', '--role', 'textbox'], (t) => /alpha beta alpha gamma/.test(t));

  if (!absent('Pop out to separate window', 'button')) throw new StepFailure('pop-out button is present in the popped-out notes window');
  console.log(`${'no pop-out button in pop-out'.padEnd(34)} ok`);

  // Toolbar in the popped-out window; the indent persisted through the hand-over.
  const dec3 = run(['find', 'Decrease Indent', '--role', 'button']).text;
  if (!/\[r\d+\]/.test(dec3)) throw new StepFailure('no Decrease Indent button in the popped-out window');
  if (/disabled/.test(dec3)) throw new StepFailure(`the indent was lost in the pop-out (Decrease Indent disabled)\n${dec3}`);
  step('Decrease Indent', ['click', ref('Decrease Indent', 'button')]);
  if (!/disabled/.test(run(['find', 'Decrease Indent', '--role', 'button']).text)) throw new StepFailure('Decrease Indent not disabled after outdenting');
  step('Increase Indent', ['click', ref('Increase Indent', 'button')]);
  step('Bold toggles', ['click', ref('Bold', 'button')], () => undefined);
  step('Bold toggles back', ['click', ref('Bold', 'button')], () => undefined);

  // Ctrl+F in the note.
  step('focus editor', ['click', ref('Note text', 'textbox')]);
  step('Ctrl+F', ['press', 'Control+f'], expectIn('Find in page', 'note find bar'));
  const box = ref('Find in page', 'textbox');
  step('find alpha', ['type', box, 'alpha'], expectIn('1 / 2', 'match counter "1 / 2"'));
  step('Enter steps', ['press', 'Enter'], expectIn('2 / 2', 'match counter "2 / 2"'));
  step('Escape closes', ['press', 'Escape'], expectIn('- [r', 'find bar removed'));
  if (!absent('Find in page', 'textbox')) throw new StepFailure('find bar still open after Escape');

  // Reference hover.
  const refs = step('find reference', ['find', 'John 3:16'], expectIn('clickable', 'reference element'));
  const refRef = /\[(r\d+)\] clickable "John 3:16"/.exec(refs)?.[1];
  if (!refRef) throw new StepFailure(`no clickable "John 3:16"\n${refs}`);
  step('hover reference', ['hover', refRef]);
  waitFor('preview popup', ['find', 'Alt+Click'], (t) => t.includes('dialog'));
  step('preview names the verse', ['find', 'Go to verse', '--role', 'button'], expectIn('John 3:16', 'popup title'));
  // With a Bible installed the hover must show the verse itself, never "Verse not found".
  if (existsSync(join(desktopDir, 'data', 'main.db'))) {
    const notFound = run(['find', 'Verse not found']);
    if (/\[r\d+\]/.test(notFound.text)) throw new StepFailure('preview says "Verse not found" although a Bible is installed');
    // John 3:16 (KJV and most modules) contains "so loved the world".
    waitFor('preview shows verse text', ['find', 'loved'], (t) => /\[r\d+\]/.test(t));
  }
  step('errors', ['errors']);
} catch (e) {
  console.error(e instanceof StepFailure ? e.message : e);
  process.exitCode = 1;
} finally {
  const stop = run(['stop']);
  console.log(`${'stop'.padEnd(34)} ${String(stop.text.length).padStart(6)} chars${stop.ok ? '' : '  FAIL'}`);
  rmSync(dir, { recursive: true, force: true });
  if (!stop.ok) process.exitCode = 1;
}
if (process.exitCode) process.exit(process.exitCode);
console.log('popout ok');
