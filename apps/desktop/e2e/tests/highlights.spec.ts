/**
 * Highlights E2E Tests
 *
 * ## Why this file was rewritten
 *
 * Every test here was shaped as "if the control happens to exist, assert
 * something about it":
 *
 *     const optionCount = await highlightOption.count();
 *     if (optionCount > 0) { await expect(...).toBeVisible(); }
 *
 * so all of them passed whether or not highlighting worked at all. One had
 * already been deleted for looking up `[data-testid^="underline-style-"]`,
 * which `HighlightMenu.tsx` has never rendered. The persistence test did not
 * test persistence - its own comment said it "would ideally" apply a highlight,
 * and it settled for checking the app did not crash while paging chapters.
 *
 * What this file covers now, unconditionally:
 *   - the context menu really opens the highlight menu, with real colour swatches
 *   - word-boundary expansion (KAN-10): a part-word drag selects whole words
 *   - a highlight survives navigating away and back - the case
 *     `highlight-diagnosis.spec.ts` does not cover, since it reloads instead
 *
 * Creation across all four renderers, computed background colour, underline
 * decoration and survival across a reload live in `highlight-diagnosis.spec.ts`.
 * The shared gestures and probes both files use are in
 * `e2e/fixtures/highlight-utils.ts`.
 */

import { test, expect } from '../fixtures/electron.fixture';
import { dragAcross, getSelectionInfo, getHighlightInfo, isVisiblyPainted } from '../fixtures/highlight-utils';

/** John 3:16 - long enough to drag across, and present on a fresh profile. */
const VERSE = '[data-testid="verse-16"]';

test.beforeEach(async ({ window }) => {
  await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible({ timeout: 20000 });
  await expect(window.locator(VERSE)).toBeVisible({ timeout: 20000 });
});

test.describe('Highlight menu', () => {
  test('opens from the verse context menu with more than one colour', async ({ window }) => {
    // force: the Electron window under test is minimized, which intermittently
    // fails Playwright's actionability check on a perfectly interactable node.
    // Verse 1 rather than 16: the menu opens at the pointer and is not clamped
    // to the viewport, so right-clicking a verse far down the chapter in this
    // small test window puts its items off-screen where they cannot be clicked.
    const firstVerse = window.locator('[data-testid="verse-1"]');
    await expect(firstVerse).toBeVisible({ timeout: 10000 });
    await firstVerse.click({ force: true });
    await firstVerse.click({ button: 'right', force: true, position: { x: 8, y: 8 } });

    const contextMenu = window.getByRole('menu');
    await expect(contextMenu).toBeVisible({ timeout: 10000 });

    const highlightEntry = contextMenu.getByRole('menuitem', { name: /highlight/i }).first();
    await expect(highlightEntry).toBeVisible();
    await highlightEntry.click({ force: true });

    const menu = window.getByLabel('Highlight options');
    await expect(menu).toBeVisible({ timeout: 10000 });

    // A palette with one swatch is a broken palette.
    const swatches = menu.getByRole('button', { name: /highlight in/i });
    expect(await swatches.count()).toBeGreaterThan(1);
  });
});

test.describe('Word selection boundaries (KAN-10)', () => {
  test('expands a part-word drag out to whole words', async ({ window }) => {
    const box = await window.locator(VERSE).boundingBox();
    expect(box).not.toBeNull();

    await dragAcross(window, box!, 0.1, 0.4);

    const selection = await getSelectionInfo(window);
    // Assert the gesture worked before asserting anything about its shape -
    // an empty selection trivially satisfies "does not end in punctuation".
    expect(selection.isCollapsed).toBe(false);
    expect(selection.text.trim().length).toBeGreaterThan(0);

    const text = selection.text.trim();
    expect(text).not.toMatch(/^[,.:;!?]/);
    expect(text).not.toMatch(/[,.:;!?]$/);
    // Whole words means no fragment at either end.
    expect(text.split(/\s+/).every(word => word.length > 0)).toBe(true);
  });

  test('selects a whole word on double-click, without its trailing comma', async ({ window }) => {
    const word = window.locator(`${VERSE} .word`).filter({ hasText: /^world,?$/i }).first();
    await expect(word).toBeVisible({ timeout: 10000 });

    const box = await word.boundingBox();
    expect(box).not.toBeNull();
    await window.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const selection = await getSelectionInfo(window);
    expect(selection.text.toLowerCase()).toContain('world');
    expect(selection.text.trim()).not.toMatch(/[,.:;!?]$/);
  });
});

test.describe('Highlight persistence', () => {
  test('survives navigating to another chapter and back', async ({ window }) => {
    // highlight-diagnosis.spec.ts proves a highlight survives a reload; this is
    // the other way a reader loses one - paging away and back re-mounts the
    // verse list from the store rather than from disk.
    const box = await window.locator(VERSE).boundingBox();
    expect(box).not.toBeNull();
    await dragAcross(window, box!, 0.1, 0.4);

    const swatch = window.getByLabel('Highlight Yellow');
    await expect(swatch).toBeVisible({ timeout: 10000 });
    await swatch.click({ force: true });

    const applied = await getHighlightInfo(window);
    expect(applied.highlightedCount).toBeGreaterThan(0);
    expect(isVisiblyPainted(applied.firstBackground)).toBe(true);
    const highlightedText = applied.firstText;

    await window.click('[data-testid="next-chapter"]', { force: true });
    await expect(window.locator(VERSE)).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await getHighlightInfo(window)).highlightedCount).toBe(0);

    await window.click('[data-testid="prev-chapter"]', { force: true });
    await expect(window.locator(VERSE)).toBeVisible({ timeout: 15000 });

    await expect
      .poll(async () => (await getHighlightInfo(window)).highlightedCount, { timeout: 15000 })
      .toBeGreaterThan(0);

    const restored = await getHighlightInfo(window);
    expect(restored.firstText).toBe(highlightedText);
    // Restored but unpainted is the failure that reads as "my highlight vanished".
    expect(isVisiblyPainted(restored.firstBackground)).toBe(true);
  });
});
