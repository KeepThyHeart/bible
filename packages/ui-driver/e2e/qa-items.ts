/**
 * End-to-end checks of the QA-polish items (task 0215) on the built desktop app, driven like an agent would
 * (the `drive` CLI). One check per item; a failing item does not stop the run, the table at the end lists
 * every item and the process exits 1 if any failed. Runs on the committed fixture data (no real Bible data).
 *
 *   node e2e/qa-items.ts                       (Linux without a display: xvfb-run -a node e2e/qa-items.ts)
 *   QA_ONLY=03,05 node e2e/qa-items.ts         only these items
 *   QA_SHOTS=/some/dir node e2e/qa-items.ts    also writes one screenshot per item there (NN-name.png)
 *
 * Items (desktop): 02 commentary Previous/Next across chapters, 03 verse centring, 04 next-chapter scroll,
 * 05 Search/Ideas selector, 06 red letters in results, 07 search preview/pin tabs, 08 graph tooltips in each
 * results placement, 09 commentary verse text, 10 Ideas dedupe (local stub for the online service), 12 notes
 * Ctrl+F, 14 notes indent buttons, 16 tab "+" underline (light and dark), 21 missing module file, 23 Settings
 * tab alignment (several locales, narrowest window). Pop-out items (11, 13, 22) are in popout.ts.
 *
 * Skips (exit 0, says why) when the desktop build or a display is missing. Everything it creates (profile,
 * data copies, stub) is removed at the end and on interrupt.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyFixture } from '../../../fixtures/bible-data/copy.mjs';

const pkgDir = join(import.meta.dirname, '..');
const repoRoot = join(pkgDir, '..', '..');
const desktopDir = join(repoRoot, 'apps', 'desktop');

const skip = (why: string): never => {
  console.log(`qa-items: skipped (${why})`);
  process.exit(0);
};
if (!existsSync(join(desktopDir, 'out', 'main', 'index.js'))) skip('desktop is not built: pnpm run build:desktop');
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) skip('no display: run under xvfb-run -a');

const work = mkdtempSync(join(tmpdir(), 'drive-qaitems-'));
const profile = join(work, 'profile');
mkdirSync(join(profile, 'user-data', 'network'), { recursive: true });
// The app is offline until the user allows web requests; the Ideas stub is a web request.
writeFileSync(join(profile, 'user-data', 'network', 'config.json'), JSON.stringify({ allowNetwork: true }));
const shotsDir = process.env.QA_SHOTS;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const only = process.env.QA_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);

// The stub is a child process: this script blocks on synchronous driver calls and could not answer requests itself.
const stubProc = spawn(process.execPath, [join(import.meta.dirname, 'qa-stub.ts'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const stubUrl = await new Promise<string>((resolve, reject) => {
  stubProc.once('error', reject);
  stubProc.stdout.once('data', (d: Buffer) => {
    const url = /(http:\/\/\S+)/.exec(String(d))?.[1];
    if (url) resolve(url); else reject(new Error('qa stub gave no URL'));
  });
});
const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DRIVE_DIR: work,
  DRIVE_PROFILE_DIR: profile,
  DRIVE_APP_ENV_BIBLE_REMOTE_SEMANTIC_URL: stubUrl,
};
let env: NodeJS.ProcessEnv = baseEnv;

let stopping = false;
const cleanup = (): void => {
  if (stopping) return;
  stopping = true;
  try { spawnSync(process.execPath, ['bin/drive.ts', 'stop'], { cwd: pkgDir, env, timeout: 30_000 }); } catch { /* best effort */ }
  stubProc.kill();
  rmSync(work, { recursive: true, force: true });
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// ---------------------------------------------------------------------------------------------- driver helpers

class Fail extends Error {}

function run(argv: string[]): { ok: boolean; text: string } {
  const r = spawnSync(process.execPath, ['bin/drive.ts', ...argv], { cwd: pkgDir, env, encoding: 'utf8', timeout: 120_000 });
  return { ok: r.status === 0, text: ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\n+$/, '') };
}
const sleep = (s: number): void => { spawnSync('sleep', [String(s)]); };

