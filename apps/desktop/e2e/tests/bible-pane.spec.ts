/**
 * Bible Pane E2E Tests
 *
 * Tests for Bible text display, navigation, and verse selection.
 */

import { test, expect } from '../fixtures/electron.fixture';

/**
 * Switching display mode re-renders the whole chapter, which takes several
 * seconds in a built Electron app and longer when workers run in parallel.
 * Playwright's default action timeout is too tight for it.
 */
const MODE_SWITCH_TIMEOUT = 60000;

test.describe('Bible Pane', () => {
  test('should display app with Bible pane and default chapter (John 3)', async ({ window }) => {
    // Check that app loaded and Bible pane is visible
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();
    await expect(window.locator('[data-testid="bible-pane"]')).toBeVisible();

    // The app defaults to John 3
    const heading = window.locator('[data-testid="bible-chapter-heading"]');
    await expect(heading).toContainText('John');
    await expect(heading).toContainText('3');

    // Should have verse numbers (John 3 has 36 verses)
    const verses = window.locator('[data-testid^="verse-"]');
    const count = await verses.count();
    expect(count).toBeGreaterThan(0);

    // John 3:16 should be visible and contain expected text
    const verse16 = window.locator('[data-testid="verse-16"]');
    await expect(verse16).toBeVisible();
    await expect(verse16).toContainText(/God.*loved/i);
  });

  test.describe('Navigation', () => {
    test('should navigate to next and previous chapter', async ({ window }) => {
      const heading = window.locator('[data-testid="bible-chapter-heading"]');
      const initialText = await heading.textContent();

      // Click next chapter - use force:true because the window is minimized
      // after the fixture setup, which fails Playwright's default visibility checks.
      await window.click('[data-testid="next-chapter"]', { force: true });

      // Retrying assertions instead of sleep-then-read: they pass the moment
      // the chapter lands and report the actual heading when it does not,
      // rather than failing on whatever the heading happened to say at 500ms.
      await expect(heading).not.toHaveText(initialText ?? '', { timeout: 10000 });

      // Now go back
      await window.click('[data-testid="prev-chapter"]', { force: true });

      await expect(heading).toHaveText(initialText ?? '', { timeout: 10000 });
    });
  });

  test.describe('Display Modes', () => {
    test('should have display mode dropdown and switch modes', async ({ window }) => {
      test.slow(); // three full-chapter re-renders

      // Display mode select should be visible
      const modeSelect = window.locator('[data-testid="display-mode-select"]');
      await expect(modeSelect).toBeVisible();

      // Switch to standard mode
      await modeSelect.selectOption('standard', { timeout: MODE_SWITCH_TIMEOUT });

      await expect(modeSelect).toHaveValue('standard');

      // Switch to study mode
      await modeSelect.selectOption('study', { timeout: MODE_SWITCH_TIMEOUT });

      await expect(modeSelect).toHaveValue('study');

      // Switch back to reading mode
      await modeSelect.selectOption('reading', { timeout: MODE_SWITCH_TIMEOUT });

      await expect(modeSelect).toHaveValue('reading');
    });
  });

  test.describe('Verse Selection', () => {
    test('should select verse when verse number is clicked', async ({ window }) => {
      test.slow(); // switching display mode re-renders the chapter

      // The verse-number gutter only exists in standard mode - reading mode (the
      // app default) renders verses as flowing paragraphs with no number column.
      const modeSelect = window.locator('[data-testid="display-mode-select"]');
      await modeSelect.selectOption('standard', { timeout: MODE_SWITCH_TIMEOUT });
      await expect(modeSelect).toHaveValue('standard', { timeout: MODE_SWITCH_TIMEOUT });

      // The click handler is on the verse number element, which is inside the verse container
      // Find verse 16's clickable verse number (the div with the number text)
      const verse16Container = window.locator('[data-testid="verse-16"]');

      // Click the verse. The verse number is not its own click target - clicking
      // anywhere on the row selects - and the row's pointer cursor comes from
      // the `.verse-row` CSS class rather than a Tailwind utility, so there is
      // no `.cursor-pointer` element to aim at.
      await verse16Container.click();

      // Verse should have selection styling (theme token, not a raw palette class)
      await expect(verse16Container).toHaveClass(/verse-selected/);
    });
  });

  test.describe('Module Selector', () => {
    test('should not display trailing 0 in module names', async ({ window }) => {
      // Wait for app to load
      await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();

      // Open the module selector from the toolbar's version button. There is no
      // longer an in-pane "+" tab: a passage is a dockview panel, so the only
      // module picker inside the pane is "change this passage's translation".
      const versionButton = window.locator('[data-testid="bible-pane"] button', {
        hasText: /^KJV/,
      }).first();
      await versionButton.click({ force: true });

      // The selector can be slow to render with 100+ modules, which is what
      // the assertion timeout is for - the 2s sleep in front of it added
      // nothing on a warm run and nothing on a cold one either.
      const moduleNames = window.locator('.font-semibold.text-text-heading');
      await expect(moduleNames.first()).toBeVisible({ timeout: 20000 });
      const count = await moduleNames.count();
      expect(count).toBeGreaterThan(0);

      // Check each module name to ensure no trailing "0" from the JSX rendering bug
      // The bug was: {openCount && openCount > 0 && ...} would render "0" when openCount is 0
      // because 0 is a valid React child. The fix changed it to use openCount !== undefined
      for (let i = 0; i < Math.min(count, 10); i++) {
        const nameText = await moduleNames.nth(i).textContent();
        if (nameText) {
          const trimmedName = nameText.trim();
          // The specific bug was rendering "0" after module names like "1869 Noyes Translation0"
          // A valid name ending might be: year in parens "(1912)", "(1 open)", or a letter
          // The bug case is: ends with letter followed by "0" (e.g., "Translation0", "Version0")
          const hasBuggyTrailingZero = /[a-zA-Z]0$/.test(trimmedName);
          expect(hasBuggyTrailingZero).toBe(false);
        }
      }

      // Close the selector
      await window.keyboard.press('Escape');
    });
  });
});
