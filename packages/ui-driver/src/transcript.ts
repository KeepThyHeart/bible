/**
 * The session transcript, and its conversion into a Playwright spec so a bug
 * found by exploring becomes a regression test.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LocatorHint, ReproTarget, TranscriptEntry } from './types.ts';

export class Transcript {
  private readonly list: TranscriptEntry[] = [];
  private readonly started = Date.now();
  private readonly file: string | undefined;

  constructor(file?: string) {
    this.file = file;
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  add(e: Omit<TranscriptEntry, 'seq' | 't'>): TranscriptEntry {
    const entry: TranscriptEntry = { seq: this.list.length + 1, t: Date.now() - this.started, ...e };
    this.list.push(entry);
    if (this.file) fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  entries(): TranscriptEntry[] {
    return [...this.list];
  }

  /** `#3 +12.4s click r5 -> summary`, `!` before the line when it failed. */
  renderLog(tail?: number): string {
    const list = tail === undefined ? this.list : this.list.slice(-tail);
    return list
      .map(e => `${e.ok ? '' : '!'}#${e.seq} +${(e.t / 1000).toFixed(1)}s ${e.argv.join(' ')} -> ${e.summary}`)
      .join('\n');
  }
}

// ---------------------------------------------------------------------------
// Codegen
// ---------------------------------------------------------------------------

const ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
  'contentinfo', 'dialog', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listbox',
  'listitem', 'main', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'option',
  'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox',
  'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'textbox', 'toolbar',
  'tooltip', 'tree', 'treeitem',
]);

const j = (v: unknown): string => JSON.stringify(v);
const isRef = (s: string | undefined): s is string => s !== undefined && /^r\d+$/.test(s);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

function locator(hint: LocatorHint | undefined): string | undefined {
  if (!hint) return undefined;
  if (hint.testId) return `page.getByTestId(${j(hint.testId)})`;
  const nth = hint.nth !== undefined ? `.nth(${hint.nth})` : '';
  if (hint.role && ARIA_ROLES.has(hint.role) && hint.name) {
    return `page.getByRole(${j(hint.role)}, { name: ${j(hint.name)}, exact: true })${nth}`;
  }
  if (hint.text) return `page.getByText(${j(hint.text)}, { exact: true })${nth}`;
  if (hint.css) return `page.locator(${j(hint.css)})`;
  if (hint.role && ARIA_ROLES.has(hint.role)) return `page.getByRole(${j(hint.role)})${nth}`;
  return undefined;
}

/** Strips flags (and the value of --timeout); reports the ones codegen cares about. */
function parseArgs(argv: string[]): { pos: string[]; enter: boolean; right: boolean } {
  const pos: string[] = [];
  let enter = false;
  let right = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--timeout') i++;
    else if (a === '--enter') enter = true;
    else if (a === '--right') right = true;
    else if (a.startsWith('--')) continue;
    else pos.push(a);
  }
  return { pos, enter, right };
}

const COMMENT_ONLY = new Set(['snapshot', 'diff', 'find', 'errors', 'check', 'screenshot', 'log', 'status', 'pages', 'page', 'help']);

/** The steps (one or more lines, unindented) for one entry. */
function step(e: TranscriptEntry, target: ReproTarget): string[] {
  const name = e.argv[0] ?? '';
  const summary = oneLine(e.summary);
  if (name === 'start' || name === 'stop') return [];
  if (!e.ok) return [`// FAILED: ${oneLine(e.argv.join(' '))} -> ${summary}`];
  const { pos, enter, right } = parseArgs(e.argv);
  const ref = isRef(pos[0]) ? pos[0] : undefined;
  const loc = ref ? locator(e.hint) : undefined;
  const needLoc = (fn: (l: string) => string[]): string[] =>
    loc ? fn(loc) : [`// cannot locate ${ref ?? '?'} (${oneLine(e.argv.join(' '))})`];

  if (COMMENT_ONLY.has(name) && !(name === 'check' && ref)) return [`// ${name}: ${summary}`];
  switch (name) {
    case 'click':
      return needLoc(l => [`await ${l}.click(${right ? '{ button: "right" }' : ''});`]);
    case 'dblclick':
      return needLoc(l => [`await ${l}.dblclick();`]);
    case 'hover':
      return needLoc(l => [`await ${l}.hover();`]);
    case 'fill':
      return needLoc(l => [`await ${l}.fill(${j(pos.slice(1).join(' '))});`, ...(enter ? [`await ${l}.press("Enter");`] : [])]);
    case 'type':
      return needLoc(l => [
        `await ${l}.pressSequentially(${j(pos.slice(1).join(' '))});`,
        ...(enter ? [`await ${l}.press("Enter");`] : []),
      ]);
    case 'press': {
      const key = ref ? pos[1] : pos[0];
      if (!key) return [`// cannot replay: ${oneLine(e.argv.join(' '))}`];
      if (!ref) return [`await page.keyboard.press(${j(key)});`];
      return needLoc(l => [`await ${l}.press(${j(key)});`]);
    }
    case 'select':
      return needLoc(l => [`await ${l}.selectOption({ label: ${j(pos.slice(1).join(' '))} });`]);
    case 'check':
    case 'uncheck':
      return needLoc(l => [`await ${l}.${name}();`]);
    case 'scroll': {
      if (ref) return needLoc(l => [`await ${l}.scrollIntoViewIfNeeded();`]);
      const dir = pos[0];
      const n = Number(pos[1] ?? 600) || 600;
      const [dx, dy] = dir === 'up' ? [0, -n] : dir === 'left' ? [-n, 0] : dir === 'right' ? [n, 0] : [0, n];
      return [`await page.mouse.wheel(${dx}, ${dy});`];
    }
    case 'goto': {
      const url = pos[0] ?? '';
      if (target.kind !== 'web') return [`await page.goto(${j(url)});`];
      const abs = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : new URL(url, target.baseUrl).href;
      // same origin: relative to BASE, so the spec runs against any server
      const origin = new URL(target.baseUrl).origin;
      if (abs.startsWith(origin)) return [`await page.goto(BASE + ${j(abs.slice(origin.length) || '/')});`];
      return [`await page.goto(${j(abs)});`];
    }
    case 'back':
      return ['await page.goBack();'];
    case 'forward':
      return ['await page.goForward();'];
    case 'reload':
      return ['await page.reload();'];
    case 'resize': {
      const m = /^(\d+)x(\d+)$/.exec(pos[0] ?? '');
      return m ? [`await page.setViewportSize({ width: ${m[1]}, height: ${m[2]} });`] : [`// cannot replay: ${oneLine(e.argv.join(' '))}`];
    }
    case 'wait':
      return waitStep(pos, e);
    default:
      return [`// unsupported: ${oneLine(e.argv.join(' '))} -> ${summary}`];
  }
}

