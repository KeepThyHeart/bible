import { test, expect } from '@playwright/test';
import { desktopOnly, navigateTo, waitForVerses, getActiveTabTitle } from '../helpers';

test.describe('Session Persistence', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/');
    await page.waitForSelector('.app');
  });

  test('tab state survives page reload', async ({ page }) => {
    // Navigate to John 3 in tab 1
    await navigateTo(page, 'John 3');

    // Add a second tab on Genesis 1
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.locator('.book-chapter-picker__book-btn').first().click();
    await page.locator('.book-chapter-picker__chapter-btn').first().click();
    await waitForVerses(page);

    // Verify 2 tabs before reload
    await expect(page.locator('.bible-tab-bar__tab')).toHaveCount(2);
    const activeTitle = await getActiveTabTitle(page);
    expect(activeTitle).toContain('Genesis');

    // Reload
    await page.reload({ waitUntil: 'networkidle' });
    await waitForVerses(page);

    // Both tabs should still be present
    await expect(page.locator('.bible-tab-bar__tab')).toHaveCount(2);

    // Active tab should still be Genesis
    const restoredTitle = await getActiveTabTitle(page);
    expect(restoredTitle).toContain('Genesis');

    // Switch to first tab — should still be John
    await page.locator('.bible-tab-bar__tab').first().click();
    await waitForVerses(page);
    const firstTabTitle = await getActiveTabTitle(page);
    expect(firstTabTitle).toContain('John');
  });

  test('current chapter survives page reload', async ({ page, browserName }) => {
    // WebKit's networkidle wait is unreliable in CI — hangs past the 30 s timeout
    test.skip(browserName === 'webkit', 'networkidle unreliable in WebKit/Safari; skipped until Playwright webkit fix lands');
    // Wait for initial load to finish first
    await waitForVerses(page);

    // Navigate to a specific chapter
    await navigateTo(page, 'Romans 8');

    // Wait for the tab title to update AND data to load (session saved after API response)
    await expect(page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title')).toContainText('Romans', { timeout: 10000 });

    // Verify session was actually saved by checking localStorage
    // Session stores book number 45 for Romans, chapter 8
    await page.waitForFunction(() => {
      const session = localStorage.getItem('bible-reader-session');
      return session && session.includes('"book":45') && session.includes('"chapter":8');
    }, { timeout: 10000 });

    // Reload
    await page.reload({ waitUntil: 'networkidle' });
    await waitForVerses(page);

    // Should still be on Romans after reload
    await expect(page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title')).toContainText('Romans');

    // Verify verses loaded (not an empty page)
    expect(await page.locator('.verse').count()).toBeGreaterThan(0);
  });

  test('theme setting survives page reload', async ({ page, browserName }) => {
    // WebKit's networkidle wait is unreliable in CI — hangs past the 30 s timeout
    test.skip(browserName === 'webkit', 'networkidle unreliable in WebKit/Safari; skipped until Playwright webkit fix lands');
    // Wait for initial load
    await waitForVerses(page);

    // Switch to dark theme
    const themeBtn = page.locator('.header__theme-wrapper .header__action-btn');
    await themeBtn.click();
    await page.locator('.header__theme-option', { hasText: 'Dark' }).click();

    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toBe('dark');

    // Reload
    await page.reload({ waitUntil: 'networkidle' });
    await waitForVerses(page);

    // Theme should still be dark
    const restoredTheme = await page.locator('html').getAttribute('data-theme');
    expect(restoredTheme).toBe('dark');
  });

  test('display mode persists per tab across reload', async ({ page }) => {
    await navigateTo(page, 'John 1');

    // Tab 1: set to Reading mode
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await modeSelect.selectOption('reading');
    await expect(modeSelect).toHaveValue('reading');

    // Add tab 2 and set it to Study mode
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.locator('.book-chapter-picker__book-btn').first().click();
    await page.locator('.book-chapter-picker__chapter-btn').first().click();
    await waitForVerses(page);

    await page.locator('.bible-toolbar__mode-select').selectOption('study');
    await expect(page.locator('.bible-toolbar__mode-select')).toHaveValue('study');

    // Reload
    await page.reload({ waitUntil: 'networkidle' });
    await waitForVerses(page);

    // Tab 2 was active — should still be Study
    await expect(page.locator('.bible-toolbar__mode-select')).toHaveValue('study');

    // Switch to tab 1 — should still be Reading
    await page.locator('.bible-tab-bar__tab').first().click();
    await waitForVerses(page);
    await expect(page.locator('.bible-toolbar__mode-select')).toHaveValue('reading');
  });

  test('font size setting survives page reload', async ({ page }) => {
    await waitForVerses(page);

    // Read the initial font size from the bible pane's inline style
    const originalFontSize = await page.locator('.bible-pane').evaluate(
      el => getComputedStyle(el).fontSize
    );

    // Open settings and bump the font size via the + button
    await page.locator('.header__action-btn[title="Settings"]').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    const increaseBtn = page.locator('.font-size-control__btn').last();
    await expect(increaseBtn).toBeVisible({ timeout: 5000 });
    await increaseBtn.click();
    // The size actually changing is the precondition for the comparison below;
    // 300ms was a guess that could read the pre-click value on a loaded machine.
    await expect
      .poll(
        () => page.locator('.bible-pane').evaluate(el => getComputedStyle(el).fontSize),
        { timeout: 10000 },
      )
      .not.toBe(originalFontSize);

    const newFontSize = await page.locator('.bible-pane').evaluate(
      el => getComputedStyle(el).fontSize
    );
    expect(newFontSize).not.toBe(originalFontSize);

    await page.keyboard.press('Escape');

    // Reload
    await page.reload({ waitUntil: 'networkidle' });
    await waitForVerses(page);

    // Font size should still be the bumped value after reload
    const restoredFontSize = await page.locator('.bible-pane').evaluate(
      el => getComputedStyle(el).fontSize
    );
    expect(restoredFontSize).toBe(newFontSize);
  });
});
