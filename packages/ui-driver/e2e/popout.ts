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
 * Live sync: the note open in both windows follows a save made in the other without a banner; both windows dirty
 * raises the banner at once in the window that did not save (and none in the one that did).
 * With a real data dir (BIBLE_DESKTOP_DATA_DIR, or apps/desktop/data) it also checks that: clicking "Go to verse"
 * in the popped-out window opens the passage in the main window; a theme chosen in the main window reaches the
 * open pop-out live and a pop-out opened afterwards; closing the pop-out docks the Notes pane back.
 *
 * Skips (exit 0, says why) when the desktop build or a display is missing, like nothing was run.
 * Uses a throwaway profile and, unless BIBLE_DESKTOP_DATA_DIR is set, a copy of the committed fixture data
 * (fixtures/bible-data) plus the fixture extension, so the verse steps run with no real data installed. Prints one line per step; exits 1 with the
 * offending reply on the first failure. `stop` always runs.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyFixture } from '../../../fixtures/bible-data/copy.mjs';

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
// A Bible is installed in every mode: the committed fixture (KJV for John 3, Romans 8, Ps 23, ...) unless a real data dir is given.
const realBible = true;
if (!env.BIBLE_DESKTOP_DATA_DIR) {
  // A copy of the committed fixture plus the fixture extension (it contributes a panel; an extension installs by
  // being in data/extensions/<id>/). The keyword index stays inside the copy, so it is deleted with it.
  env.BIBLE_DESKTOP_DATA_DIR = join(dir, 'data');
  env.BIBLE_KEYWORD_INDEX_DIR = join(dir, 'data', 'index', 'keyword');
  copyFixture(join(dir, 'data'));
  cpSync(EXT_FIXTURE, join(dir, 'data', 'extensions', 'ext.test.bible-viewer'), { recursive: true });
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

/** With QA_SHOTS=/dir set, one screenshot of the current window (demo for the QA-polish task). */
function shot(name: string): void {
  if (process.env.QA_SHOTS) run(['screenshot', '--path', join(process.env.QA_SHOTS, `${name}.png`)]);
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
  shot('13-popout-no-popout-button');

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

  // Live note sync (item 22): the same note open in the main window and the pop-out follows saves made in the
  // other window with no banner; both windows holding unsaved edits raise the banner in the window that did NOT save.
  {
    const popWin = String(lastPage());
    const NOTE = '[role=textbox][aria-label^="Note text"]';
    // The editor store catches up with a DOM edit a moment later, so a save waits 500 ms after typing.
    const edit = (text: string, save: boolean): boolean => JSON.parse(run(['eval',
      `(async()=>{const e=document.querySelector('${NOTE}');if(!e)return false;e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,${JSON.stringify(text)});${save ? "await new Promise(r=>setTimeout(r,500));document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}));" : ''}return true})()`]).text) as boolean;
    const noteText = (): string => JSON.parse(run(['eval', `(document.querySelector('${NOTE}')||{}).innerText||''`]).text) as string;
    const banner = (): boolean => JSON.parse(run(['eval', "document.body.innerText.includes('changed in another window')"]).text) as boolean;

    step('main window', ['page', '0']);
    step('open the note in the main window too', ['click', ref('Popout Test', 'button')]);
    waitFor('note editor in main', ['find', 'Note text', '--role', 'textbox'], (t) => /\[r\d+\]/.test(t));
    if (!edit(' LIVE1', true)) throw new StepFailure('could not type into the main window note');
    step('pop-out window', ['page', popWin]);
    waitFor('save in main reaches the pop-out', ['eval', `(document.querySelector('${NOTE}')||{}).innerText||''`], (t) => t.includes('LIVE1'), 10_000);
    if (banner()) throw new StepFailure('pop-out shows the conflict banner after a clean live update');
    console.log(`${'live sync: main -> pop-out'.padEnd(34)} ok`);
    step('main window', ['page', '0']);
    if (!noteText().includes('LIVE1') || banner()) throw new StepFailure('main window changed or shows a banner after its own save');

    // Both windows dirty: the main window types, the pop-out types, then the main window saves. The notes autosave
    // ticks every 2 s, so an unlucky tick can save the main window's edit before the pop-out has typed (the two
    // then merge cleanly); try again, each attempt starts from synced windows.
    const saveNow = (): void => { run(['eval', "document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))"]); };
    let conflictSeen = false;
    for (let attempt = 1; attempt <= 4 && !conflictSeen; attempt++) {
      step('main window', ['page', '0']);
      if (!edit(` MAIN${attempt}`, false)) throw new StepFailure('could not type into the main window note');
      step('pop-out window', ['page', popWin]);
      if (!edit(` POP${attempt}`, false)) throw new StepFailure('could not type into the pop-out note');
      step('main window', ['page', '0']);
      saveNow();
      step('pop-out window', ['page', popWin]);
      const end = Date.now() + 5000;
      while (Date.now() < end && !(conflictSeen = banner())) spawnSync('sleep', ['0.3']);
      if (conflictSeen) {
        shot('22-live-note-sync-banner');
        step('main window', ['page', '0']);
        if (banner()) throw new StepFailure('the saving window shows the conflict banner');
        console.log(`${'live sync: both dirty -> banner'.padEnd(34)} ok (attempt ${attempt})`);
      } else {
        // Settle: wait until both windows hold the same text again before the next attempt.
        spawnSync('sleep', ['3']);
      }
    }
    if (!conflictSeen) throw new StepFailure('both windows dirty: the window that did not save never showed the conflict banner');
    step('pop-out window', ['page', popWin]);
  }

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
    shot('11-popout-reference-hover');
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
    // The main window opened the note again for the live-sync steps, so it may already be in the editor.
    if (!absent('Popout Test', 'button')) step('open the note', ['click', ref('Popout Test', 'button')]);
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
