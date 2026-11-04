import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { toPlaywright, Transcript } from '../src/transcript.ts';
import type { LocatorHint, TranscriptEntry } from '../src/types.ts';

function entry(argv: string[], over: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { seq: 1, t: 0, argv, ok: true, summary: 'ok', ...over };
}
const btn: LocatorHint = { role: 'button', name: 'Save' };

function parses(code: string): string[] {
  const sf = ts.createSourceFile('repro.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return ((sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('Transcript', () => {
  it('numbers entries and renders the log', () => {
    const t = new Transcript();
    t.add({ argv: ['click', 'r5'], ok: true, summary: 'clicked' });
    t.add({ argv: ['click', 'r9'], ok: false, summary: 'no such ref' });
    t.add({ argv: ['back'], ok: true, summary: 'back' });
    expect(t.entries().map(e => e.seq)).toEqual([1, 2, 3]);
    const lines = t.renderLog().split('\n');
    expect(lines[0]).toMatch(/^#1 \+\d+\.\ds click r5 -> clicked$/);
    expect(lines[1]).toMatch(/^!#2 /);
    expect(t.renderLog(1).split('\n')).toHaveLength(1);
  });

  it('appends JSONL to the file, creating dirs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'));
    const file = path.join(dir, 'a', 'b', 't.jsonl');
    const t = new Transcript(file);
    t.add({ argv: ['back'], ok: true, summary: 's' });
    t.add({ argv: ['reload'], ok: true, summary: 's' });
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l) as TranscriptEntry);
    expect(rows.map(r => r.argv[0])).toEqual(['back', 'reload']);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('toPlaywright', () => {
  const entries: TranscriptEntry[] = [
    entry(['start', 'web']),
    entry(['snapshot'], { summary: 'page "Read" 40 nodes' }),
    entry(['click', 'r5'], { hint: btn }),
    entry(['click', 'r5', '--right', '--quiet'], { hint: btn }),
    entry(['dblclick', 'r5'], { hint: { testId: 'row' } }),
    entry(['hover', 'r5'], { hint: { role: 'link', name: 'Home', nth: 2 } }),
    entry(['fill', 'r3', 'x'], { hint: { role: 'textbox', name: 'Search' } }),
    entry(['type', 'r3', 'love', 'one', 'another', '--enter', '--timeout', '900'], { hint: { text: 'Search box' } }),
    entry(['press', 'Enter']),
    entry(['press', 'r4', 'Tab'], { hint: { css: 'div > input' } }),
    entry(['check', 'r7'], { hint: { role: 'checkbox', name: 'Dark' } }),
    entry(['uncheck', 'r7'], { hint: { role: 'checkbox', name: 'Dark' } }),
    entry(['check'], { summary: '2 issues: unnamed [r14] button' }),
    entry(['select', 'r9', 'ASV'], { hint: { role: 'combobox', name: 'Version' } }),
    entry(['scroll', 'down', '600']),
    entry(['scroll', 'up']),
    entry(['scroll', 'r5'], { hint: btn }),
    entry(['goto', '/read/John.3']),
    entry(['goto', 'https://example.com/x']),
    entry(['back']),
    entry(['forward']),
    entry(['reload']),
    entry(['resize', '400x800']),
    entry(['wait', 'text', 'Hello']),
    entry(['wait', 'Hello world']),
    entry(['wait', 'gone', 'Loading']),
    entry(['wait', '500']),
    entry(['wait', 'idle']),
    entry(['click', 'r2'], { ok: false, summary: 'ref r2 is gone' }),
    entry(['click', 'r8']),
    entry(['errors'], { summary: 'none' }),
    entry(['stop']),
  ];

  it('generates a parsing web spec covering every mapping', () => {
    const code = toPlaywright(entries, { kind: 'web', baseUrl: 'http://127.0.0.1:5173', viewport: { width: 1200, height: 800 } });
    expect(parses(code)).toEqual([]);
    for (const part of [
      "import { test, expect } from '@playwright/test';",
      'test.use({ viewport: { width: 1200, height: 800 } });',
      'await page.goto("http://127.0.0.1:5173");',
      '// snapshot: page "Read" 40 nodes',
      'await page.getByRole("button", { name: "Save", exact: true }).click();',
      'click({ button: "right" })',
      'await page.getByTestId("row").dblclick();',
      'page.getByRole("link", { name: "Home", exact: true }).nth(2).hover();',
      'page.getByRole("textbox", { name: "Search", exact: true }).fill("x");',
      'page.getByText("Search box", { exact: true }).pressSequentially("love one another");',
      'page.getByText("Search box", { exact: true }).press("Enter");',
      'await page.keyboard.press("Enter");',
      'page.locator("div > input").press("Tab");',
      '.check();',
      '.uncheck();',
      '// check: 2 issues: unnamed [r14] button',
      'selectOption({ label: "ASV" })',
      'await page.mouse.wheel(0, 600);',
      'await page.mouse.wheel(0, -600);',
      'scrollIntoViewIfNeeded()',
      'await page.goto("http://127.0.0.1:5173/read/John.3");',
      'await page.goto("https://example.com/x");',
      'goBack()',
      'goForward()',
      'page.reload()',
      'setViewportSize({ width: 400, height: 800 })',
      'await expect(page.getByText("Hello").first()).toBeVisible();',
      'await expect(page.getByText("Hello world").first()).toBeVisible();',
      'getByText("Loading").first()).toBeHidden()',
      'waitForTimeout(500)',
      "waitForLoadState('networkidle')",
      '// FAILED: click r2 -> ref r2 is gone',
      '// cannot locate r8',
      '// errors: none',
    ]) expect(code, part).toContain(part);
    expect(code).not.toContain('start web');
    expect(code).not.toContain('click r2\n');
  });

  it('generates a parsing electron spec with a fresh profile', () => {
    const code = toPlaywright(
      [entry(['click', 'r5'], { hint: btn }), entry(['goto', '/x'])],
      { kind: 'electron', main: '/repo/apps/desktop/out/main.js', args: ['--no-sandbox'], env: { ELECTRON_USER_DATA: '/tmp/prof', OTHER: '/tmp/prof/db' }, cwd: '/repo' },
    );
    expect(parses(code)).toEqual([]);
    for (const part of [
      "_electron as electron } from '@playwright/test'",
      'fs.mkdtempSync',
      'env.ELECTRON_USER_DATA = userData;',
      'v.split(oldProfile).join(userData)',
      'electron.launch(',
      '["--no-sandbox"], "/repo/apps/desktop/out/main.js"',
      'cwd: "/repo"',
      'await app.firstWindow()',
      'await app.close();',
      'await page.goto("/x");',
    ]) expect(code, part).toContain(part);
  });
});
