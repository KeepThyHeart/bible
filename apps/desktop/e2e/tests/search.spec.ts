/**
 * Search E2E Tests
 *
 * Tests for Bible search functionality including cross-module search.
 */

import type { Page, Locator } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';
import { waitForAppReady } from '../fixtures/test-utils';

/**
 * Search takes a round trip through IPC into SQLite FTS across every installed
 * module, and four Electron instances share the machine during a run. Every
 * assertion here used a 3-5s timeout preceded by a 1-3s sleep; a single
 * generous timeout is both faster on the common path and steadier on the slow one.
 */
const SEARCH_TIMEOUT = 25000;

function results(window: Page): Locator {
  return window.locator('[data-testid="search-result"]');
}

function resultsPane(window: Page): Locator {
  return window.locator('[data-testid="search-results"]');
}

/** Type a query into the global search bar and submit it. */
async function runSearch(window: Page, query: string): Promise<void> {
  const searchInput = window.locator('[data-testid="search-input"]');
  await searchInput.click({ force: true });
  await searchInput.fill(query);
  await searchInput.press('Enter');
}

/** Open the Advanced Search dialog and return it. */
async function openAdvanced(window: Page): Promise<Locator> {
  await window.locator('[data-testid="search-options-button"]').click({ force: true });
  const dialog = window.locator('[data-testid="advanced-search-dialog"]');
  await expect(dialog).toBeVisible({ timeout: 15000 });
  return dialog;
}

test.describe('Search', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
  });

  test.describe('Basic Search', () => {
    test('should perform a basic search and show results', async ({ window }) => {
      await runSearch(window, 'love');

      await expect(resultsPane(window)).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(results(window).first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
      expect(await results(window).count()).toBeGreaterThan(0);
    });

    test('a query that matches nothing reports no results rather than stale ones', async ({ window }) => {
      // The failure this guards against is the results pane keeping the
      // previous query's rows when the new one matches nothing - which reads
      // as "your search found these" and is worse than an empty state.
      await runSearch(window, 'love');
      await expect(results(window).first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

      await runSearch(window, 'zzqqxwvk');

      await expect(resultsPane(window).getByText(/love/i)).toHaveCount(0, { timeout: SEARCH_TIMEOUT });
    });
  });

  test.describe('Advanced Search Options', () => {
    test('should open advanced search dialog', async ({ window }) => {
      const dialog = await openAdvanced(window);

      await expect(dialog.locator('select').first()).toBeVisible();
    });

    test('should search all Bible translations when scope is allBibles', async ({ window }) => {
      const dialog = await openAdvanced(window);

      await dialog.locator('select').first().selectOption('allBibles');
      await dialog.locator('input[type="text"]').first().fill('love joy peace');
      await dialog.locator('button', { hasText: 'Search' }).click({ force: true });

      await expect(resultsPane(window)).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(results(window).first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

      // The scope is the point of the test. Asserting only `count > 0` will not do
      // - the default single-module scope satisfies it just as well, so the test
      // would pass whether or not `allBibles` did anything.
      const modules = new Set(
        await window.locator('[data-testid="search-result-module"]').allTextContents(),
      );
      expect(modules.size).toBeGreaterThan(1);
    });
  });

  test.describe('Commentary Search', () => {
    test('should find commentary matches when searching all modules', async ({ window }) => {
      const dialog = await openAdvanced(window);

      await dialog.locator('select').first().selectOption('allModules');
      // This phrase is in Barnes' note on John 3:16 and nowhere in the Bible
      // text, so a hit proves commentaries were actually searched.
      await dialog.locator('input[type="text"]').first().fill('Man had no claim');
      await dialog.locator('button', { hasText: 'Search' }).click({ force: true });

      await expect(resultsPane(window)).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(results(window).first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

      // Assert unconditionally: guarding on `if (count > 0)` lets zero results -
      // the exact failure this test exists to catch - report as a pass.
      const labels = await window
        .locator('[data-testid="search-result-module"], [data-testid="search-result-reference"]')
        .allTextContents();
      expect(labels.some(l => l.toLowerCase().includes('barnes') || l.includes('John 3'))).toBe(true);
    });
  });

  test.describe('Live Suggestions', () => {
    /**
     * There is no "Saved Searches" UI to test: `useSearchStore` keeps a
     * `savedSearches` array, but nothing renders it and the string "Saved
     * Searches" appears only in the documentation dialog.
     *
     * What the search bar really does while focused is gated on query length
     * in `TopSearchBar`: nothing under 1 character, a "type at least 3"
     * helper at 1-2, and `LiveSearchSuggestions` from 3 up.
     *
     * (`LiveSearchSuggestions` also has an `emptyPrompt` branch for a blank
     * query - dead code, since it is only mounted at 3+ characters.)
     */
    test('one or two characters ask for a longer query', async ({ window }) => {
      const searchInput = window.locator('[data-testid="search-input"]');
      await searchInput.click({ force: true });
      await searchInput.fill('lo');

      await expect(window.getByText(/Type at least 3 characters/i))
        .toBeVisible({ timeout: 15000 });
    });

    test('a third character replaces the hint with live results', async ({ window }) => {
      const searchInput = window.locator('[data-testid="search-input"]');
      await searchInput.click({ force: true });
      await searchInput.fill('Ae');
      await expect(window.getByText(/Type at least 3 characters/i))
        .toBeVisible({ timeout: 15000 });

      await searchInput.fill('Aenon');

      await expect(window.getByText('Top Results')).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(window.getByText(/Type at least 3 characters/i)).toHaveCount(0);
    });
  });

  test.describe('Character Variant Search (KAN-35)', () => {
    test('searching "Aenon" should find John 3:23 with character variant fallback', async ({ window }) => {
      await runSearch(window, 'Aenon');

      await expect(resultsPane(window)).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(results(window).first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(resultsPane(window)).toContainText('John 3:23', { timeout: SEARCH_TIMEOUT });
    });

    test('live search for "Aenon" should show suggestions via character variant', async ({ window }) => {
      const searchInput = window.locator('[data-testid="search-input"]');
      await searchInput.click({ force: true });
      await searchInput.fill('Aenon');

      await expect(window.getByText('Top Results')).toBeVisible({ timeout: SEARCH_TIMEOUT });

      const suggestions = window.locator('.divide-y.divide-border button');
      await expect(suggestions.first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
      await expect(suggestions.first()).toContainText('John 3:23');
    });
  });
});
