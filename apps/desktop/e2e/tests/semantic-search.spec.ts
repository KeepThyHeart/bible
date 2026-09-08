/**
 * Semantic Search E2E Tests
 *
 * Tests for semantic (meaning-based) search functionality.
 * Requires:
 *   1. Core package built: npm run build:core
 *   2. A semantic index present in the app's data directory (the tests skip
 *      themselves when it is absent - see `hasSemanticIndex` below).
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';
import { waitForAppReady } from '../fixtures/test-utils';

/**
 * Whether this machine has a semantic index installed.
 *
 * The IPC call returns a `Result<boolean>` envelope, so `.value` has to be
 * unwrapped - otherwise `{ ok: true, value: false }` reads as truthy and the
 * test proceeds into a feature that is switched off.
 */
async function semanticAvailable(window: Page): Promise<boolean> {
  return window.evaluate(async () => {
    const api = (window as unknown as { electron?: { search?: { semanticAvailable?: () => Promise<unknown> } } }).electron;
    if (!api?.search?.semanticAvailable) return false;
    const result = await api.search.semanticAvailable();
    if (result && typeof result === 'object' && 'ok' in result) {
      const envelope = result as { ok: boolean; value?: unknown };
      return envelope.ok && envelope.value === true;
    }
    return Boolean(result);
  });
}

/**
 * Semantic search loads an ONNX model on the first query of the process, which
 * dominates the wall clock and varies hugely with machine and cache state.
 *
 * A generous assertion timeout is strictly better here than a flat sleep: it
 * costs nothing on a warm run, and it still passes on a cold one instead of
 * failing 100ms past a fixed wait.
 */
const FIRST_QUERY_TIMEOUT = 60000;

/** Run a keyword search from the global search box. */
async function search(window: Page, query: string): Promise<void> {
  const searchInput = window.locator('[data-testid="search-input"]');
  await expect(searchInput).toBeVisible({ timeout: 15000 });
  await searchInput.fill(query);
  await searchInput.press('Enter');
}

test.describe('Semantic Search', () => {
  test('should be available, toggle from keyword search, and return results', async ({ window }) => {
    await waitForAppReady(window);
    // `test.skip` rather than a bare `return`: an environment without the index
    // is a legitimate skip, and reporting it as a pass hides the fact that this
    // file checked nothing on that machine.
    test.skip(!(await semanticAvailable(window)), 'Semantic index not installed');

    await search(window, 'love');

    const resultsPane = window.locator('[data-testid="search-results"]');
    await expect(resultsPane).toBeVisible({ timeout: 20000 });

    const semanticBtn = window.locator('button:has-text("Semantic Search")');
    await expect(semanticBtn).toBeVisible();
    await semanticBtn.click({ force: true });

    const semanticResults = window.locator('[data-testid="semantic-search-results"]');
    await expect(semanticResults).toBeVisible({ timeout: FIRST_QUERY_TIMEOUT });

    // Results, not just the container.
    const results = window.locator('[data-testid="semantic-result"]');
    await expect(results.first()).toBeVisible();
    expect(await results.count()).toBeGreaterThan(0);

    // Each result carries a reference; a container of blank rows would
    // otherwise satisfy the count above.
    await expect(results.first()).toHaveText(/\w+\s+\d+:\d+/);

    const backBtn = window.locator('button:has-text("Back to Keyword Search")');
    await expect(backBtn).toBeVisible();
    await backBtn.click({ force: true });

    await expect(semanticResults).toBeHidden({ timeout: 10000 });
    await expect(resultsPane).toBeVisible();
  });

  test('should auto-switch to semantic when keyword search returns zero results', async ({ window }) => {
    await waitForAppReady(window);
    test.skip(!(await semanticAvailable(window)), 'Semantic index not installed');

    // `useSearchStore` auto-switches on `results.length === 0`, so this is
    // deterministic given a query whose terms are absent from every installed
    // translation - "existential" appears in none of them.
    //
    // The previous version wrapped every assertion in `if (autoSwitched)` and
    // closed with `expect(true).toBe(true)`, so it passed whether or not the
    // auto-switch existed at all.
    await search(window, 'existential meaning of human suffering');

    await expect(window.locator('text=No keyword matches found'))
      .toBeVisible({ timeout: FIRST_QUERY_TIMEOUT });

    const semanticResults = window.locator('[data-testid="semantic-search-results"]');
    await expect(semanticResults).toBeVisible();
    expect(await window.locator('[data-testid="semantic-result"]').count()).toBeGreaterThan(0);
  });

  test('auto-switch is undone by a query that does have keyword matches', async ({ window }) => {
    await waitForAppReady(window);
    test.skip(!(await semanticAvailable(window)), 'Semantic index not installed');

    // The store clears `isSemanticMode` on the next search when the previous
    // one auto-switched (`isSemanticMode: autoSwitchedToSemantic ? false : ...`).
    // Without that, one no-match query would strand the user in semantic mode
    // for the rest of the session.
    await search(window, 'existential meaning of human suffering');
    await expect(window.locator('text=No keyword matches found'))
      .toBeVisible({ timeout: FIRST_QUERY_TIMEOUT });

    await search(window, 'love');

    await expect(window.locator('[data-testid="search-results"]')).toBeVisible({ timeout: 20000 });
    await expect(window.locator('[data-testid="semantic-search-results"]')).toBeHidden();
    await expect(window.locator('text=No keyword matches found')).toBeHidden();
  });
});
