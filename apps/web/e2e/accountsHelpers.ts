/**
 * Flows for accounts-sync-e2e.spec.ts, proven against the real build: sign up/in, verse annotations, sync.
 * Each "device" is its own `browser.newContext()` (separate OPFS and locks).
 */
import { readFileSync } from 'fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { ACCOUNTS_SERVER_LOG, ACCOUNTS_URL } from './ports';
import { navigateTo } from './helpers';

export const PASSWORD = 'correct horse battery staple 1611';
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Latest console-mailer verification link for this server (the log is the wrapper's tee of stdout). */
export function verificationLink(): string | null {
  let log = '';
  try { log = readFileSync(ACCOUNTS_SERVER_LOG, 'utf8'); } catch { return null; }
  const re = new RegExp(`${ACCOUNTS_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/account/verify-email#token=[A-Za-z0-9_-]+`, 'g');
  const all = log.match(re);
  return all ? all[all.length - 1] : null;
}

/** Load the app (lands on the last app: switch to Study if there are no verses). */
export async function openApp(page: Page, hash = ''): Promise<void> {
  await page.goto(`${ACCOUNTS_URL}/${hash}`);
  if (hash) { await page.waitForSelector('body'); return; }
  await page.waitForSelector('.verse, .kth-app-rail', { timeout: 30000 });
  if (!(await page.locator('.verse').count())) await page.locator('.kth-app-rail [data-app-id="study"]').click();
  await page.waitForSelector('.verse', { timeout: 30000 });
}

/** Open the app and go to a passage. */
export async function openPassage(page: Page, reference: string): Promise<void> {
  await openApp(page);
  await navigateTo(page, reference);
}

export const dialog = (page: Page): Locator => page.locator('[data-testid="accounts-dialog"]');

export async function openAccount(page: Page): Promise<Locator> {
  await page.locator('[data-testid="accounts-header-badge"] button').first().click();
  const d = dialog(page);
  await d.waitFor();
  return d;
}

export async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
}

export async function badgeText(page: Page): Promise<string> {
  return (await page.locator('[data-testid="accounts-header-badge"]').innerText()).trim();
}

/** Sign up through the dialog and confirm the recovery code. Returns the code. */
export async function signUp(page: Page, email: string): Promise<string> {
  const d = await openAccount(page);
  await d.getByRole('button', { name: 'Create an account' }).click();
  await d.getByLabel('Email address').fill(email);
  await d.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await d.getByLabel(/Confirm/i).fill(PASSWORD);
  await d.locator('input[type=checkbox]').nth(0).check();
  await d.locator('input[type=checkbox]').nth(1).check();
  await d.getByRole('button', { name: /Create account|Sign up/i }).click();
  await d.locator('.kth-account__code-group').first().waitFor({ timeout: 90000 });
  const code = (await d.locator('.kth-account__code-group').allInnerTexts()).join('');
  const inputs = d.locator('.kth-account__confirm-row input');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const id = await inputs.nth(i).getAttribute('id');
    const label = await d.locator(`label[for="${id}"]`).innerText();
    await inputs.nth(i).fill(code[Number(label.match(/\d+/)![0]) - 1]);
  }
  await d.getByRole('button', { name: /I have saved my code/i }).click();
  await d.locator('[data-testid="accounts-signed-in"]').waitFor({ timeout: 60000 });
  return code;
}

/** Sign in from the dialog ("Keep me signed in" by default). */
export async function signIn(page: Page, email: string, remember = true): Promise<void> {
  const d = await openAccount(page);
  await d.getByLabel('Email address').fill(email);
  await d.getByLabel('Password', { exact: true }).fill(PASSWORD);
  if (remember) await d.getByLabel(/Keep me signed in/).check();
  await d.getByRole('button', { name: 'Sign in', exact: true }).click();
  await d.locator('[data-testid="accounts-signed-in"]').waitFor({ timeout: 90000 });
}

