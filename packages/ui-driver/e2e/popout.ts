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
 * only when no Bible is installed; with a real data dir the verse text is required).
 * With a real data dir (BIBLE_DESKTOP_DATA_DIR, or apps/desktop/data) it also checks that: clicking "Go to verse"
 * in the popped-out window opens the passage in the main window; a theme chosen in the main window reaches the
 * open pop-out live and a pop-out opened afterwards; closing the pop-out docks the Notes pane back.
 *
 * Skips (exit 0, says why) when the desktop build or a display is missing, like nothing was run.
 * Uses a throwaway profile; with no `apps/desktop/data/main.db` it points the app at an empty data dir
 * (BIBLE_DESKTOP_DATA_DIR), so no installed Bible is needed. Prints one line per step; exits 1 with the
 * offending reply on the first failure. `stop` always runs.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
const EXT_FIXTURE = join(desktopDir, 'e2e', 'fixtures', 'test-extension');
const dataDir = env.BIBLE_DESKTOP_DATA_DIR ?? join(desktopDir, 'data');
const realBible = existsSync(join(dataDir, 'main.db'));
if (!realBible && !env.BIBLE_DESKTOP_DATA_DIR) {
  env.BIBLE_DESKTOP_DATA_DIR = join(dir, 'data');
  mkdirSync(join(dir, 'data', 'modules'), { recursive: true });
  // The fixture extension (it contributes a panel) installs by being in data/extensions/<id>/.
  cpSync(EXT_FIXTURE, join(dir, 'data', 'extensions', 'ext.test.bible-viewer'), { recursive: true });
}
if (realBible && !env.BIBLE_DESKTOP_DATA_DIR) {
  // The driver defaults to the committed fixture when no data dir is given; this check wants the real data.
  env.BIBLE_DESKTOP_DATA_DIR = dataDir;
}
// Ctrl-C / kill: the synchronous steps below cannot run handlers, so make the exit path stop the app and
// remove the temp dir (the 'exit' event also fires for process.exit from these handlers).
process.on('exit', () => {
  try { spawnSync(process.execPath, ['bin/drive.ts', 'stop'], { cwd: pkgDir, env, timeout: 30_000 }); } catch { /* best effort */ }
  rmSync(dir, { recursive: true, force: true });
});
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
const hasExtension = existsSync(join(env.BIBLE_DESKTOP_DATA_DIR ?? dataDir, 'extensions', 'ext.test.bible-viewer'));

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

