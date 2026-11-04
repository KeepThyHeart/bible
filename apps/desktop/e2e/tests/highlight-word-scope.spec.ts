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

async function openMarkupMenuOnWord(window: Page, wordRe: RegExp, selectFirst: boolean, noNativeSelection = false): Promise<void> {
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
  if (noNativeSelection) {
    // Electron's own right-click can select the word under the pointer; send the
    // contextmenu event ourselves, with the selection cleared, to model "nothing selected".
    await word.evaluate((el, pt) => {
      window.getSelection()?.removeAllRanges();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 2 }));
    }, { x, y });
  } else {
    await window.mouse.click(x, y, { button: 'right' });
  }
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

test('right-clicking with no selection marks the whole verse', async ({ window }) => {
  await openMarkupMenuOnWord(window, /^world,?$/i, false, true);
  const dialog = window.getByLabel('Highlight options');
  await dialog.getByRole('radio', { name: /^underline$/i }).click({ force: true });
  await dialog.getByRole('radio', { name: /^wavy$/i }).click({ force: true });
  await dialog.getByRole('button', { name: /apply underline/i }).click({ force: true });
  await expect.poll(async () => (await markedWords(window)).length).toBeGreaterThan(0);
  const total = await window.locator(`${VERSE} .word`).count();
  expect(total).toBeGreaterThan(1);
  await expect.poll(async () => (await markedWords(window)).length).toBe(total);
});

test('dragging over one word, then right-clicking it, underlines only that word', async ({ window }) => {
  const word = window.locator(`${VERSE} .word`).filter({ hasText: /^world,?$/i }).first();
  await expect(word).toBeVisible({ timeout: 10000 });
  const box = (await word.boundingBox())!;
  const y = box.y + box.height / 2;
  await window.mouse.move(box.x + 1, y);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width - 2, y, { steps: 6 });
  await window.mouse.up();
  expect((await getSelectionInfo(window)).isCollapsed).toBe(false);
  await window.mouse.click(box.x + box.width / 2, y, { button: 'right' });
  const menu = window.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu.getByRole('menuitem', { name: /highlight/i }).first().click({ force: true });
  const dialog = window.getByLabel('Highlight options');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByRole('radio', { name: /^underline$/i }).click({ force: true });
  await dialog.getByRole('radio', { name: /^wavy$/i }).click({ force: true });
  await dialog.getByRole('button', { name: /apply underline/i }).click({ force: true });
  await expect.poll(async () => (await markedWords(window)).length).toBeGreaterThan(0);
  const words = await markedWords(window);
  expect(words.map((w) => w.trim().replace(/[,.]$/, '').toLowerCase())).toEqual(['world']);
});

test('an existing mark is cleared from the context menu in two clicks', async ({ window }) => {
  await openMarkupMenuOnWord(window, /^world,?$/i, true);
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
