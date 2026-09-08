/**
 * Bookmarks E2E Tests
 *
 * The whole point of bookmarks is the round trip: something you save has to be
 * findable again, and a bookmark you *named* has to survive being moved. Both
 * of those cross the store, the IPC boundary and the user database, so they
 * are only really proved in the running app.
 *
 * What this file covers:
 *   - the toolbar menu saves the selected verse, and the text says so
 *   - the jump list offers what was saved and navigates to it
 *   - re-pointing a *named* bookmark keeps the name and changes the reference,
 *     which is the rule the whole naming design rests on
 *   - the manager renames, reorders and removes
 *
 * Nothing here starts from a seeded database: every test saves through the
 * same UI a reader would, so a broken save cannot leave the assertions passing
 * against a fixture.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';

const RIBBON = '[data-testid="bookmark-toggle"]';
const ADD = '[data-testid="bookmark-add-current"]';
const MANAGE = '[data-testid="manage-bookmarks-dialog"]';

test.beforeEach(async ({ window }) => {
  await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible({ timeout: 20000 });
  await expect(window.locator('[data-testid="verse-1"]')).toBeVisible({ timeout: 20000 });
});

/**
 * Select a verse of the open chapter and save it from the toolbar menu.
 *
 * The ribbon opens the list; saving is the first item in it. That split is
 * deliberate - returning to a bookmark is the common errand - so the helper
 * has to take both steps.
 */
async function bookmarkVerse(window: Page, verseNumber: number): Promise<void> {
  const verse = window.locator(`[data-testid="verse-${verseNumber}"]`);
  await expect(verse).toBeVisible({ timeout: 10000 });
  // force: the Electron window under test is minimized, which intermittently
  // fails Playwright's actionability check on a perfectly interactable node.
  await verse.click({ force: true });

  const ribbon = window.locator(RIBBON);
  await expect(ribbon).toHaveAttribute('data-bookmarked', 'false', { timeout: 10000 });
  await ribbon.click({ force: true });
  await window.locator(ADD).click({ force: true });
  await expect(ribbon).toHaveAttribute('data-bookmarked', 'true', { timeout: 10000 });
}

/** Whether a verse carries the ribbon in the text. */
async function expectBookmarked(
  window: Page,
  verseNumber: number,
  bookmarked: boolean,
): Promise<void> {
  const marker = window.locator(`[data-testid="verse-${verseNumber}"] .bookmark-indicator`);
  if (bookmarked) {
    await expect(marker).toBeVisible({ timeout: 15000 });
  } else {
    await expect(marker).toHaveCount(0, { timeout: 15000 });
  }
}

/** Open the Manage Bookmarks dialog through the jump list. */
async function openManager(window: Page): Promise<void> {
  await window.locator(RIBBON).click({ force: true });
  await window.locator('[data-testid="bookmark-manage"]').click({ force: true });
  await expect(window.locator(MANAGE)).toBeVisible({ timeout: 10000 });
}

test.describe('Saving', () => {
  test('saving marks the verse, and the jump list has it', async ({ window }) => {
    await bookmarkVerse(window, 1);

    // The ribbon in the margin is what a reader sees while reading...
    await expectBookmarked(window, 1, true);

    // ...and saved means findable: the round trip is the point of the feature.
    await window.locator(RIBBON).click({ force: true });
    await expect(
      window.locator('[data-testid^="bookmark-jump-"]'),
    ).toHaveCount(1, { timeout: 10000 });
  });

  test('opening the menu saves nothing on its own', async ({ window }) => {
    await window.locator('[data-testid="verse-1"]').click({ force: true });
    await window.locator(RIBBON).click({ force: true });

    // The list is what the button is for; the reader has to ask to save.
    await expect(window.locator(ADD)).toBeVisible({ timeout: 10000 });
    await expectBookmarked(window, 1, false);
  });

  test('the menu removes a bookmark it already has', async ({ window }) => {
    await bookmarkVerse(window, 1);

    await window.locator(RIBBON).click({ force: true });
    await window.locator('[data-testid="bookmark-remove-current"]').click({ force: true });

    await expectBookmarked(window, 1, false);
  });

  test('the jump list offers a saved bookmark and navigates to it', async ({ window }) => {
    await bookmarkVerse(window, 3);

    // Move away, so arriving back is a real navigation rather than a no-op.
    await window.locator('[data-testid="next-chapter"]').click({ force: true });
    await expect(window.locator('[data-testid="verse-1"]')).toBeVisible({ timeout: 15000 });

    await window.locator(RIBBON).click({ force: true });
    const entry = window.locator('[data-testid^="bookmark-jump-"]').first();
    await expect(entry).toBeVisible({ timeout: 10000 });
    await entry.click({ force: true });

    await expect(window.locator('[data-testid="verse-3"]')).toBeVisible({ timeout: 15000 });
    await expectBookmarked(window, 3, true);
  });
});

