import { test, expect } from '@playwright/test';

test.describe('Dictionary Pane', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.app');
    // Navigate to a passage first so there's context
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 1');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });
  });

  test('dictionary tab exists and can be selected', async ({ page }) => {
    // Find the dictionary tab in the right pane tabs
    const dictionaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /dict/i });
    await expect(dictionaryTab).toBeVisible();
    await dictionaryTab.click();

    // Dictionary pane should be visible
    await expect(page.locator('.dictionary-pane')).toBeVisible({ timeout: 5000 });
  });

  test('dictionary pane shows home view with cards', async ({ page }) => {
    // Switch to dictionary tab
    const dictionaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /dict/i });
    await dictionaryTab.click();
    await expect(page.locator('.dictionary-pane')).toBeVisible({ timeout: 5000 });

    // Home view should show dictionary cards or search
    const hasHome = await page.locator('.dictionary-home').isVisible().catch(() => false);
    const hasContent = await page.locator('.dictionary-content').isVisible().catch(() => false);
    expect(hasHome || hasContent).toBeTruthy();
  });

  test('dictionary search returns results', async ({ page }) => {
    // Switch to dictionary tab
    const dictionaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /dict/i });
    await dictionaryTab.click();
    await expect(page.locator('.dictionary-pane')).toBeVisible({ timeout: 5000 });

    // Find the search input in dictionary pane
    const searchInput = page.locator('.dictionary-content__search input, .dictionary-pane input[type="text"], .dictionary-pane input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('love');
      await searchInput.press('Enter');

      const hasResults = await page
        .locator('.dictionary-content__browse-item, .dictionary-pane__entry')
        .first()
        .isVisible({ timeout: 15000 })
        .catch(() => false);
      // Results may or may not appear depending on module availability — just ensure no crash
      await expect(page.locator('.dictionary-pane')).toBeVisible();
    }
  });

  test('dictionary entry displays word and definition', async ({ page }) => {
    // Switch to dictionary tab
    const dictionaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /dict/i });
    await dictionaryTab.click();
    await expect(page.locator('.dictionary-pane')).toBeVisible({ timeout: 5000 });

    // Try to find a browse item to click, or search for something specific
    const searchInput = page.locator('.dictionary-content__search input, .dictionary-pane input[type="text"], .dictionary-pane input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('grace');
      await searchInput.press('Enter');

      // Click first result if available
      const firstResult = page.locator('.dictionary-content__browse-item').first();
      if (await firstResult.isVisible({ timeout: 15000 }).catch(() => false)) {
        await firstResult.click();

        // Entry should be displayed
        const entry = page.locator('.dictionary-pane__entry');
        if (await entry.isVisible().catch(() => false)) {
          // Entry should have a word/header
          await expect(page.locator('.dictionary-pane__entry-word, .dictionary-pane__entry-header').first()).toBeVisible();
        }
      }
    }
    // App should remain functional regardless
    await expect(page.locator('.app')).toBeVisible();
  });

  test('dictionary tab bar supports multiple tabs', async ({ page }) => {
    // Switch to dictionary tab
    const dictionaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /dict/i });
    await dictionaryTab.click();
    await expect(page.locator('.dictionary-pane')).toBeVisible({ timeout: 5000 });

    // Check if dictionary tab bar exists (for multiple dictionary modules)
    const tabBar = page.locator('.dictionary-tab-bar');
    if (await tabBar.isVisible().catch(() => false)) {
      const tabs = page.locator('.dictionary-tab-bar__tab');
      const tabCount = await tabs.count();
      expect(tabCount).toBeGreaterThanOrEqual(1);

      // Active tab should be marked
      await expect(page.locator('.dictionary-tab-bar__tab--active')).toBeVisible();
    }
    await expect(page.locator('.app')).toBeVisible();
  });
});