function waitStep(pos: string[], e: TranscriptEntry): string[] {
  const first = pos[0] ?? '';
  if (/^\d+$/.test(first)) return [`await page.waitForTimeout(${first});`];
  if (first === 'idle') return ["await page.waitForLoadState('networkidle');"];
  if (first === 'gone') return [`await expect(page.getByText(${j(pos.slice(1).join(' '))}).first()).toBeHidden();`];
  if (first === 'url') return [`await page.waitForURL(u => u.href.includes(${j(pos.slice(1).join(' '))}));`];
  if (first === 'ref') {
    const l = locator(e.hint);
    return l ? [`await expect(${l}).toBeVisible();`] : [`// cannot locate ${pos[1] ?? '?'} (wait ref)`];
  }
  const text = first === 'text' ? pos.slice(1).join(' ') : pos.join(' ');
  return [`await expect(page.getByText(${j(text)}).first()).toBeVisible();`];
}

/** A runnable @playwright/test spec replaying the session. */
export function toPlaywright(entries: TranscriptEntry[], target: ReproTarget): string {
  const steps = entries.flatMap(e => step(e, target));
  const body = steps.map(s => `    ${s}`);
  const out: string[] = [
    `// Generated by @bible/ui-driver on ${new Date().toISOString()}. Review before committing;`,
    `// locators come from the driver's accessible-name approximation.`,
  ];
  if (target.kind === 'web') {
    out.push(`import { test, expect } from '@playwright/test';`, '');
    if (target.viewport) out.push(`test.use({ viewport: { width: ${target.viewport.width}, height: ${target.viewport.height} } });`, '');
    out.push(`// Recorded against ${target.baseUrl}; set BASE_URL to run against another server.`,
      `const BASE = process.env.BASE_URL ?? ${j(new URL(target.baseUrl).origin)};`, '');
    out.push(`test('ui-driver repro', async ({ page }) => {`, `  await page.goto(BASE + ${j(new URL(target.baseUrl).pathname + new URL(target.baseUrl).search + new URL(target.baseUrl).hash)});`, ...body.map(l => l.slice(2)), `});`);
  } else {
    const oldProfile = target.env.ELECTRON_USER_DATA;
    out.push(
      `import { test, expect, _electron as electron } from '@playwright/test';`,
      `import fs from 'node:fs';`,
      `import os from 'node:os';`,
      `import path from 'node:path';`,
      '',
      `test('ui-driver repro', async () => {`,
      `  // A fresh profile, so the replay does not depend on (or damage) saved state.`,
      `  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-driver-repro-'));`,
      `  const recorded: Record<string, string> = ${j(target.env)};`,
      `  const oldProfile: string | undefined = ${oldProfile === undefined ? 'undefined' : j(oldProfile)};`,
      `  const env: Record<string, string> = {};`,
      `  for (const [k, v] of Object.entries(recorded)) env[k] = oldProfile ? v.split(oldProfile).join(userData) : v;`,
      `  env.ELECTRON_USER_DATA = userData;`,
      `  const app = await electron.launch({`,
      `    args: [...${j(target.args)}, ${j(target.main)}],`,
      `    env: { ...(process.env as Record<string, string>), ...env },`,
      `    cwd: ${j(target.cwd)},`,
      `  });`,
      `  const page = await app.firstWindow();`,
      ...body.map(l => l.slice(2)),
      `  await app.close();`,
      `});`,
    );
  }
  return `${out.join('\n')}\n`;
}