/** Index of the newest open window (the last `pages` row that is not closed). */
function lastPage(): number {
  const rows = run(['pages']).text.split('\n').filter((l) => /^\d+\*? /.test(l) && !/\(closed\)/.test(l));
  return Number(/^(\d+)/.exec(rows[rows.length - 1] ?? '0')![1]);
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
  step('type text', ['type', editor, 'alpha beta alpha gamma see John 3:16 now and Romans 8:28 too'], expectIn('alpha beta', 'text'));

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
  step('page 1', ['page', '1'], expectIn('Popout Test', 'detached window titled for the note'));
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
  if (realBible) {
    const notFound = run(['find', 'Verse not found']);
    if (/\[r\d+\]/.test(notFound.text)) throw new StepFailure('preview says "Verse not found" although a Bible is installed');
    // John 3:16 (KJV and most modules) contains "so loved the world".
    waitFor('preview shows verse text', ['find', 'loved'], (t) => /\[r\d+\]/.test(t));
  }

  if (realBible) {
    // Clicking a reference in the popped-out window opens the passage in the MAIN window's Bible pane
    // (a popped-out notes window has no Bible pane; the click used to log "dockviewApi is null").
    const romans = /\[(r\d+)\] clickable "Romans 8:28"/.exec(run(['find', 'Romans 8:28']).text)?.[1];
    if (!romans) throw new StepFailure('no clickable "Romans 8:28" in the popped-out window');
    step('hover Romans 8:28', ['hover', romans]);
    waitFor('Romans preview', ['find', 'Go to verse', '--role', 'button'], (t) => t.includes('Romans 8:28'));
    step('Go to verse', ['click', ref('Go to verse', 'button')]);
    step('main window', ['page', '0']);
    waitFor('main window opened Romans 8', ['find', 'Romans 8', '--role', 'tab'], (t) => /\[r\d+\]/.test(t));
    step('back to pop-out', ['page', String(lastPage())]);

    // Tab on a reference expands it into verse text. A pop-out has no Bible pane of its own, so it used to
    // refuse ("Open a Bible translation first."); it now uses the main window's translation.
    const noteBox = ref('Note text', 'textbox');
    step('focus note', ['click', noteBox]);
    step('caret to end', ['press', 'Control+End']);
    step('type a reference', ['type', noteBox, ' Ps 23:1'], expectIn('Ps 23:1', 'typed reference'));
    const tab = step('Tab expands', ['press', 'Tab']);
    if (/Open a Bible translation first/.test(tab) || /Open a Bible translation first/.test(run(['snapshot']).text)) {
      throw new StepFailure('Tab on a reference says "Open a Bible translation first." in the pop-out');
    }
    // The format picker opens over the reference; Enter inserts with its default format: real verse text.
    waitFor('expand picker opens', ['find', 'Expand verse reference'], (t) => /dialog/.test(t), 8000);
    step('Insert', ['press', 'Enter']);
    waitFor('verse text in the note', ['find', 'shepherd'], (t) => /\[r\d+\]/.test(t), 8000);

    // Theme: a change in the main window reaches the open pop-out ...
    const themeOf = () => JSON.parse(run(['eval', "document.documentElement.getAttribute('data-theme')"]).text) as string | null;
    const setMainTheme = (name: string) => {
      step('main window', ['page', '0']);
      step('open Preferences', ['click', ref('Preferences (app settings)', 'button')]);
      step('Themes', ['click', ref('Themes', 'tab')]);
      step(`theme ${name}`, ['click', ref(name, 'button')]);
      step('close Preferences', ['click', ref('Done', 'button')]);
    };
    setMainTheme('Midnight');
    step('pop-out window', ['page', String(lastPage())]);
    waitFor('pop-out follows the theme', ['eval', "document.documentElement.getAttribute('data-theme')"], (t) => t === '"midnight"');

    // ... and a pop-out opened afterwards starts on it. Closing the window docks the pane back.
    step('close pop-out', ['closepage', String(lastPage())]);
    waitFor('Notes docked back', ['find', 'Popout Test'], (t) => /\[r\d+\]/.test(t));
    step('open the note', ['click', ref('Popout Test', 'button')]);
    step('pop out again', ['click', ref('Pop out to separate window', 'button')]);
    waitFor('second pop-out', ['pages'], (t) => /detached\.html/.test(t.split('\n').filter((l) => !/closed/.test(l)).pop() ?? ''));
    step('pop-out window', ['page', String(lastPage())]);
    waitFor('new pop-out starts on the theme', ['eval', "document.documentElement.getAttribute('data-theme')"], (t) => t === '"midnight"');
    if (themeOf() !== 'midnight') throw new StepFailure('theme is not midnight in the second pop-out');

    // Ctrl+F in a popped-out Bible pane (the find bar used to exist only in the main window).
    step('main window', ['page', '0']);
    step('Bible tab menu', ['click', ref('Romans 8', 'tab'), '--right']);
    step('pop out the Bible pane', ['click', ref('Pop Out to Window', 'menuitem')]);
    waitFor('Bible pop-out', ['pages'], (t) => /Romans 8/.test(t));
    step('Bible window', ['page', String(lastPage())]);
    waitFor('Bible text in pop-out', ['find', 'Select Romans 8:28', '--role', 'button'], (t) => /\[r\d+\]/.test(t));
    step('Ctrl+F in Bible pop-out', ['press', 'Control+f'], expectIn('Find in page', 'Bible find bar'));
    step('find "God"', ['type', ref('Find in page', 'textbox'), 'God'], expectIn(/\d+ \/ \d+/, 'match counter'));
    step('Escape closes', ['press', 'Escape'], () => undefined);
    if (!absent('Find in page', 'textbox')) throw new StepFailure('Bible find bar still open after Escape');
  }

  if (hasExtension) {
    // An extension panel's tab menu offers Pop Out to Window too (it used to be missing: the menu's check
    // looked the content type up directly, so no `ext:` panel ever matched).
    step('main window', ['page', '0']);
    const tabs = run(['find', 'New tab', '--role', 'button']).text.split('\n').filter((l) => /^\[r\d+\]/.test(l));
    step('new tab', ['click', /^\[(r\d+)\]/.exec(tabs[tabs.length - 1])![1]]);
    step('open the extension panel', ['click', ref('Test Bible Viewer', 'button')]);
    step('extension tab menu', ['click', ref('Test Bible Viewer', 'tab'), '--right']);
    const before = run(['pages']).text.split('\n').length;
    step('pop out the extension panel', ['click', ref('Pop Out to Window', 'menuitem')]);
    waitFor('extension pop-out window', ['pages'], (t) => t.split('\n').length > before && /Test Bible Viewer/.test(t));
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
