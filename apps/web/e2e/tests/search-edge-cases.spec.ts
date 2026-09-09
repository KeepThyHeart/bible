import { test, expect } from '@playwright/test';

test.describe('Search Edge Cases', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.app');
  });

  test('reference formats navigate correctly', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    const tabTitle = page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title');

    // `waitForSelector('.verse')` is not a wait here: the *previous* chapter's
    // verses are still in the DOM, so it returns immediately and a following
    // title assertion races the navigation and loses under load. The retrying
    // assertion on the title is the whole wait.
    const references: ReadonlyArray<readonly [string, string]> = [
      ['jn 3', 'John'],                 // abbreviated book
      ['1 cor 13', '1 Corinthians'],    // numbered + abbreviated
      ['psalm 119', 'Psalm'],           // longest chapter
      ['rev 22', 'Revelation'],         // last chapter in the Bible
      ['gen 1', 'Genesis'],             // first chapter
      ['3 john 1', '3 John'],           // short numbered book
    ];

    for (const [query, expected] of references) {
      await searchInput.fill(query);
      await searchInput.press('Enter');
      await expect(tabTitle, `"${query}" should open ${expected}`)
        .toContainText(expected, { timeout: 15000 });
      await expect(page.locator('.verse').first()).toBeVisible({ timeout: 15000 });
    }
  });

  test('empty search does not crash', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('');
    await searchInput.press('Enter');

    // App should still be functional
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.bible-pane')).toBeVisible();
  });

  test('special characters in search do not cause errors', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');

    // Characters that could be dangerous for XSS or SQL injection
    const specialQueries = ["'", '"', '&', '<script>', '><', "'; DROP TABLE--"];
    for (const query of specialQueries) {
      await searchInput.fill(query);
      await searchInput.press('Enter');
      // App should not crash
      await expect(page.locator('.app')).toBeVisible();
    }
  });

  test('very long query does not crash', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    const longQuery = 'a'.repeat(200);
    await searchInput.fill(longQuery);
    await searchInput.press('Enter');

    // App should still be functional
    await expect(page.locator('.app')).toBeVisible();
  });

  test('search with no results shows message', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('xyzzynonexistent');
    await searchInput.press('Enter');

    // Wait for search to complete — the right pane search panel should appear
    await page.waitForSelector('.search-panel-inline', { timeout: 10000 });
    // Should show some kind of empty/no-results indicator
    const noResults = page.locator('.search-panel-inline__empty, .search-panel-inline__no-results');
    await expect(noResults.first()).toBeVisible({ timeout: 10000 });
  });

  test('search then navigate then search again', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');

    // First search
    await searchInput.fill('faith');
    await searchInput.press('Enter');
    await page.waitForSelector('.search-panel-inline__header', { timeout: 10000 });
    await expect(page.locator('.search-panel-inline__title')).toContainText('faith');

    // Navigate to a passage
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Second search
    await searchInput.fill('hope');
    await searchInput.press('Enter');
    await page.waitForSelector('.search-panel-inline__header', { timeout: 10000 });
    await expect(page.locator('.search-panel-inline__title')).toContainText('hope');
  });
});

test.describe('Search Edge Cases — API', () => {
  test('empty keyword search returns 400', async ({ request }) => {
    const res = await request.get('/api/search/keyword?q=');
    expect(res.status()).toBe(400);
  });

  test('normal keyword search returns results', async ({ request }) => {
    const res = await request.get('/api/search/keyword?q=love');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.total).toBeGreaterThan(0);
  });
});
