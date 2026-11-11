/**
 * Web accounts + end-to-end encrypted sync, in a real browser: two "devices" (separate browser contexts,
 * so separate OPFS and locks) share one account on the accounts server (port base + 2, flags
 * `localUserDb` and `accounts` on, console mailer; see playwright.config.ts and e2e/README.md).
 *
 * Chromium only: the worker DB needs OPFS access handles that Playwright's WebKit build lacks.
 * The scenarios share one account and run in order (serial).
 */
import { readFileSync } from 'fs';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { navigateTo } from '../helpers';
import { ACCOUNTS_URL } from '../ports';
import {
  badgeText, bookmarkVerse, closeDialog, dialog, highlightColor, highlightVerse, memorizeVerse, noteVerse,
  openAccount, openApp, openNoteDialog, openPassage, signIn, signUp, sleep, syncNow, unlockIfLocked,
  verificationLink,
} from '../accountsHelpers';

test.describe.configure({ mode: 'serial' });
// In beforeAll (declared first), so other projects skip the whole file without opening the two contexts (R3 L-7).
test.beforeAll(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Worker DB + OPFS: desktop Chromium only');
});

const EMAIL = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

let ctxA: BrowserContext;
let ctxB: BrowserContext;
let a: Page;
let b: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(60000);
  ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  a = await ctxA.newPage();
  b = await ctxB.newPage();
});

test.afterAll(async () => {
  await ctxA?.close();
  await ctxB?.close();
});

/** Reload a device on Genesis 1 and unlock if needed. */
async function reloadGenesis(page: Page): Promise<void> {
  await openPassage(page, 'Genesis 1');
  await unlockIfLocked(page);
  await sleep(3000);
}

test('sign up on A, annotate, sync, sign in on B and see everything', async () => {
  test.setTimeout(180000);
  await openPassage(a, 'Genesis 1');
  await signUp(a, EMAIL);

  // Verify the address from the console mailer's link, in a second tab of A.
  await expect.poll(() => verificationLink(), { timeout: 30000 }).not.toBeNull();
  const tab = await ctxA.newPage();
  await tab.goto(verificationLink()!);
  await tab.waitForSelector('.verse', { timeout: 60000 });
  await sleep(2000);
  await tab.close();

  await a.bringToFront();
  await closeDialog(a).catch(() => {});
  await highlightVerse(a, 1, 'Yellow');
  await noteVerse(a, 2, 'Beginning', 'First note from A');
  await bookmarkVerse(a, 3);
  await navigateTo(a, 'John 3');
  await memorizeVerse(a, 16);
  await navigateTo(a, 'Genesis 1');
  await syncNow(a);

  await openPassage(b, 'Genesis 1');
  await signIn(b, EMAIL, true);
  await closeDialog(b);
  await sleep(4000);
  await expect.poll(() => highlightColor(b, 1), { timeout: 60000 }).toBe('yellow');
  await expect(b.locator('.verse').nth(1).locator('.kth-annot-mark--note').first()).toBeVisible({ timeout: 30000 });
  await expect(b.locator('.verse').nth(2).locator('.kth-annot-mark--bookmark').first()).toBeVisible({ timeout: 30000 });

  await openApp(b, '#/@memory');
  await unlockIfLocked(b);
  await expect(b.locator('body')).toContainText(/John\s*3:16/, { timeout: 60000 });
});

test('offline conflict: both devices converge, the note keeps both copies', async () => {
  test.setTimeout(420000);
  await reloadGenesis(a);
  await reloadGenesis(b);

  // Warm the lazy note-dialog chunk before B goes offline (no service worker on this server).
  const warm = await openNoteDialog(b, 2);
  await warm.waitFor();
  await b.keyboard.press('Escape');
  await expect(b.locator('.kth-annot-dialog')).toBeHidden();

  await ctxB.setOffline(true);
  await noteVerse(b, 2, 'Beginning', 'Edited OFFLINE on B');
  await highlightVerse(b, 1, 'Green');
  await sleep(1000);

  await noteVerse(a, 2, 'Beginning', 'Edited online on A');
  await highlightVerse(a, 1, 'Blue');
  await syncNow(a);

  await ctxB.setOffline(false);
  await sleep(1000);
  await syncNow(b);
  await sleep(2000);
  await syncNow(a);

  const colors: Array<string | null> = [];
  for (const page of [a, b]) {
    await reloadGenesis(page);
    colors.push(await highlightColor(page, 1));
    const noteMarks = page.locator('.verse').nth(1).locator('.kth-annot-mark--note');
    await expect(noteMarks.first()).toBeVisible({ timeout: 30000 });
    const dlg = (await noteMarks.first().click(), page.locator('.kth-annot-dialog, .kth-annot-popover').first());
    await expect(dlg).toContainText('Note 1 of 2', { timeout: 15000 });
    // The newest note comes first; the other device's losing edit is the labelled conflicted copy.
    const texts = [await dlg.locator('textarea').inputValue()];
    const first = await dlg.innerText();
    await dlg.getByRole('button', { name: /next/i }).click();
    await expect(dlg).toContainText('Note 2 of 2');
    texts.push(await dlg.locator('textarea').inputValue());
    const second = await dlg.innerText();
    expect([first, second].filter((t) => t.includes('Conflicted copy from another device'))).toHaveLength(1);
    expect(texts.join('|')).toContain('Edited OFFLINE on B');
    expect(texts.join('|')).toContain('Edited online on A');
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  expect(colors[0]).not.toBeNull();
  expect(colors[1]).toBe(colors[0]);
});

test('sign out and delete local data on B, keep working, sign in again', async () => {
  test.setTimeout(300000);
  await reloadGenesis(b);
  const d = await openAccount(b);
  await d.getByRole('button', { name: 'Sign out', exact: true }).click();
  await d.getByRole('button', { name: 'Sign out and delete my data from this browser' }).click();
  await expect(dialog(b)).toBeHidden({ timeout: 30000 }).catch(() => {});
  await sleep(4000);

  // Marks are gone (no reload).
  await expect(b.locator('.kth-annot-mark--note')).toHaveCount(0, { timeout: 20000 });
  expect(await highlightColor(b, 1)).toBeNull();

  // The local DB reopens: a new highlight still works without a reload.
  await highlightVerse(b, 4, 'Yellow');
  await expect.poll(() => highlightColor(b, 4), { timeout: 15000 }).toBe('yellow');

  await signIn(b, EMAIL, true);
  await closeDialog(b);
  await sleep(4000);
  await syncNow(b);
  await reloadGenesis(b);
  await expect(b.locator('.verse').nth(1).locator('.kth-annot-mark--note').first()).toBeVisible({ timeout: 60000 });
  expect(await highlightColor(b, 1)).not.toBeNull();
});

test('export readable data from A', async () => {
  test.setTimeout(240000);
  await reloadGenesis(a);
  const d = await openAccount(a);
  await d.getByRole('button', { name: /Privacy and your data/ }).click();
  const [download] = await Promise.all([
    a.waitForEvent('download', { timeout: 60000 }),
    d.getByRole('button', { name: 'Export readable data' }).click(),
  ]);
  const path = await download.path();
  const zip = readFileSync(path).toString('latin1');
  for (const name of ['user/user_note.ndjson', 'user/user_text_markup.ndjson']) expect(zip).toContain(name);
  expect(zip).toMatch(/memory_\w+/);
  expect(ACCOUNTS_URL).toContain('localhost');
});
