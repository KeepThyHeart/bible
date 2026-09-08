/**
 * Copy Functionality E2E Tests
 *
 * Copying a passage is the app's most-used export path.
 *
 * The flow under test: right-click a verse -> "Copy Passage" -> the copy options
 * dialog, which is where format and reference style are chosen. The clipboard
 * itself is not asserted - see the note on the copy test for why the harness
 * cannot observe it.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';
import { selectVerse } from '../fixtures/test-utils';

/** The verse context menu, addressed by the role and label it exposes. */
function verseMenu(window: Page) {
  return window.locator('[role="menu"][aria-label="Verse actions"]');
}

/**
 * Right-click a verse and wait for its menu.
 *
 * Verse 1 rather than 16: the menu is positioned at the pointer, and from a
 * verse far down the chapter it opens below the viewport in the small window
 * these tests run in.
 */
async function openVerseMenu(window: Page): Promise<void> {
  const verse = window.locator('[data-testid="verse-1"]');
  await expect(verse).toBeAttached({ timeout: 15000 });
  // `force` because the Electron window is minimized during the run, which
  // fails Playwright's actionability checks.
  await verse.click({ button: 'right', force: true });
  await expect(verseMenu(window)).toBeVisible({ timeout: 5000 });
}

test.describe('Copy Functionality', () => {
  test.describe('Context Menu', () => {
    test('right-click on a verse opens the verse menu', async ({ window }) => {
      await openVerseMenu(window);

      await expect(verseMenu(window).locator('[role="menuitem"]').first()).toBeVisible();
    });

    test('the menu offers the copy action', async ({ window }) => {
      await openVerseMenu(window);

      // Matched on the visible label rather than position, so reordering the
      // menu does not silently retarget this at "Add Note".
      await expect(verseMenu(window).getByRole('menuitem', { name: /copy/i })).toBeVisible();
    });

    test('clicking elsewhere closes the menu', async ({ window }) => {
      // The assertion the original test described in a comment and never made.
      await openVerseMenu(window);

      await window.locator('[data-testid="bible-chapter-heading"]').click({ force: true });

      await expect(verseMenu(window)).toHaveCount(0, { timeout: 5000 });
    });

    test('Escape closes the menu', async ({ window }) => {
      await openVerseMenu(window);

      await window.keyboard.press('Escape');

      await expect(verseMenu(window)).toHaveCount(0, { timeout: 5000 });
    });
  });

  test.describe('Copy options dialog', () => {
    test('copy passage opens the dialog for the clicked verse', async ({ window }) => {
      await openVerseMenu(window);

      await verseMenu(window).getByRole('menuitem', { name: /copy/i }).click({ force: true });

      const dialog = window.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      // The dialog must arrive already scoped to the verse that was clicked -
      // opening it on the whole chapter would copy the wrong thing by default.
      await expect(dialog).toContainText(/John\s*3:\s*1\b/, { timeout: 5000 });
    });

    test('the dialog previews the text that will be copied', async ({ window }) => {
      await openVerseMenu(window);
      await verseMenu(window).getByRole('menuitem', { name: /copy/i }).click({ force: true });

      const dialog = window.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Nicodemus is in John 3:1 in every translation shipped with the dev
      // dataset, so this checks real verse text reached the preview rather
      // than the dialog merely rendering its chrome.
      await expect(dialog).toContainText(/Nicodemus/i, { timeout: 10000 });
    });

    test('the dialog closes without copying', async ({ window }) => {
      await openVerseMenu(window);
      await verseMenu(window).getByRole('menuitem', { name: /copy/i }).click({ force: true });
      const dialog = window.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      await window.keyboard.press('Escape');

      await expect(dialog).toHaveCount(0, { timeout: 5000 });
    });

    test('the copy button produces the verse and its reference, then dismisses', async ({ window }) => {
      // What is asserted is the *preview*, which `PassageDialog` renders
      // from the same `renderOutput` call that Copy writes to the clipboard -
      // so this covers the formatting, which is where the bugs are.
      //
      // The clipboard itself is deliberately not read back. The renderer writes
      // through `navigator.clipboard`, which the Clipboard API only permits
      // from a focused document; these tests run with the window minimized and
      // the write resolves to nothing. Restoring and focusing the window first
      // does not help under the harness. A clipboard assertion here would
      // therefore report an empty string for a perfectly good copy - worse than
      // no assertion, because it looks like coverage.
      await openVerseMenu(window);
      await verseMenu(window).getByRole('menuitem', { name: /copy/i }).click({ force: true });
      const dialog = window.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      const preview = dialog.getByRole('region', { name: /preview/i });
      await expect(preview).toContainText(/Nicodemus/i, { timeout: 10000 });
      await expect(preview).toContainText(/John\s*3:\s*1\b/);

      await dialog.getByRole('button', { name: /^copy/i }).first().click({ force: true });

      // The dialog dismisses itself on a successful copy - its only
      // externally-visible acknowledgement that the copy ran.
      await expect(dialog).toHaveCount(0, { timeout: 10000 });
    });
  });

  test.describe('Verse selection', () => {
    test('a verse can be selected by clicking its number', async ({ window }) => {
      // Via the shared helper because in Standard mode - the default - only
      // the verse-number gutter selects. The row body is deliberately
      // click-free so a drag across the text highlights instead.
      expect(await selectVerse(window, 1)).toBe(true);

      // `aria-current` is both the accessible signal and the state the Study,
      // Commentary and Topics panes follow.
      await expect(window.locator('[data-testid="verse-1"]')).toHaveAttribute(
        'aria-current', 'true', { timeout: 5000 },
      );
    });

    test('text inside a verse can be selected with the mouse', async ({ window }) => {
      const verse = window.locator('[data-testid="verse-1"]');
      await expect(verse).toBeAttached({ timeout: 15000 });
      const box = await verse.boundingBox();
      expect(box).not.toBeNull();

      // Triple-click selects the whole line, which is what a reader does
      // before Ctrl+C.
      await window.mouse.click(box!.x + 100, box!.y + 10, { clickCount: 3 });

      const selected = await window.evaluate(() => globalThis.getSelection()?.toString() ?? '');
      expect(selected.trim().length).toBeGreaterThan(0);
    });
  });
});
