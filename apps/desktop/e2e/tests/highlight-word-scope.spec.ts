/**
 * Word-level marks (task 0200): a one-word selection marks exactly that word,
 * whatever the underline style, and an existing mark can be cleared from the
 * context menu in at most two clicks.
 */
import { test, expect, Page } from '../fixtures/electron.fixture';
import path from 'path';
import { getSelectionInfo } from '../fixtures/highlight-utils';

const VERSE = '[data-testid="verse-16"]';
const SHOT_DIR = process.env.DEMO_SHOT_DIR;

async function shot(window: Page, name: string): Promise<void> {
  if (SHOT_DIR) await window.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Number of `.word` spans in the verse that carry a user-markup id. */
async function markedWords(window: Page): Promise<string[]> {
  return window.evaluate((sel) => {
    return Array.from(document.querySelectorAll(`${sel} .word[data-markup-id]`)).map((e) => e.textContent ?? '');
  }, VERSE);
}

async function openMarkupMenuOnWord(window: Page, wordRe: RegExp, selectFirst: boolean): Promise<void> {
  const word = window.locator(`${VERSE} .word`).filter({ hasText: wordRe }).first();
  await expect(word).toBeVisible({ timeout: 10000 });
  const box = (await word.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (selectFirst) {
    await window.mouse.dblclick(x, y);
    const sel = await getSelectionInfo(window);
    expect(sel.isCollapsed).toBe(false);
  }
  await window.mouse.click(x, y, { button: 'right' });
  const menu = window.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu.getByRole('menuitem', { name: /highlight/i }).first().click({ force: true });
  await expect(window.getByLabel('Highlight options')).toBeVisible({ timeout: 10000 });
}

test.beforeEach(async ({ window }) => {
  await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible({ timeout: 20000 });
  await expect(window.locator(VERSE)).toBeVisible({ timeout: 20000 });
});

for (const style of ['solid', 'wavy', 'dotted', 'dashed'] as const) {
  test(`a one-word ${style} underline marks only that word`, async ({ window }) => {
    await openMarkupMenuOnWord(window, /^world,?$/i, true);
    const dialog = window.getByLabel('Highlight options');
    await dialog.getByRole('radio', { name: /^underline$/i }).click({ force: true });
    await dialog.getByRole('radio', { name: new RegExp(`^${style}$`, 'i') }).click({ force: true });
    if (style === 'wavy') await shot(window, '1-menu-wavy-chosen');
    await dialog.getByRole('button', { name: /apply underline/i }).click({ force: true });

    await expect.poll(async () => (await markedWords(window)).length).toBeGreaterThan(0);
    const words = await markedWords(window);
    expect(words.map((w) => w.trim().replace(/[,.]$/, '').toLowerCase())).toEqual(['world']);
    if (style === 'wavy') await shot(window, '2-one-word-wavy-underline');
  });
}

test('right-clicking a word with no selection marks only that word', async ({ window }) => {
  await openMarkupMenuOnWord(window, /^world,?$/i, false);
  const dialog = window.getByLabel('Highlight options');
  await dialog.getByRole('radio', { name: /^underline$/i }).click({ force: true });
  await dialog.getByRole('radio', { name: /^wavy$/i }).click({ force: true });
  await dialog.getByRole('button', { name: /apply underline/i }).click({ force: true });
  await expect.poll(async () => (await markedWords(window)).length).toBeGreaterThan(0);
  const words = await markedWords(window);
  expect(words.length).toBe(1);
});

test('an existing mark is cleared from the context menu in two clicks', async ({ window }) => {
  await openMarkupMenuOnWord(window, /^world,?$/i, false);
  const dialog = window.getByLabel('Highlight options');
  await dialog.getByRole('radio', { name: /^underline$/i }).click({ force: true });
  await dialog.getByRole('radio', { name: /^wavy$/i }).click({ force: true });
  await dialog.getByRole('button', { name: /apply underline/i }).click({ force: true });
  await expect.poll(async () => (await markedWords(window)).length).toBe(1);

  const word = window.locator(`${VERSE} .word[data-markup-id]`).first();
  const box = (await word.boundingBox())!;
  await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  const menu = window.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10000 });
  const items = await menu.getByRole('menuitem').allTextContents();
  const applyAt = items.findIndex((t) => /Highlight\/Underline\.\.\./.test(t));
  // The remove item is right next to the apply item.
  expect(items[applyAt + 1]).toMatch(/Remove Highlight\/Underline/);
  await shot(window, '3-context-menu-remove-next-to-apply');
  await menu.getByRole('menuitem', { name: /remove highlight\/underline/i }).click({ force: true });
  await expect.poll(async () => (await markedWords(window)).length).toBe(0);
});