/** After a reload a "kept" session can be locked: unlock it with the password. */
export async function unlockIfLocked(page: Page): Promise<void> {
  // After a load the badge starts as "Not signed in" until the worker reports the remembered session (or the lock).
  await expect.poll(() => badgeText(page), { timeout: 20000 }).toMatch(/Locked|Synced|Sync|waiting|problem/i).catch(() => {});
  if (!/Locked/i.test(await badgeText(page))) return;
  const d = await openAccount(page);
  // "Locked" can be a passing state while the remembered keys load: the dialog may already be signed in.
  const pw = d.locator('input[type=password]').first();
  const signedIn = d.locator('[data-testid="accounts-signed-in"]');
  await expect(pw.or(signedIn).first()).toBeVisible({ timeout: 30000 });
  if (await signedIn.isVisible()) { await closeDialog(page); return; }
  await pw.fill(PASSWORD);
  await d.locator('button[type=submit]').first().click();
  await d.locator('[data-testid="accounts-signed-in"]').waitFor({ timeout: 90000 });
  await closeDialog(page);
}

/** Press "Sync now" and wait for the round trip to settle. */
export async function syncNow(page: Page): Promise<void> {
  await unlockIfLocked(page);
  const d = await openAccount(page);
  await d.getByRole('button', { name: 'Sync now' }).click();
  // Wait for the badge to settle on "Synced" with nothing waiting, not a fixed delay (R3 L-6).
  await sleep(500);
  await expect.poll(async () => { const t = await badgeText(page); return /Synced/i.test(t) && !/waiting|Syncing/i.test(t); },
    { timeout: 30000 }).toBe(true);
  await closeDialog(page);
}

async function verseAction(page: Page, n: number, id: string): Promise<void> {
  await page.locator('.verse').nth(n - 1).click({ button: 'right' });
  const menu = page.locator('.verse-context-menu');
  await menu.waitFor({ timeout: 10000 });
  await menu.locator(`[data-action-id="${id}"]`).click();
}

export async function highlightVerse(page: Page, n: number, color: string): Promise<void> {
  await verseAction(page, n, 'annotations.highlight');
  await page.locator(`.kth-annot-popover [aria-label="${color}"]`).click();
  await sleep(500);
  await page.keyboard.press('Escape');
}

/** Open the note dialog of verse n and leave it open. */
export async function openNoteDialog(page: Page, n: number): Promise<Locator> {
  await verseAction(page, n, 'annotations.note');
  const dlg = page.locator('.kth-annot-dialog');
  await dlg.waitFor({ timeout: 10000 });
  return dlg;
}

export async function noteVerse(page: Page, n: number, title: string, text: string): Promise<void> {
  const dlg = await openNoteDialog(page, n);
  const fields = dlg.locator('input, textarea');
  await fields.nth(0).fill(title);
  await fields.nth(1).fill(text);
  await dlg.locator('button[type=submit]').click();
  await dlg.waitFor({ state: 'hidden', timeout: 10000 });
  await sleep(500);
}

export async function bookmarkVerse(page: Page, n: number): Promise<void> {
  await verseAction(page, n, 'annotations.bookmark');
  await sleep(500);
}

export async function memorizeVerse(page: Page, n: number): Promise<void> {
  await verseAction(page, n, 'memory.memorize');
  await sleep(1500);
  // Memorize may switch to the Memory app: come back to Study (its header holds the account badge).
  // The switch can land after a first check (slow machine), so retry until Study shows its verses.
  await expect(async () => {
    if (!(await page.locator('.verse').first().isVisible())) await page.locator('.kth-app-rail [data-app-id="study"]').click();
    await page.locator('.verse').first().waitFor({ state: 'visible', timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

/** The `kth-annot-hl--<colour>` colour on verse n, or null. */
export async function highlightColor(page: Page, n: number): Promise<string | null> {
  return page.locator('.verse').nth(n - 1).evaluate(v => /kth-annot-hl--([\w-]+)/.exec(v.outerHTML)?.[1] ?? null);
}
