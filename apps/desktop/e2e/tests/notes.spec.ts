/**
 * User Notes E2E Tests
 *
 * Tests for creating, editing, and managing verse notes.
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';
import { ensurePaneOpen, selectVerse } from '../fixtures/test-utils';

/**
 * The Notes pane.
 *
 * `UserNotesPane` had no test id, so this file addressed it entirely through
 * the accessible names of its buttons ("New Note", "New Folder"). That works
 * until a second pane in the layout grows a button by the same name, at which
 * point the lookup either goes strict-mode-ambiguous or silently drives the
 * wrong pane. The component now carries `data-testid="notes-pane"` on both of
 * its render branches (setup and browser).
 */
function notesPane(window: Page) {
  return window.locator('[data-testid="notes-pane"]');
}

/** The Prayer pane. */
function prayerPane(window: Page) {
  return window.locator('[data-testid="prayer-pane"]');
}

/** "New Note" in the Notes pane's file browser. */
function newNoteButton(window: Page) {
  return notesPane(window).getByRole('button', { name: 'New Note' });
}

test.describe('User Notes', () => {
  test.describe('Notes Pane', () => {
    test('opens with its file browser', async ({ window }) => {
      // Was: locate `[data-testid="notes-pane"], .notes-pane`, count it, and
      // assert nothing - the whole test body was two comments. Neither
      // selector exists in the app; the notes pane is a file browser with no
      // testids, so it is addressed here by the accessible names of its
      // controls.
      await ensurePaneOpen(window, 'Notes');

      await expect(newNoteButton(window)).toBeVisible({ timeout: 15000 });
      await expect(notesPane(window).getByRole('button', { name: 'New Folder' })).toBeVisible();
    });

    test('shows the Verse Notes folder the app writes verse notes into', async ({ window }) => {
      await ensurePaneOpen(window, 'Notes');
      await expect(newNoteButton(window)).toBeVisible({ timeout: 15000 });

      // This folder is created on first run and is where "Add Note" on a verse
      // puts its file. Its absence means verse notes have nowhere to go.
      await expect(notesPane(window).getByText('Verse Notes', { exact: true }).first())
        .toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Note Creation', () => {
    test('Add Note on a verse opens a Notes pane', async ({ window }) => {
      // The bug this covers: the gesture nudging only the notes *store* rather
      // than opening a Notes pane, so with no Notes pane in the layout - which
      // is the default - it does nothing visible at all.
      expect(await selectVerse(window, 1)).toBe(true);
      await expect(window.locator('.dockview-tab-content', { hasText: 'Notes' }))
        .toHaveCount(0);

      await window.locator('[data-testid="verse-1"]').click({ button: 'right', force: true });
      const menu = window.locator('[role="menu"][aria-label="Verse actions"]');
      await expect(menu).toBeVisible({ timeout: 5000 });
      await menu.getByRole('menuitem', { name: /^Add Note$/ }).click({ force: true });

      await expect(window.locator('.dockview-tab-content', { hasText: 'Notes' }).first())
        .toBeVisible({ timeout: 15000 });
      await expect(newNoteButton(window)).toBeVisible({ timeout: 15000 });
    });

    test('Add Note twice reuses the pane instead of stacking another', async ({ window }) => {
      expect(await selectVerse(window, 1)).toBe(true);

      for (const verse of [1, 2]) {
        expect(await selectVerse(window, verse)).toBe(true);
        await window.locator(`[data-testid="verse-${verse}"]`).click({ button: 'right', force: true });
        const menu = window.locator('[role="menu"][aria-label="Verse actions"]');
        await expect(menu).toBeVisible({ timeout: 5000 });
        await menu.getByRole('menuitem', { name: /^Add Note$/ }).click({ force: true });
        await expect(window.locator('.dockview-tab-content', { hasText: 'Notes' }).first())
          .toBeVisible({ timeout: 15000 });
      }

      // A second pane would edit the same files from two places, and the
      // reader would have no way to tell which one holds their unsaved text.
      await expect(window.locator('.dockview-tab-content', { hasText: 'Notes' })).toHaveCount(1);
    });
  });

  test.describe('Note Sync', () => {
    test('the Notes pane survives moving between verses', async ({ window }) => {
      // The original "notes should sync with verse selection" ended on the
      // comment "Notes pane should update without error" and asserted nothing.
      // What can honestly be asserted against this dataset is that the pane
      // stays present and usable as the selection moves - the file browser
      // shows no per-verse state to check sync against, and inventing an
      // assertion for one would be worse than saying so.
      await ensurePaneOpen(window, 'Notes');
      await expect(newNoteButton(window)).toBeVisible({ timeout: 15000 });

      // Back to the Bible tab to move the selection. Opening Notes puts it in
      // the same dockview group, and dockview unmounts the panel it hides - so
      // the Bible pane is not merely invisible, it is gone from the DOM.
      const bibleTab = window.locator('.dockview-tab-content', { hasText: /John\s*3/ }).first();
      await bibleTab.click({ force: true });

      expect(await selectVerse(window, 16)).toBe(true);
      await expect(window.locator('[data-testid="verse-16"]')).toHaveAttribute('aria-current', 'true');
      expect(await selectVerse(window, 17)).toBe(true);
      await expect(window.locator('[data-testid="verse-17"]')).toHaveAttribute('aria-current', 'true');

      await window.locator('.dockview-tab-content', { hasText: 'Notes' }).first().click({ force: true });
      await expect(newNoteButton(window)).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Prayer Tab', () => {
    /**
     * Open the Prayer panel and make it the active tab.
     *
     * `ensurePaneOpen` opens it the way a user does, through the New Tab page.
     * Do not reach for `import('/src/ui/stores/useLayoutStore')` from inside the
     * page: that resolves only under the Vite dev server, and the e2e suite runs
     * against the built app, where it throws.
     */
    async function navigateToPrayerTab(window: Page): Promise<void> {
      await ensurePaneOpen(window, 'Prayer');
      await expect(prayerPane(window)).toBeVisible({ timeout: 15000 });
    }

    /**
     * Helper: Wait for the ProseMirror editor to be ready inside the prayer
     * editor area.  Returns the `.ProseMirror` locator.
     */
    async function waitForPrayerEditor(window: Page) {
      const editor = prayerPane(window).locator('.ProseMirror').last();
      await expect(editor).toBeVisible({ timeout: 15000 });
      return editor;
    }

    /**
     * Helper: Ensure a prayer list exists (creating one via the config dialog
     * if needed) and that it is selected in the dropdown.
     */
    async function ensurePrayerList(window: Page, listName: string) {
      // Every step is an assertion. The previous version reached for
      // `window.locator('select').first()` - which is the Bible toolbar's
      // display-mode dropdown, not the prayer list - found options on it, and
      // so never created a list at all. Wrapped in `if (count > 0)` guards,
      // that failure was invisible.
      // `#prayer-list-select` is the id the pane's own <label htmlFor> points
      // at, so it cannot drift onto another pane's dropdown the way
      // `window.locator('select').first()` did - that matched the Bible
      // toolbar's display-mode select.
      const listDropdown = window.locator('#prayer-list-select');

      if (await listDropdown.locator('option', { hasText: listName }).count() === 0) {
        // A fresh profile has no prayer lists, and the pane shows only
        // "Select a prayer list to view prayers" until one exists.
        const configBtn = window.locator('button[title="Configure Prayer Lists"]');
        await expect(configBtn).toBeVisible({ timeout: 10000 });
        await configBtn.click({ force: true });

        const nameInput = window.locator('input[placeholder*="Prayer list name"]');
        await expect(nameInput).toBeVisible({ timeout: 5000 });
        await nameInput.fill(listName);
        await window.locator('button:has-text("Create")').first().click({ force: true });

        await window.locator('button:has-text("Done")').first().click({ force: true });
        await expect(nameInput).toHaveCount(0, { timeout: 5000 });
      }

      await expect(listDropdown.locator('option', { hasText: listName }))
        .toHaveCount(1, { timeout: 10000 });
      await listDropdown.selectOption({ label: listName });

      // Prayers can only be added once a list is selected; this button is the
      // proof the selection took.
      await expect(newPrayerButton(window)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Helper: Create a new prayer with the given title via the dialog.
     * Returns after the prayer list UI has updated.
     */
    /** "+ New Prayer", scoped to the Prayer pane. */
    function newPrayerButton(window: Page) {
      return prayerPane(window).getByRole('button', { name: '+ New Prayer', exact: true });
    }

    async function createPrayer(window: Page, title: string) {
      await newPrayerButton(window).click({ force: true });

      // `force` throughout: the dialog is a fixed overlay, and an ordinary
      // click is intercepted by it in the minimized window these tests run in.
      // Scoped to the dialog: `PrayerEditor` has a title input of its own, so
      // an unscoped `input[placeholder*="title"]` matches after the dialog has
      // closed and "the dialog is gone" can never become true.
      const titleInput = window.locator('.fixed input[placeholder*="title"]').first();
      await expect(titleInput).toBeVisible({ timeout: 15000 });
      await titleInput.click({ force: true });
      await titleInput.fill(title);
      await expect(titleInput).toHaveValue(title);

      const okBtn = window.locator('.fixed button:has-text("OK")');
      await expect(okBtn).toBeVisible({ timeout: 15000 });
      await okBtn.click({ force: true });
      // The dialog closing, rather than 500ms, is what says the prayer was
      // created - and it is the precondition for the editor remounting.
      await expect(titleInput).toHaveCount(0, { timeout: 15000 });

      await waitForPrayerEditor(window);
      await expect(prayerPane(window).getByText(title, { exact: false }).first())
        .toBeVisible({ timeout: 15000 });
    }

    /**
     * Helper: Type text into the ProseMirror editor.
     * Uses keyboard input which works reliably with contenteditable elements,
     * unlike `.fill()` which can fail on ProseMirror.
     */
    async function typeInEditor(window: Page, text: string) {
      const editor = await waitForPrayerEditor(window);
      await editor.click();
      // Select all existing content and replace it
      await window.keyboard.press('Control+A');
      await window.keyboard.press('Backspace');
      await window.keyboard.type(text, { delay: 10 });
      // The editor showing the text is the wait; the 200ms sleep it replaces
      // could pass before ProseMirror had applied a single keystroke.
      await expect(editor).toContainText(text, { timeout: 15000 });
    }

    /**
     * Leave the Prayer pane for another and come back.
     *
     * Notes takes the Prayer panel's dockview slot, and dockview unmounts the
     * panel it hides - so this is the round trip that loses editor state if the
     * content is not held outside the component.
     */
    async function leaveAndReturn(window: Page): Promise<void> {
      await ensurePaneOpen(window, 'Notes');
      await expect(prayerPane(window)).toHaveCount(0, { timeout: 15000 });
      await navigateToPrayerTab(window);
    }

    test('editing the title updates the prayer list live', async ({ window }) => {
      // Was "should show live updates when typing in prayer editor", and looked
      // for the typed *body* text in a prayer list item. `PrayerListItem`
      // renders the title only - its own comment says "Prayer title only - no
      // description" - so that lookup could never match, and the
      // `if (await prayerListItem.count() > 0)` guard around it meant the test
      // passed while checking nothing.
      //
      // The live link that does exist is title input -> list row, which is what
      // this asserts.
      await navigateToPrayerTab(window);
      await ensurePrayerList(window, 'Test Prayer List');
      await createPrayer(window, 'Original Title');

      const renamed = `Renamed-${Date.now()}`;
      const titleField = prayerPane(window).locator('#prayer-title');
      await expect(titleField).toHaveValue('Original Title', { timeout: 15000 });
      await titleField.fill(renamed);

      await expect(prayerPane(window).getByText(renamed).first())
        .toBeVisible({ timeout: 15000 });
      await expect(prayerPane(window).getByText('Original Title')).toHaveCount(0);
    });

    test('should persist prayer changes when switching tabs', async ({ window }) => {
      await navigateToPrayerTab(window);
      await ensurePrayerList(window, 'Persist Test List');
      await createPrayer(window, 'Persist Test Prayer');

      const uniqueMarker = `PERSIST-${Date.now()}`;
      await typeInEditor(window, uniqueMarker);

      await leaveAndReturn(window);

      await expect(await waitForPrayerEditor(window))
        .toContainText(uniqueMarker, { timeout: 15000 });
    });

    test('should preserve prayer content after switching tabs (KAN-17 regression)', async ({ window }) => {
      // KAN-17: prayer content was lost or reverted to stale data after a tab
      // switch. The check was three `if` levels deep, so the regression it
      // guards could return without failing anything.
      await navigateToPrayerTab(window);
      await ensurePrayerList(window, 'KAN-17 Content Test List');
      await createPrayer(window, `Content-Test-${Date.now()}`);

      const uniqueContent = `UNIQUE-CONTENT-${Date.now()}`;
      await typeInEditor(window, uniqueContent);

      await leaveAndReturn(window);

      await expect(await waitForPrayerEditor(window))
        .toContainText(uniqueContent, { timeout: 15000 });
    });

    test('should show correct prayer title after switching tabs (KAN-17 regression)', async ({ window }) => {
      // KAN-17: the prayer showed "Untitled Prayer" after switching back.
      await navigateToPrayerTab(window);
      await ensurePrayerList(window, 'Test List for KAN-17');
      const uniqueTitle = `Prayer-KAN17-${Date.now()}`;
      await createPrayer(window, uniqueTitle);

      await leaveAndReturn(window);

      await expect(prayerPane(window).getByText(uniqueTitle).first())
        .toBeVisible({ timeout: 15000 });
      // The regression's actual signature. Check it unconditionally - guarding on
      // `if (untitledCount > 0)` and re-asserting the title says nothing about
      // the placeholder either way.
      await expect(prayerPane(window).getByText('Untitled Prayer')).toHaveCount(0);
    });

    test('should preserve selected prayer title and color after editing another prayer and switching tabs (KAN-17 full regression)', async ({ window }) => {
      await navigateToPrayerTab(window);
      await ensurePrayerList(window, 'KAN-17 Full Test');

      const prayerTitle = `FullTest-Prayer-${Date.now()}`;
      await createPrayer(window, prayerTitle);
      await typeInEditor(window, 'Test content for KAN-17 full regression');

      await leaveAndReturn(window);

      await expect(prayerPane(window).getByText(prayerTitle).first())
        .toBeVisible({ timeout: 15000 });
      await expect(await waitForPrayerEditor(window))
        .toContainText('Test content for KAN-17 full regression', { timeout: 15000 });
    });
  });

  test.describe('Note Persistence', () => {
    /**
     * Create a note through the file browser and return its editor.
     *
     * A note has to be created first: looking for
     * `[data-testid="note-editor"], [contenteditable="true"], textarea` on a
     * pane where none has been opened finds nothing, and the tests below are
     * then left with nothing to assert against.
     */
    async function createNote(window: Page, name: string) {
      await ensurePaneOpen(window, 'Notes');
      const newNote = newNoteButton(window);
      await expect(newNote).toBeVisible({ timeout: 15000 });
      await newNote.click({ force: true });

      const nameInput = window.locator('input[placeholder="My New Note"]');
      await expect(nameInput).toBeVisible({ timeout: 5000 });
      await nameInput.fill(name);
      await window.getByRole('button', { name: 'Create', exact: true }).click({ force: true });

      const editor = window.locator('.ProseMirror').last();
      await expect(editor).toBeVisible({ timeout: 15000 });
      return editor;
    }

    /** Type into the ProseMirror editor - `.fill()` does not work on it. */
    async function typeNote(window: Page, editor: ReturnType<Page['locator']>, text: string) {
      await editor.click({ force: true });
      await window.keyboard.type(text, { delay: 10 });
      await expect(editor).toContainText(text, { timeout: 10000 });
    }

    test('note content survives switching to another tab and back', async ({ window }) => {
      const marker = 'KEEP-THIS-TEXT';
      const editor = await createNote(window, `persist-${Date.now()}`);
      await typeNote(window, editor, marker);

      // Away to another pane and back. Whether dockview unmounts the notes
      // panel depends on which group it landed in, so this does not assert
      // that it did - only that the text is still there afterwards, which is
      // the property that matters either way.
      await window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first()
        .click({ force: true });
      await expect(window.locator('[data-testid="commentary-pane"]').first())
        .toBeVisible({ timeout: 10000 });

      await window.locator('.dockview-tab-content', { hasText: 'Notes' }).first()
        .click({ force: true });

      await expect(window.locator('.ProseMirror').last())
        .toContainText(marker, { timeout: 15000 });
    });

    test('a note reopened from the browser still has its text', async ({ window }) => {
      // The round trip through disk, rather than through component state.
      const name = `roundtrip-${Date.now()}`;
      const marker = 'WRITTEN-TO-DISK';
      const editor = await createNote(window, name);
      await typeNote(window, editor, marker);

      // Back to the file list, then into the note again.
      await window.getByRole('button', { name: 'Home' }).first().click({ force: true });
      await expect(newNoteButton(window)).toBeVisible({ timeout: 15000 });

      await window.getByRole('button', { name: new RegExp(name) }).first().click({ force: true });

      await expect(window.locator('.ProseMirror').last())
        .toContainText(marker, { timeout: 15000 });
    });
  });
});