/** A command that must succeed. */
function step(argv: string[]): string {
  const r = run(argv);
  if (!r.ok) throw new Fail(`${argv.join(' ').slice(0, 80)} failed: ${r.text.split('\n')[0]}`);
  return r.text;
}

/** Evaluate JS in the current page; the JSON result. */
function ev<T = unknown>(js: string): T {
  const r = run(['eval', js]);
  if (!r.ok) throw new Fail(`eval failed: ${r.text.split('\n')[0]}`);
  try { return JSON.parse(r.text) as T; } catch { throw new Fail(`eval gave non-JSON: ${r.text.slice(0, 120)}`); }
}

/** Ref of the last element that `find` lists for `name` (and `role`); undefined when none. */
function findRef(name: string, role?: string): string | undefined {
  const argv = ['find', name];
  if (role) argv.push('--role', role);
  const lines = run(argv).text.split('\n').filter((l) => /^\[r\d+\]/.test(l));
  const m = /^\[(r\d+)\]/.exec(lines[lines.length - 1] ?? '');
  return m?.[1];
}
function ref(name: string, role?: string): string {
  const r = findRef(name, role);
  if (!r) throw new Fail(`no ${role ?? 'element'} "${name}"`);
  return r;
}
const has = (name: string, role?: string): boolean => findRef(name, role) !== undefined;
/** Like `ref`, but only elements whose accessible name starts with `prefix` ("Light" is not "Dark ... low-light"). */
function refStart(prefix: string, role: string): string {
  const lines = run(['find', prefix, '--role', role]).text.split('\n').filter((l) => /^\[r\d+\]/.test(l));
  const hit = lines.find((l) => new RegExp(`^\\[r\\d+\\] [a-z/0-9]+ "${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l));
  const m = /^\[(r\d+)\]/.exec(hit ?? '');
  if (!m) throw new Fail(`no ${role} starting "${prefix}"`);
  return m[1];
}

function waitFor<T>(what: string, probe: () => T | null | undefined | false, ms = 12_000): NonNullable<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = probe();
    if (v) return v as NonNullable<T>;
    sleep(0.4);
  }
  throw new Fail(`timed out waiting for ${what}`);
}

const shotsTaken = new Set<string>();
function shot(name: string, auto = false): void {
  if (!shotsDir || (auto && shotsTaken.has(name))) return;
  shotsTaken.add(name);
  run(['screenshot', '--path', join(shotsDir, `${name}.png`)]);
}

/** Close first-run dialogs and the getting-started banner. */
function settle(): void {
  for (let i = 0; i < 6; i++) {
    const b = ['Continue', 'Stay offline', 'Not now'].find((n) => has(n, 'button'));
    if (!b) break;
    step(['click', ref(b, 'button')]);
    sleep(0.5);
  }
  const dismiss = findRef('Dismiss the getting started', 'button');
  if (dismiss) run(['click', dismiss, '-q']);
}

function startApp(): void {
  const r = run(['start', 'desktop', '--viewport', '1400x900']);
  if (!/^started /m.test(r.text)) throw new Fail(`start failed: ${r.text.slice(0, 200)}`);
  settle();
}

const searchBox = (): string => ref('Search Bible', 'combobox');
function search(text: string): void {
  step(['fill', searchBox(), text, '--enter', '-q']);
  sleep(1.5);
}
function gotoRef(reference: string): void {
  search(reference);
}

/** Open Preferences, pick a section tab, run `fn`, close with Done. */
function inPreferences(section: string | null, fn: () => void): void {
  step(['click', ref('Preferences (app settings)', 'button'), '-q']);
  if (section) step(['click', ref(section, 'tab'), '-q']);
  try { fn(); } finally { const d = findRef('Done', 'button'); if (d) run(['click', d, '-q']); }
}
function setTheme(name: 'Light' | 'Dark'): void {
  inPreferences('Themes', () => step(['click', refStart(name, 'button'), '-q']));
  waitFor(`theme ${name}`, () => ev<string | null>("document.documentElement.getAttribute('data-theme')") === name.toLowerCase());
}
function setPlacement(label: string): void {
  inPreferences('Search', () => step(['click', ref(label, 'radio'), '-q']));
}
function closeSearchPanes(): void {
  for (let i = 0; i < 6; i++) {
    const c = findRef('Close Search Results', 'button');
    if (!c) return;
    run(['click', c, '-q']);
    sleep(0.5);
  }
}
function chooseSearchType(label: 'Search' | 'Ideas Search'): void {
  if (has('Search type', 'button')) {
    step(['click', ref('Search type', 'button'), '-q']);
    step(['click', refStart(label, 'menuitemradio'), '-q']);
  } else {
    // Before the selector existed the mode was switched with a link in the results pane.
    if (!has('Semantic Search', 'button') && !has('Back to Keyword Search', 'button')) search('love');
    const link = label === 'Search' ? findRef('Back to Keyword Search', 'button') : findRef('Semantic Search', 'button');
    if (link) step(['click', link, '-q']);
  }
  sleep(1);
  const agree = waitFor('consent or menu closed', () => findRef('Agree and search', 'button') ?? (has('Search type', 'menu') ? undefined : 'closed'), 3000);
  if (agree !== 'closed') step(['click', agree, '-q']);
  sleep(0.5);
}

// ---------------------------------------------------------------------------------------------- items

interface Result { id: string; name: string; status: 'ok' | 'FAIL'; detail: string }
const results: Result[] = [];
function item(id: string, name: string, fn: () => string | void): void {
  if (only && !only.includes(id)) return;
  let status: Result['status'] = 'ok';
  let detail = '';
  try {
    detail = fn() ?? '';
    shot(`${id}-${name}`, true);
  } catch (e) {
    status = 'FAIL';
    detail = e instanceof Fail ? e.message : String(e);
    shot(`${id}-${name}`, true);
  }
  results.push({ id, name, status, detail });
  console.log(`${id} ${name.padEnd(34)} ${status}${detail ? `  ${detail.split('\n')[0].slice(0, 150)}` : ''}`);
  // Leave nothing modal open for the next item.
  run(['press', 'Escape']);
}

const SCROLL_JS = (label: string): string => `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)});
if(!b)return null;const row=b.closest('.verse-row')||b.parentElement;let p=row.parentElement;while(p&&p.scrollHeight<=p.clientHeight+2)p=p.parentElement;
if(!p)return null;const pr=p.getBoundingClientRect(),r=row.getBoundingClientRect();
return {sel:/verse-selected/.test(row.className),vmid:(r.top+r.height/2-pr.top)/pr.height,inView:r.top>=pr.top-1&&r.bottom<=pr.bottom+1,st:p.scrollTop}})()`;

try {
  startApp();

  item('03', 'verse-centred', () => {
    gotoRef('Psalm 23:1'); // typed from another chapter: the chapter loads, then the verse is selected and centred
    gotoRef('John 3:16');
    waitFor('John 3:16 in the pane', () => ev<{ sel: boolean; vmid: number } | null>(SCROLL_JS('Select John 3:16')));
    sleep(2); // the focus hand-off after the search used to snap the pane back to the chapter heading a moment later
    const s = waitFor('John 3:16 in the pane', () => ev<{ sel: boolean; vmid: number } | null>(SCROLL_JS('Select John 3:16')));
    if (!s.sel) throw new Fail('John 3:16 is not selected');
    if (s.vmid < 0.25 || s.vmid > 0.7) throw new Fail(`John 3:16 is not centred (at ${(s.vmid * 100).toFixed(0)}% of the pane height)`);
    return `centred at ${(s.vmid * 100).toFixed(0)}%`;
  });

  item('04', 'next-chapter-scroll', () => {
    gotoRef('John 3:16');
    waitFor('Next Chapter link', () => findRef('Next Chapter: John 4', 'button'));
    step(['click', ref('Next Chapter: John 4', 'button'), '-q']);
    const top = waitFor('John 4 header', () => ev<number | null>(`(()=>{const h=[...document.querySelectorAll('h2')].find(h=>h.textContent.trim()==='John 4');if(!h)return null;let p=h.parentElement;while(p&&p.scrollHeight<=p.clientHeight+2)p=p.parentElement;if(!p)return null;const pr=p.getBoundingClientRect(),r=h.getBoundingClientRect();return Math.round(r.top-pr.top)})()`));
    if (top < 0 || top > 150) throw new Fail(`the "John 4" header is ${top}px from the pane top (hidden or scrolled past)`);
    return `header ${top}px from the top`;
  });

  item('02', 'commentary-prev-next-chapters', () => {
    gotoRef('John 3:1');
    step(['click', ref('Commentary', 'tab'), '-q']);
    step(['click', ref('Previous verse', 'button'), '-q']);
    // Previous from John 3:1 lands on the last verse of John 2 and brings it into view in the Bible pane.
    const p = waitFor('John 2:25 selected', () => {
      const s = ev<{ sel: boolean; inView: boolean } | null>(SCROLL_JS('Select John 2:25'));
      return s?.sel ? s : undefined;
    });
    if (!p.inView) throw new Fail('John 2:25 is selected but not scrolled into view');
    gotoRef('John 3:36');
    step(['click', ref('Next verse', 'button'), '-q']);
    waitFor('John 4:1 selected', () => ev<{ sel: boolean } | null>(SCROLL_JS('Select John 4:1'))?.sel);
    return 'prev -> John 2:25 in view, next from 3:36 -> John 4:1';
  });

  item('09', 'commentary-verse-text', () => {
    const header = (): string | null => ev<string | null>(`(()=>{const r=[...document.querySelectorAll('[role=region]')].find(e=>e.getAttribute('aria-label')==='Commentary');return r?r.innerText.slice(0,300):null})()`);
    gotoRef('John 3:16');
    step(['click', ref('Commentary', 'tab'), '-q']);
    const head = waitFor('commentary header', header);
    if (!/John 3:16\s+\S+/.test(head) || !/loved the world/.test(head)) throw new Fail(`commentary header has no verse text: ${JSON.stringify(head.slice(0, 120))}`);
    // A pinned commentary stays on John 3:16 while the Bible pane moves on, so the verse is no longer in the
    // pane's loaded chapter (the same situation as a commentary opened from a search result).
    step(['click', refStart('Wesley', 'tab'), '-q']); // the Overview tab has no pin; a module tab does
    step(['click', ref('Pin commentary', 'button'), '-q']);
    gotoRef('Romans 8:28');
    sleep(1.5);
    const pinned = header() ?? '';
    step(['click', ref('Unpin', 'button'), '-q']);
    if (!/John 3:16\s+\S+/.test(pinned) || !/loved the world/.test(pinned)) throw new Fail(`the pinned verse shows no text when the Bible pane is elsewhere: ${JSON.stringify(pinned.slice(0, 120))}`);
    return 'header shows "John 3:16 For God so loved the world...", also when the Bible pane is on Romans 8';
  });

  item('05', 'search-ideas-selector', () => {
    search('love'); // the first Ideas search (here: the switch re-running this one) asks for consent
    waitFor('the selector at the search icon', () => findRef('Search type', 'button'));
    step(['click', ref('Search type', 'button'), '-q']);
    waitFor('both options', () => findRef('Ideas Search', 'menuitemradio') && findRef('Search', 'menuitemradio'));
    shot('05-search-ideas-selector');
    // A real click must reach the option: the menu used to be painted under the panes (click "covered by ...").
    step(['click', ref('Ideas Search', 'menuitemradio'), '-q']);
    const agree = waitFor('consent dialog', () => findRef('Agree and search', 'button'), 4000);
    step(['click', agree, '-q']);
    waitFor('icon shows Ideas', () => /Ideas Search/.test(run(['find', 'Search type', '--role', 'button']).text));
    // Switching from the results pane updates the icon too.
    search('God repaying those who help the poor');
    waitFor('Ideas results', () => findRef('Back to Keyword Search', 'button'));
    step(['click', ref('Back to Keyword Search', 'button'), '-q']);
    waitFor('icon back to keyword', () => { const t = run(['find', 'Search type', '--role', 'button']).text; return t.includes('Search type: Search') && !t.includes('Ideas'); });
    return 'menu clickable, icon follows the results pane link';
  });

  item('10', 'ideas-dedupe', () => {
    chooseSearchType('Ideas Search');
    search('God repaying those who help the poor');
    const list = waitFor('Ideas results', () => /semantic matches found/.test(run(['snapshot', '--all', '--max', '600']).text) ? run(['snapshot', '--all', '--max', '600']).text : undefined);
    const prov = list.split('\n').filter((l) => /button "Proverbs 19:17/.test(l)).length;
    if (prov !== 1) throw new Fail(`Proverbs 19:17 is listed ${prov} times`);
    const total = /list "(\d+) semantic matches found"/.exec(list)?.[1];
    shot('10-ideas-dedupe'); // while the Ideas results are on screen
    chooseSearchType('Search');
    return `Proverbs 19:17 once, ${total} results from 4 stub rows`;
  });

  item('06', 'red-letters-search-results', () => {
    chooseSearchType('Search');
    search('loved');
    const color = waitFor('red words in the results', () => ev<string | null>(`(()=>{const e=[...document.querySelectorAll('.christ-words')].find(e=>!e.closest('.verse-row')&&/gave his only/.test(e.textContent));return e?getComputedStyle(e).color:null})()`));
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(color);
    if (!m || Number(m[1]) < 150 || Number(m[2]) > 90 || Number(m[3]) > 90) throw new Fail(`words of Christ are not red in the results (${color})`);
    return `words of Christ ${color}`;
  });

  item('07', 'search-preview-pinned-tabs', () => {
    closeSearchPanes();
    const tabs = () => ev<string[]>(`[...document.querySelectorAll('[data-search-preview]')].map(e=>e.dataset.searchPreview+'|'+getComputedStyle(e).fontStyle)`);
    search('love');
    search('world');
    const one = tabs();
    if (one.length !== 1 || one[0] !== 'true|italic') throw new Fail(`after two searches expected one italic preview tab, got ${JSON.stringify(one)}`);
    step(['dblclick', ref('Search: world', 'tab')]);
    sleep(0.5);
    if (tabs()[0] !== 'false|normal') throw new Fail(`double-click did not pin the tab: ${JSON.stringify(tabs())}`);
    search('light');
    const two = tabs();
    if (two.length !== 2 || !two.includes('false|normal') || !two.includes('true|italic')) throw new Fail(`after pinning, a new search should add a preview tab: ${JSON.stringify(two)}`);
    return 'preview reused, pinned kept, next search opens a new preview';
  });

  item('08', 'graph-tooltip-all-placements', () => {
    const notes: string[] = [];
    for (const [label, name] of [['Below the Bible', 'below'], ['Tab in the right pane', 'tab'], ['Right side', 'right']] as const) {
      closeSearchPanes();
      setPlacement(label);
      search('loved');
      // A bar with matches ("John — 3 matches"), not an empty book; `find` lists only the first few, so name it first.
      const barLabel = waitFor(`graph bars (${name})`, () => ev<string | null>(`(()=>{const b=[...document.querySelectorAll('button[aria-label*=" — "]')].find(b=>!/no match/.test(b.getAttribute('aria-label')));return b?b.getAttribute('aria-label'):null})()`));
      const bar = ref(barLabel, 'button');
      step(['hover', bar, '-q']);
      const tip = waitFor(`tooltip (${name})`, () => ev<{ body: boolean; pos: string; z: string; inView: boolean } | null>(`(()=>{const t=document.querySelector('[data-testid=distribution-tooltip]');if(!t)return null;const r=t.getBoundingClientRect(),cs=getComputedStyle(t);return {body:t.parentElement===document.body,pos:cs.position,z:cs.zIndex,inView:r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`), 4000);
      if (!tip.body || tip.pos !== 'fixed' || Number(tip.z) < 1000 || !tip.inView) throw new Fail(`tooltip in "${name}" placement is not above everything: ${JSON.stringify(tip)}`);
      shot(`08-graph-tooltip-placement-${name}`); // one frame per placement; stitched into 08-graph-tooltip-all-placements
      notes.push(name);
    }
    closeSearchPanes();
    setPlacement('Below the Bible');
    return `portalled, fixed, z>=1000 in ${notes.join(', ')}`;
  });

  item('16', 'tab-plus-underline', () => {
    const hosts = `[...document.querySelectorAll('.app-add-tab-host')].map(h=>{const g=h.closest('.dv-groupview');const t=g&&g.querySelector('.dv-tab');return {host:getComputedStyle(h).boxShadow,tab:t?getComputedStyle(t).boxShadow:null}})`;
    const out: string[] = [];
    for (const theme of ['Light', 'Dark'] as const) {
      setTheme(theme);
      const rows = ev<Array<{ host: string; tab: string | null }>>(hosts);
      if (rows.length < 2) throw new Fail(`fewer than two tab bars with a "+" (${rows.length})`);
      for (const r of rows) {
        if (!r.host || r.host === 'none') throw new Fail(`${theme}: the "+" host has no underline (box-shadow none)`);
      }
      out.push(`${theme} ${rows.length} bars`);
      shot(theme === 'Light' ? '16-tab-plus-underline' : '16-tab-plus-underline-dark');
    }
    setTheme('Light');
    return out.join(', ');
  });

  item('12', 'notes-find', () => {
    const tabs = run(['find', 'New tab', '--role', 'button']).text.split('\n').filter((l) => /^\[r\d+\]/.test(l));
    if (!tabs.length) throw new Fail('no "New tab" button');
    step(['click', /^\[(r\d+)\]/.exec(tabs[0])![1], '-q']);
    step(['click', refStart('Notes', 'button'), '-q']);
    if (has('Use This Folder', 'button')) step(['click', ref('Use This Folder', 'button'), '-q']);
    step(['click', ref('Sample note', 'button'), '-q']);
    const editor = waitFor('note editor', () => findRef('Note text', 'textbox'));
    step(['click', editor, '-q']);
    step(['press', 'Control+f']);
    const box = waitFor('find bar', () => findRef('Find in page', 'textbox'), 4000);
    step(['type', box, 'fixture', '-q']);
    waitFor('match counter', () => /1 \/ 1/.test(run(['snapshot', '--all', '--max', '600']).text));
    shot('12-notes-find');
    step(['press', 'Escape', '-q']);
    return 'Ctrl+F finds "fixture" in the note (1 / 1)';
  });

  item('14', 'notes-indent-outdent', () => {
    waitFor('note editor', () => findRef('Note text', 'textbox'));
    const dec = () => run(['find', 'Decrease Indent', '--role', 'button']).text;
    if (!/\[r\d+\]/.test(dec())) throw new Fail('no Decrease Indent button');
    if (!has('Increase Indent', 'button')) throw new Fail('no Increase Indent button');
    shot('14-notes-indent-before');
    step(['click', ref('Increase Indent', 'button'), '-q']);
    sleep(0.4);
    shot('14-notes-indent-outdent'); // after indenting
    if (/disabled/.test(dec())) throw new Fail('Decrease Indent still disabled after Increase Indent');
    step(['click', ref('Decrease Indent', 'button'), '-q']);
    sleep(0.4);
    if (!/disabled/.test(dec())) throw new Fail('Decrease Indent not disabled after outdenting');
    return 'indent enables outdent, outdent disables it';
  });

  item('23', 'settings-tab-alignment', () => {
    run(['resize', '800x600']);
    const measure = `(()=>{const tabs=[...document.querySelectorAll('[role=tab]')].filter(e=>e.querySelector('[data-tab-icon]'));return tabs.map(t=>{const tr=t.getBoundingClientRect();const i=t.querySelector('[data-tab-icon]').getBoundingClientRect();const l=t.querySelector('[data-tab-label]');const lr=l.getBoundingClientRect();const lh=parseFloat(getComputedStyle(l).lineHeight);return {n:l.textContent.slice(0,30),lines:Math.round(lr.height/lh),ix:Math.round(i.left-tr.left),iy:Math.round(i.top-tr.top),lx:Math.round(lr.left-tr.left),ta:getComputedStyle(l).textAlign}})})()`;
    const notes: string[] = [];
    try {
      for (const loc of ['en', 'es', 'fa-IR', 'xx-pseudo', 'xx-rtl']) {
        ev(`localStorage.setItem('bible.ui.locale','${loc}')`);
        run(['reload', '-q']);
        waitFor(`locale ${loc}`, () => ev<string>('document.documentElement.lang') === loc, 20_000);
        waitFor('app', () => ev<boolean>("!!document.querySelector('[data-testid=header-preferences]')"));
        sleep(1);
        step(['eval', "document.querySelector('[data-testid=header-preferences]').click()"]);
        const rows = waitFor('settings tabs', () => { const r = ev<Array<{ n: string; lines: number; ix: number; iy: number; lx: number; ta: string }>>(measure); return r.length ? r : undefined; }, 6000);
        const multi = rows.filter((r) => r.lines > 1);
        const bad = rows.filter((r) => r.ix !== rows[0].ix || r.iy !== rows[0].iy || r.lx !== rows[0].lx || r.ta !== 'start');
        if (bad.length) throw new Fail(`${loc}: misaligned tabs ${bad.map((b) => b.n).join(', ')}`);
        if (loc === 'en' && multi.length < 2) throw new Fail(`en: expected the wrapped labels "Downloads & storage" and "Weights and measures" at 800x600, got ${multi.length}`);
        if (loc === 'en') shot('23-settings-tab-alignment');
        notes.push(`${loc}:${multi.length} wrapped`);
        const d = findRef('Done', 'button') ?? findRef('Listo', 'button');
        if (d) run(['click', d, '-q']); else run(['press', 'Escape']);
        sleep(0.5);
      }
    } finally {
      ev("localStorage.setItem('bible.ui.locale','en')");
      run(['reload', '-q']);
      run(['resize', '1400x900']);
      sleep(2);
    }
    return notes.join(' ');
  });

  item('21', 'missing-module-file', () => {
    // A per-run copy of the fixture with a module_metadata row whose file does not exist.
    step(['stop']);
    const data = join(work, 'miss', 'data');
    copyFixture(data);
    const sql = "INSERT INTO module_metadata (module_uuid,module_type,module_name,abbreviation,version,language_code,installed_date,last_updated,database_path,size_bytes,is_indexed,features,update_available,usage_count,user_hidden,is_cross_reference_module) VALUES ('ghost-0001','commentary','Ghost Commentary','Ghost','1.0','en','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','modules/commentary_ghost.db',100,0,'[]',0,0,0,0)";
    const ins = spawnSync('sqlite3', [join(data, 'main.db'), sql], { encoding: 'utf8' });
    if (ins.status !== 0) throw new Fail(`could not add the module_metadata row (sqlite3 CLI needed): ${ins.stderr || ins.error}`);
    const { DRIVE_PROFILE_DIR: _keep, ...rest } = baseEnv;
    void _keep;
    env = { ...rest, BIBLE_DESKTOP_DATA_DIR: data, BIBLE_KEYWORD_INDEX_DIR: join(work, 'miss', 'index') };
    startApp();
    run(['errors', '--clear']);
    step(['click', refStart('Commentary', 'tab'), '-q']);
    step(['click', ref('Add Commentary', 'button'), '-q']);
    step(['click', refStart('Ghost', 'button'), '-q']);
    waitFor('the module file missing state', () => /file is missing/.test(run(['snapshot', '--all', '--max', '600']).text), 10_000);
    if (!has('Open Module Manager', 'button')) throw new Fail('no "Open Module Manager" action in the missing state');
    // More loads against the same missing module (verse changes) must not log again.
    gotoRef('John 3:16');
    gotoRef('John 3:17');
    sleep(2);
    const logged = run(['errors', '--all', '--warn']).text.split('\n').filter((l) => /Ghost|commentary_ghost/.test(l));
    if (logged.length !== 1) throw new Fail(`expected exactly one log line for the missing module, got ${logged.length}: ${logged[0]?.slice(0, 100)}`);
    return `one log line (${logged[0].replace(/\s+/g, ' ').slice(0, 80)})`;
  });

  step(['stop']);
} catch (e) {
  console.error(e instanceof Fail ? e.message : e);
  process.exitCode = 1;
}

stubProc.kill();
console.log('\nitem  check                              result');
for (const r of results) console.log(`${r.id}    ${r.name.padEnd(34)} ${r.status}`);
const failed = results.filter((r) => r.status === 'FAIL');
if (failed.length) process.exitCode = 1;
console.log(failed.length ? `qa-items: ${failed.length} of ${results.length} failed (${failed.map((f) => f.id).join(', ')})` : `qa-items ok (${results.length} items)`);