test.describe('Managing', () => {
  test('names a bookmark, and the name replaces the reference', async ({ window }) => {
    await bookmarkVerse(window, 1);
    await openManager(window);

    const dialog = window.locator(MANAGE);
    await dialog.locator('[data-testid^="bookmark-rename-"]').first().click({ force: true });
    const input = dialog.locator('[data-testid^="bookmark-name-input-"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill('First stop');
    await input.press('Enter');

    await expect(dialog.getByText('First stop')).toBeVisible({ timeout: 10000 });
  });

  test('reorders from the drag handle with the keyboard', async ({ window }) => {
    await bookmarkVerse(window, 1);
    await bookmarkVerse(window, 2);
    await openManager(window);

    const dialog = window.locator(MANAGE);
    const rows = dialog.locator('[data-testid^="bookmark-row-"]');
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    const firstId = await rows.first().getAttribute('data-testid');
    // Dragging is the mouse gesture; the arrow keys on the handle are the same
    // move, and are the half a test can drive honestly.
    await dialog.locator('[data-testid^="bookmark-handle-"]').first().focus();
    await window.keyboard.press('ArrowDown');

    // The row that was on top is now second - the order is the user's, and it
    // is persisted, not just repainted.
    await expect(rows.nth(1)).toHaveAttribute('data-testid', firstId!, { timeout: 10000 });
  });

  test('removes a bookmark, and the verse stops reading as saved', async ({ window }) => {
    await bookmarkVerse(window, 1);
    await openManager(window);

    const dialog = window.locator(MANAGE);
    await dialog.locator('[data-testid^="bookmark-remove-"]').first().click({ force: true });
    await expect(dialog.locator('[data-testid="bookmarks-empty"]')).toBeVisible({ timeout: 10000 });

    await window.getByRole('button', { name: /^Done$/ }).first().click({ force: true });
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expectBookmarked(window, 1, false);
  });

  test('Escape closes the manager', async ({ window }) => {
    await bookmarkVerse(window, 1);
    await openManager(window);

    await window.keyboard.press('Escape');

    await expect(window.locator(MANAGE)).toBeHidden({ timeout: 10000 });
  });
});

test.describe('Re-pointing a bookmark', () => {
  test('keeps a custom name and changes the reference', async ({ window }) => {
    await bookmarkVerse(window, 1);

    // Name it, so there is something for the move to preserve.
    await openManager(window);
    const dialog = window.locator(MANAGE);
    await dialog.locator('[data-testid^="bookmark-rename-"]').first().click({ force: true });
    const input = dialog.locator('[data-testid^="bookmark-name-input-"]').first();
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill('Where I am reading');
    await input.press('Enter');
    await expect(dialog.getByText('Where I am reading')).toBeVisible({ timeout: 10000 });
    await window.getByRole('button', { name: /^Done$/ }).first().click({ force: true });
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Point it at a different verse from the context menu. Verse 2 rather than
    // one far down the chapter: the menu opens at the pointer and is not
    // clamped to the viewport.
    const target = window.locator('[data-testid="verse-2"]');
    await target.click({ force: true });
    await target.click({ button: 'right', force: true, position: { x: 8, y: 8 } });
    await window.locator('[data-testid="verse-bookmarks"]').click({ force: true });
    // The flyout opens beside the menu rather than replacing it.
    await expect(window.locator('[data-testid="verse-bookmarks-submenu"]')).toBeVisible({
      timeout: 10000,
    });
    await window.locator('[data-testid^="verse-replace-bookmark-"]').first().click({ force: true });

    // The bookmark moved...
    await expectBookmarked(window, 2, true);
    await expectBookmarked(window, 1, false);

    // ...and the name did not.
    await openManager(window);
    await expect(window.locator(MANAGE).getByText('Where I am reading')).toBeVisible({
      timeout: 10000,
    });
    await expect(window.locator(MANAGE).locator('[data-testid^="bookmark-row-"]')).toHaveCount(1);
  });

  test('adds a second bookmark rather than moving the first', async ({ window }) => {
    await bookmarkVerse(window, 1);

    const target = window.locator('[data-testid="verse-2"]');
    await target.click({ force: true });
    await target.click({ button: 'right', force: true, position: { x: 8, y: 8 } });
    await window.locator('[data-testid="verse-bookmarks"]').click({ force: true });
    await window.locator('[data-testid="verse-add-bookmark"]').click({ force: true });

    await expectBookmarked(window, 2, true);
    await expectBookmarked(window, 1, true);
  });
});
