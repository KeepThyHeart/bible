import { test, expect } from '@playwright/test';

test.describe('Tab Management', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.app');
    // Navigate to a starting passage
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });
  });

  test('add a second tab and switch between tabs', async ({ page }) => {
    // Should start with one tab
    const tabs = page.locator('.bible-tab-bar__tab');
    expect(await tabs.count()).toBe(1);

    // Click the + button to add a new tab
    await page.locator('.bible-tab-bar__add').click();

    // Book/chapter picker should appear
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });

    // Select Genesis (book 1) — click the first book button
    const genesisBook = page.locator('.book-chapter-picker__book-btn').first();
    await genesisBook.click();

    // Select chapter 1
    const chapter1 = page.locator('.book-chapter-picker__chapter-btn').first();
    await chapter1.click();

    // Should now have 2 tabs
    await expect(page.locator('.bible-tab-bar__tab')).toHaveCount(2);

    // New tab should be active
    const activeTab = page.locator('.bible-tab-bar__tab--active');
    await expect(activeTab).toBeVisible();
    const activeTitle = await activeTab.locator('.bible-tab-bar__tab-title').textContent();
    expect(activeTitle).toContain('Genesis');

    // Click the first tab (John 3) to switch back
    await page.locator('.bible-tab-bar__tab').first().click();
    const switchedTitle = await page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title').textContent();
    expect(switchedTitle).toContain('John');
  });

  test('close a tab', async ({ page }) => {
    // Add a second tab first
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.locator('.book-chapter-picker__book-btn').first().click();
    await page.locator('.book-chapter-picker__chapter-btn').first().click();
    await expect(page.locator('.bible-tab-bar__tab')).toHaveCount(2);

    // Close buttons should be visible when there are 2+ tabs
    await expect(page.locator('.bible-tab-bar__close').first()).toBeVisible();

    // Close the second tab (active one)
    await page.locator('.bible-tab-bar__close').last().click();

    // Should be back to one tab
    await expect(page.locator('.bible-tab-bar__tab')).toHaveCount(1);

    // Remaining tab should be active and show John
    const remainingTitle = await page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title').textContent();
    expect(remainingTitle).toContain('John');
  });

  test('tab state preservation across switches', async ({ page }) => {
    // Tab 1 is already on John 3. Add a second tab on Genesis 1.
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.locator('.book-chapter-picker__book-btn').first().click();
    await page.locator('.book-chapter-picker__chapter-btn').first().click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Tab 2 should show Genesis 1
    const tab2Title = await page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title').textContent();
    expect(tab2Title).toContain('Genesis');

    // Switch to tab 1 (John 3)
    await page.locator('.bible-tab-bar__tab').first().click();
    await page.waitForSelector('.verse', { timeout: 15000 });
    const tab1Title = await page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title').textContent();
    expect(tab1Title).toContain('John');

    // Switch back to tab 2 (Genesis 1 should still be there)
    await page.locator('.bible-tab-bar__tab').last().click();
    await page.waitForSelector('.verse', { timeout: 15000 });
    const tab2TitleAgain = await page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title').textContent();
    expect(tab2TitleAgain).toContain('Genesis');
  });
});

test.describe('Navigation History (Back/Forward)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.app');
    await page.waitForSelector('.verse', { timeout: 10000 });
  });

  test('back button disabled at start', async ({ page }) => {
    // On fresh load, back button should be disabled
    const backBtn = page.locator('.bible-toolbar__nav-btn[title="Go back in history"]');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toBeDisabled();

    // There is no forward button — Back plus the Recent Passages menu covers it.
    await expect(page.locator('.bible-toolbar__nav-btn[title="Go forward in history"]')).toHaveCount(0);
  });

  test('history back, then forward again through the recent-passages menu', async ({ page, browserName }) => {
    // History navigation after back clicks is flaky in WebKit — tab title doesn't update reliably
    test.skip(browserName === 'webkit', 'history navigation unreliable in WebKit/Safari; skipped until webkit timing fix');
    const searchInput = page.locator('.header__search-field');
    const tabTitle = page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title');

    // Fresh page starts on Genesis 1
    await expect(tabTitle).toContainText('Genesis', { timeout: 10000 });

    // Navigate to John 3 — wait for title AND verses to load (history pushes after API response)
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await expect(tabTitle).toContainText('John', { timeout: 10000 });
    await page.waitForFunction(() => {
      const data = localStorage.getItem('bible-reader-session');
      return data && data.includes('"book":43');
    }, { timeout: 10000 });

    // Navigate to Romans 8
    await searchInput.fill('Romans 8');
    await searchInput.press('Enter');
    await expect(tabTitle).toContainText('Romans', { timeout: 10000 });
    await page.waitForFunction(() => {
      const data = localStorage.getItem('bible-reader-session');
      return data && data.includes('"book":45');
    }, { timeout: 10000 });

    // Click back → should go to John 3
    const backBtn = page.locator('.bible-toolbar__nav-btn[title="Go back in history"]');
    await expect(backBtn).toBeEnabled({ timeout: 5000 });
    await backBtn.click();
    await expect(tabTitle).toContainText('John', { timeout: 10000 });

    // Click back → should go to Genesis 1
    await backBtn.click();
    await expect(tabTitle).toContainText('Genesis', { timeout: 10000 });

    // Forward is the Recent Passages menu now: pick John 3 by name.
    await page.getByTestId('history-dropdown-toggle').click();
    await page.locator('.bible-toolbar__history-item', { hasText: 'John 3' }).click();
    await expect(tabTitle).toContainText('John', { timeout: 10000 });
  });
});
