/**
 * Pop-Out / Detach Pane E2E Tests
 *
 * Tests for the pop-out-to-window functionality.
 * Verifies that when a pane is popped out:
 * - A new window is created
 * - The new window preserves the pane's current state (not a blank slate)
 * - The new window renders the correct pane component with content
 * - The original main window remains functional
 *
 * Each test ensures the pane has real content before popping it out.
 *
 * Covers: Commentary, Bible, Notes, Books, Dictionary panes
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';
import { ensurePaneOpen, selectVerse, waitForAppReady } from '../fixtures/test-utils';

/**
 * Dismiss any modal dialogs that might be blocking the UI.
 * Common modals: "Set Up Your Notes Folder", module selector, etc.
 */
async function dismissModals(window: Page) {
  // Dismiss notes folder setup dialog
  // Use count() only (not isVisible) since minimized windows fail visibility checks
  const useThisFolder = window.locator('button:has-text("Use This Folder")');
  if (await useThisFolder.count() > 0) {
    await useThisFolder.click({ force: true });
    // The dialog going away is the condition the sleep stood in for.
    await expect(useThisFolder).toHaveCount(0, { timeout: 15000 });
    return;
  }

  // Dismiss module selector modal (has a Close button)
  const closeBtn = window.locator('.fixed.inset-0 button:has-text("Close")');
  if (await closeBtn.count() > 0) {
    await closeBtn.click({ force: true });
    await expect(closeBtn).toHaveCount(0, { timeout: 15000 });
  }
}

/**
 * Right-click a dockview tab by its text content.
 * Uses force:true to avoid intermittent stability timeouts in minimized windows.
 */
async function rightClickTab(window: Page, tabText: string | RegExp) {
  // Dismiss modals first so they don't intercept clicks
  await dismissModals(window);

  const tab = window.locator('.dockview-tab-content', { hasText: tabText }).first();
  // Use toBeAttached instead of toBeVisible - minimized windows fail visibility checks
  await expect(tab).toBeAttached({ timeout: 5000 });
  await tab.click({ button: 'right', force: true });
}

/**
 * Click "Pop Out to Window" from an open context menu.
 */
async function clickPopOut(window: Page) {
  const popOutItem = window.locator('button:has-text("Pop Out to Window")');
  // Use toBeAttached instead of toBeVisible - minimized windows fail visibility checks.
  // This assertion is also what absorbs the wait for the context menu to open,
  // in place of a fixed sleep inside `rightClickTab`.
  await expect(popOutItem).toBeAttached({ timeout: 15000 });
  await popOutItem.click({ force: true });
}

/**
 * Assert the detached page completed its IPC handshake and mounted a real pane.
 *
 * It waits on the testids the DetachedWindow component sets for each of its
 * three states, so "stuck loading" and "unknown component" both fail loudly.
 * Do not assert on the length of `#detached-root` instead: the loading screen's
 * own copy ("Loading pane..." + "Initializing detached window") is 43
 * characters, so a window that never received `initialize-pane` would pass.
 *
 * Uses toBeAttached rather than toBeVisible throughout - the main window is
 * minimized during these runs and visibility checks are unreliable for it.
 */
async function assertDetachedLoaded(detachedPage: Page, expectedPaneType?: string) {
  // Wait for the page's load event to fire (scripts executed and React mounted)
  await detachedPage.waitForLoadState('load', { timeout: 15000 });

  // The pane wrapper only renders once 'initialize-pane' has been received and
  // a component resolved out of COMPONENT_MAP. Timeout covers the IPC
  // round-trip plus first render.
  const pane = detachedPage.locator('[data-testid="detached-pane"]');
  await expect(pane).toBeAttached({ timeout: 15000 });

  // Neither the loading screen nor the error screen should still be present.
  await expect(detachedPage.locator('[data-testid="detached-loading"]')).toHaveCount(0);
  await expect(detachedPage.locator('[data-testid="detached-error"]')).toHaveCount(0);
  await expect(detachedPage.locator('text=Unknown component')).toHaveCount(0);

  if (expectedPaneType) {
    await expect(pane).toHaveAttribute('data-pane-type', expectedPaneType);
  }
}

