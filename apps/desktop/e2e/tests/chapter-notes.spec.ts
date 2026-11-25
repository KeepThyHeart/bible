/**
 * Chapter mode of the Notes pane (task 0216), behind the default-off `chapterNotes` flag.
 *
 * A release build ignores flag overrides, but an unpackaged run (these tests) reads `KTH_FLAGS`
 * through the preload. Run the "on" tests with `KTH_FLAGS=chapterNotes pnpm exec playwright test chapter-notes`;
 * without it only the "off" test runs.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';
import { ensurePaneOpen } from '../fixtures/test-utils';

const FLAG_ON = /\bchapterNotes\b/.test(process.env.KTH_FLAGS ?? '') && !/-chapterNotes/.test(process.env.KTH_FLAGS ?? '');

const notesPane = (w: Page) => w.locator('[data-testid="notes-pane"]');

async function openJohn316Note(w: Page): Promise<void> {
  await ensurePaneOpen(w, 'Notes');
  // First run: the notes-folder setup dialog (not inside the pane) appears; accept the default folder.
  const useFolder = w.getByRole('button', { name: 'Use This Folder' });
  if (await useFolder.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) {
    await useFolder.click({ force: true });
    await expect(useFolder).toHaveCount(0, { timeout: 15000 });
  }
  await w.evaluate(() => window.dispatchEvent(new CustomEvent('open-verse-note', { detail: { verseId: 43003016 } })));
  await expect(notesPane(w).locator('.ProseMirror').first()).toBeVisible({ timeout: 15000 });
}

test.describe('Chapter mode (chapterNotes flag)', () => {
  test('is not offered while the flag is off', async ({ window }) => {
    test.skip(FLAG_ON, 'flag is on for this run');
    await openJohn316Note(window);
    await expect(window.locator('[data-testid="notes-open-chapter"]')).toHaveCount(0);
  });

  test('enters from a verse note, writes a note on save, and leaves it as a file', async ({ window }) => {
    test.skip(!FLAG_ON, 'needs KTH_FLAGS=chapterNotes');
    await openJohn316Note(window);
    await window.locator('[data-testid="notes-open-chapter"]').click();
    await expect(window.locator('[data-testid="chapter-notes-view"]')).toBeVisible({ timeout: 15000 });
    await expect(window.locator('[data-testid="chapter-verse-text-16"]')).toContainText('For God so loved');

    await window.locator('[data-testid="chapter-add-17"]').click();
    const editor = window.locator('[data-testid="chapter-editor-17"] .ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await window.keyboard.type('Chapter mode e2e note');

    // Leaving the note saves it (create-on-save): activate another verse.
    await window.locator('[data-testid="chapter-add-18"]').click();
    await expect(window.locator('[data-testid="chapter-note-17"]')).toContainText('Chapter mode e2e note', { timeout: 15000 });

    // Only-with-notes filter keeps verse 17 and hides a verse without a note.
    await window.locator('[data-testid="chapter-only-notes"]').click();
    await expect(window.locator('[data-testid="chapter-row-17"]')).toBeVisible();
    await expect(window.locator('[data-testid="chapter-row-20"]')).toHaveCount(0);
  });

  test('notes zoom changes the viewing size only', async ({ window }) => {
    test.skip(!FLAG_ON, 'needs KTH_FLAGS=chapterNotes');
    await openJohn316Note(window);
    await window.locator('[data-testid="notes-open-chapter"]').click();
    await expect(window.locator('[data-testid="chapter-notes-view"]')).toBeVisible({ timeout: 15000 });
    await window.locator('[data-testid="notes-zoom-in"]').first().click();
    await expect(window.locator('[data-testid="notes-zoom-reset"]').first()).toHaveText('110%');
    await expect(window.locator('[data-testid="chapter-scroll"]')).toHaveCSS('zoom', '1.1');
    await window.locator('[data-testid="notes-zoom-reset"]').first().click();
  });
});
