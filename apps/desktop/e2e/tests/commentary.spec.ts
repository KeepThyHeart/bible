/**
 * Commentary Pane E2E Tests
 *
 * ## Why this file was rewritten
 *
 * Almost every test was either guarded (`if (await x.count() > 0) { ... }`) or
 * asserted a set wide enough to swallow the failure it was meant to catch -
 * `text=/Commentaries on|No commentaries|Navigate to a verse/` passes whether
 * the pane loaded commentary, found none, or has no verse at all.
 *
 * Two were outright dead:
 *   - the module-expansion test looked for `.hover\:bg-gray-50.cursor-pointer`,
 *     while the module header's class is `hover:bg-background-hover`, so the
 *     count was always 0 and the test logged "skipping" and returned;
 *   - the tab-management test nested three `count() > 0` guards, so its one
 *     assertion was reached only if all three happened to hold.
 *
 * Everything below asserts unconditionally, and the verse-synchronisation cases
 * assert on `commentary-verse-ref` - the reference the reader actually reads -
 * rather than on the absence of an error element.
 */

import { test, expect, Page } from '../fixtures/electron.fixture';
import { selectVerse } from '../fixtures/test-utils';

const pane = (window: Page) => window.locator('[data-testid="commentary-pane"]');
const overviewTab = (window: Page) => pane(window).locator('[data-testid="commentary-overview-tab"]').first();
const verseRef = (window: Page) => pane(window).locator('[data-testid="commentary-verse-ref"]').first();
const moduleRows = (window: Page) => pane(window).locator('[data-testid="commentary-home-module"]');
const modulePreviews = (window: Page) => pane(window).locator('[data-testid="commentary-home-module-preview"]');

/**
 * Click the Commentary dockview tab so the commentary pane becomes visible.
 * The default active tab is Study, so every commentary test must do this first.
 */
async function activateCommentaryTab(window: Page): Promise<void> {
  // force: the window under test may be minimized, which fails Playwright's
  // actionability check on an element that is perfectly interactable.
  await window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first().click({ force: true });
  await expect(pane(window)).toBeVisible({ timeout: 15000 });
}

/**
 * Open a real commentary module tab.
 *
 * Most of these tests need one: the Overview tab has neither a verse reference
 * nor a pin button, so a test that stayed on Overview could only ever assert
 * their absence - which is how the originals ended up guarded.
 */
async function openCommentaryTab(window: Page): Promise<void> {
  await pane(window).locator('button:has-text("+")').first().click({ force: true });

  const selector = window.locator('[data-testid="module-selector"]');
  await expect(selector).toBeVisible({ timeout: 10000 });
  await expect(selector.locator('[data-testid="module-selector-item"]').first())
    .toBeVisible({ timeout: 10000 });

  // Enter, not a click on the first row. The list re-sorts as the per-verse
  // availability check resolves ("has content for this verse" first), so the
  // element found a moment ago is routinely replaced before the click lands -
  // and `{ force: true }` makes that worse, not better, because forcing skips
  // the actionability wait that would otherwise catch the swap. Enter goes
  // through `ModuleSelector.handleKeyDown`, which reads the CURRENT list.
  // `reference-links.spec.ts` reached the same conclusion independently.
  await selector.locator('input').first().press('Enter');

  await expect(selector).toHaveCount(0, { timeout: 10000 });
}

test.describe('Commentary Pane', () => {
  test.beforeEach(async ({ window }) => {
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible({ timeout: 20000 });
    await activateCommentaryTab(window);
  });

  test.describe('Overview tab', () => {
    test('opens on Overview and lists modules for the current verse', async ({ window }) => {
      await expect(overviewTab(window)).toBeVisible();
      await expect(moduleRows(window).first()).toBeVisible({ timeout: 15000 });
    });

    test('offers the add button and the module filter', async ({ window }) => {
      await expect(pane(window).locator('button:has-text("+")').first()).toBeVisible();
      // By accessible name, not by placeholder text: the placeholder is copy
      // that gets reworded (it now says what it filters *by*), and the field
      // has a real label to match on.
      await expect(pane(window).getByRole('textbox', { name: /filter by commentary name/i }))
        .toBeVisible({ timeout: 15000 });
    });

    test('shows no pin button or verse reference on Overview', async ({ window }) => {
      // Both belong to a commentary tab. Offering to pin on Overview would be
      // offering to pin something that is not open.
      await expect(moduleRows(window).first()).toBeVisible({ timeout: 15000 });
      await expect(pane(window).locator('button[title*="Pin commentary"], button[title*="Unpin commentary"]')).toHaveCount(0);
      await expect(pane(window).locator('[data-testid="commentary-verse-ref"]')).toHaveCount(0);
    });
  });

  test.describe('Module expansion in Overview', () => {
    test('expands and collapses a module preview', async ({ window }) => {
      const moduleHeader = moduleRows(window).first();
      await expect(moduleHeader).toBeVisible({ timeout: 15000 });
      await expect(modulePreviews(window)).toHaveCount(0);

      await moduleHeader.click({ force: true });
      await expect(modulePreviews(window).first()).toBeVisible({ timeout: 10000 });
      await expect(modulePreviews(window).first()).not.toBeEmpty();

      await moduleHeader.click({ force: true });
      await expect(modulePreviews(window)).toHaveCount(0);
    });
  });

  test.describe('Tab management', () => {
    test('opens a commentary from the selector and switches back to Overview', async ({ window }) => {
      await openCommentaryTab(window);

      // A commentary tab is open, so the toolbar now carries the verse reference.
      await expect(verseRef(window)).toBeVisible({ timeout: 15000 });

      await overviewTab(window).click({ force: true });
      await expect(moduleRows(window).first()).toBeVisible({ timeout: 15000 });
      await expect(pane(window).locator('[data-testid="commentary-verse-ref"]')).toHaveCount(0);
    });

    test('shows the pin button on a commentary tab', async ({ window }) => {
      await openCommentaryTab(window);

      await expect(pane(window).locator('button[title*="Pin commentary"], button[title*="Unpin commentary"]').first())
        .toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Sync with Bible', () => {
    test('follows the verse clicked in the Bible pane', async ({ window }) => {
      await openCommentaryTab(window);
      const ref = verseRef(window);
      await expect(ref).toBeVisible({ timeout: 15000 });

      // selectVerse, not a plain click: verse selection is driven from the
      // gutter (`.cursor-pointer`), and clicking the verse text itself does not
      // change the selection - which is why the original test could only check
      // that no error appeared.
      expect(await selectVerse(window, 5)).toBe(true);
      await expect(ref).toContainText(':5', { timeout: 10000 });

      expect(await selectVerse(window, 9)).toBe(true);
      await expect(ref).toContainText(':9', { timeout: 10000 });

      await expect(pane(window).locator('.text-red-600')).toHaveCount(0);
    });

    test('re-runs the Overview for the newly selected verse', async ({ window }) => {
      // Expand a module, then move the selection: the preview must follow the
      // new verse rather than keep showing the previous verse's commentary.
      const first = moduleRows(window).first();
      await expect(first).toBeVisible({ timeout: 15000 });
      await first.click({ force: true });

      const preview = modulePreviews(window).first();
      await expect(preview).toBeVisible({ timeout: 10000 });
      const before = await preview.innerText();
      expect(before.trim().length).toBeGreaterThan(0);

      expect(await selectVerse(window, 3)).toBe(true);

      await expect.poll(async () => {
        const rows = modulePreviews(window);
        return (await rows.count()) > 0 ? await rows.first().innerText() : '';
      }, { timeout: 15000 }).not.toBe(before);
    });
  });
});