test.describe('Pop Out to Window', () => {
  test('Commentary: open a commentary tab, pop out, verify content preserved', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Activate the Commentary dockview tab (default active tab is Study/Bible)
    const commentaryDockTab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
    await commentaryDockTab.click({ force: true });

    const commentaryPane = window.locator('[data-testid="commentary-pane"]');
    await expect(commentaryPane).toBeAttached({ timeout: 15000 });

    // Content before the pop-out, so "content preserved" means something.
    //
    // The default profile already opens SYNTHESIS, so there is no need to drive
    // the module picker here. Note the picker does not close on Enter, so
    // opening it and pressing Enter would select nothing.
    await expect(commentaryPane).toContainText(/\w{4}/, { timeout: 20000 });

    // Pop out the commentary
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Commentary');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'commentary');

    // The detached window must mount the actual commentary pane, not just any
    // component that happens to render some text.
    await expect(detachedPage.locator('[data-testid="commentary-pane"]'))
      .toBeAttached({ timeout: 10000 });
  });

  test('Bible: pop out with John 3 loaded, verify passage text preserved', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Verify Bible pane has John 3 loaded with verses in DOM
    await expect(window.locator('[data-testid="bible-pane"]')).toBeAttached({ timeout: 5000 });
    const heading = window.locator('[data-testid="bible-chapter-heading"]');
    await expect(heading).toContainText('John');
    const verse16 = window.locator('[data-testid="verse-16"]');
    await expect(verse16).toBeAttached({ timeout: 5000 });

    // Pop out the Bible pane. Its dockview tab is titled with the passage
    // ("John 3" over "KJV"), not the generic word "Bible" - a passage is a
    // top-level panel.
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'John 3');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'bible');

    // The point of pop-out is that the passage comes across. Assert the actual
    // passage, not a character count - a blank Bible pane with chrome around it
    // easily clears any length threshold.
    await expect(detachedPage.locator('[data-testid="bible-pane"]'))
      .toBeAttached({ timeout: 10000 });
    await expect(detachedPage.locator('[data-testid="bible-chapter-heading"]'))
      .toContainText('John', { timeout: 10000 });
    await expect(detachedPage.locator('[data-testid="verse-16"]'))
      .toBeAttached({ timeout: 10000 });
  });

  test('Notes: pop out notes pane, verify it renders', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Open/activate the Notes pane - not part of the first-run layout
    await ensurePaneOpen(window, 'Notes');

    // Handle the "Set Up Your Notes Folder" dialog if it appears
    await dismissModals(window);

    // Pop out the Notes pane (the file browser should already have content)
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Notes');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'verse-notes');
  });

  test('Books: open a book, pop out, verify book content preserved', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Open/activate the Books pane - not part of the first-run layout
    await ensurePaneOpen(window, 'Books');

    // A Books pane with nothing open lands on its shelf ("New Tab"), which
    // lists every installed book. Open the first one from there.
    const shelf = window.locator('[data-testid="library-home"]');
    await expect(shelf).toBeVisible({ timeout: 15000 });
    const bookItem = shelf.locator('[data-testid^="library-item-"]').first();
    // Use force:true since the main window may be minimized during tests.
    await bookItem.click({ force: true });
    // A book tab appearing is what says the click opened something.
    await expect(window.locator('[data-testid="book-tab-icon-book"]').first())
      .toBeAttached({ timeout: 15000 });

    // Pop out the Books pane.
    // The quick-action button reads "Books" but the tab title resolves through
    // `paneName.book`, a bare singular noun - see expectedTabText() in
    // e2e/fixtures/test-utils.ts. Match either form.
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, /Books?/);
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'book');

    // DockviewTabRenderer has to gather pop-out state for the Books pane too, not
    // only bible/commentary/notes, or the detached window renders a blank pane.
    // A length-based assertion would pass on a blank pane, so assert on content.
    await expect(detachedPage.locator('[data-testid="books-pane"]'))
      .toBeAttached({ timeout: 10000 });
  });

  test('Dictionary: pop out with dictionary loaded, verify content preserved', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Activate the Dictionary pane (in the first-run layout; `ensurePaneOpen`
    // opens one if it is not).
    await ensurePaneOpen(window, 'Dictionary');

    // Actually open a dictionary. The test is named "with dictionary loaded"
    // but nothing loaded one, so the pane sat on its empty reference shelf,
    // handed over an empty `dictOpenTabs`, and the detached window had nothing
    // to render - which is the state the assertion below is meant to rule out.
    //
    // A Dictionary pane with nothing open lands on its Overview shelf, which
    // lists every installed dictionary and none of the books.
    const shelf = window.locator('[data-testid="library-home"]');
    await expect(shelf).toBeVisible({ timeout: 15000 });
    await shelf.locator('[data-testid^="library-item-"]').first().click({ force: true });

    await expect(window.locator('[data-testid="dictionary-pane"]'))
      .toBeAttached({ timeout: 15000 });

    // Pop out the Dictionary pane
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Dictionary');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    // 'book', not 'dictionary'. `BookPane` is the component behind both content
    // types, and `DockviewTabRenderer`'s `paneTypeMap` deliberately sends both
    // to the 'book' window type (carrying the dictionary state, and `paneKind`,
    // in its own branch). What makes the new window a dictionary is `paneKind`,
    // which is what the next assertion is for.
    await assertDetachedLoaded(detachedPage, 'book');

    await expect(detachedPage.locator('[data-testid="dictionary-pane"]'))
      .toBeAttached({ timeout: 10000 });
  });

  test('main window remains functional after popping out commentary', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Pop out commentary
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Commentary');
    await clickPopOut(window);
    await detachedWindowPromise;

    // Main window should still be functional
    // Use toBeAttached since the main window is minimized during tests
    const biblePane = window.locator('[data-testid="bible-pane"]');
    await expect(biblePane).toBeAttached({ timeout: 5000 });

    // Should still be able to navigate chapters
    const heading = window.locator('[data-testid="bible-chapter-heading"]');
    const beforeText = await heading.textContent();

    await window.locator('[data-testid="next-chapter"]').click({ force: true });

    // Retrying assertion rather than a sleep-then-read: this passes as soon as
    // the chapter changes, and fails with the actual heading if it never does.
    await expect(heading).not.toHaveText(beforeText ?? '', { timeout: 10000 });
  });

  test('commentary pop-out preserves current verse context', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    // Click verse 5 to sync commentary to a specific verse
    // Use force:true since the main window may be minimized during tests
    // `selectVerse` rather than a click on the verse container: the click
    // handler lives on the verse-number gutter, so clicking the container
    // selects nothing - which is why the old `if (count > 0)` block ran and
    // silently achieved nothing. Selection registering is the precondition for
    // the sync this test is about.
    expect(await selectVerse(window, 5)).toBe(true);

    // Pop out the commentary pane
    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Commentary');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'commentary');

    // Actually check the verse context came across. `bodyText.length > 50` will
    // not do - the loading screen alone satisfies it.
    await expect(detachedPage.locator('[data-testid="commentary-pane"]'))
      .toBeAttached({ timeout: 10000 });
    await expect(detachedPage.locator('body')).toContainText(/John\s*3/, { timeout: 10000 });
  });

  test('detached window keeps its pane-specific title, not the generic page title', async ({ electronApp, window }) => {
    // detached.html carries its own <title>; without suppressing
    // 'page-title-updated' in WindowManager it overwrites the title computed by
    // paneConfig.titleFormat, and every popped-out window reads the same.
    await waitForAppReady(window);

    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'John 3');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'bible');

    // Identify the detached window by its URL - getAllWindows() order is not
    // guaranteed, and the main window is often last.
    const title = await electronApp.evaluate(({ BrowserWindow }) => {
      const detached = BrowserWindow.getAllWindows()
        .filter(w => !w.isDestroyed() && w.webContents.getURL().includes('detached'));
      return detached[0]?.getTitle() ?? '';
    });

    expect(title).toContain('John');
    expect(title).not.toContain('Detached Pane');
  });

  test('closing a detached window leaves the main window working', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    const detachedWindowPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Commentary');
    await clickPopOut(window);

    const detachedPage = await detachedWindowPromise;
    await assertDetachedLoaded(detachedPage, 'commentary');

    await detachedPage.close();
    // Wait for the close to actually land, rather than for 500ms: the point of
    // the test is what the main process does once the window is gone.
    await expect.poll(() => detachedPage.isClosed(), { timeout: 15000 }).toBe(true);

    // The main window must still navigate after a detached window goes away -
    // a verse-change broadcast to a closed window would throw in the main
    // process and take navigation down with it.
    const heading = window.locator('[data-testid="bible-chapter-heading"]');
    const before = await heading.textContent();
    await window.locator('[data-testid="next-chapter"]').click({ force: true });
    await expect(heading).not.toHaveText(before ?? '', { timeout: 10000 });
  });

  test('two panes can be popped out at once', async ({ electronApp, window }) => {
    await waitForAppReady(window);

    const firstPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'Commentary');
    await clickPopOut(window);
    const first = await firstPromise;
    await assertDetachedLoaded(first, 'commentary');

    const secondPromise = electronApp.waitForEvent('window');
    await rightClickTab(window, 'John 3');
    await clickPopOut(window);
    const second = await secondPromise;
    await assertDetachedLoaded(second, 'bible');

    // Each window keeps its own pane - a shared window id or a reused renderer
    // would show the same content in both.
    expect(first).not.toBe(second);
    await expect(first.locator('[data-testid="commentary-pane"]')).toBeAttached();
    await expect(second.locator('[data-testid="bible-pane"]')).toBeAttached();
  });
});
