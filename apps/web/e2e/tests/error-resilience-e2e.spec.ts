import { test, expect } from '@playwright/test';
import { desktopOnly, navigateTo, waitForVerses } from '../helpers';

test.describe('Error Resilience', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/');
    await page.waitForSelector('.app');
    await waitForVerses(page);
  });

  test('connection error banner appears on network failure', async ({ page }) => {
    // Block all Bible API requests
    await page.route('**/api/bible/**', route => route.abort());

    // Try to navigate — this should fail
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Romans 1');
    await searchInput.press('Enter');

    // Connection banner should appear
    await expect(page.locator('.connection-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.connection-banner__message')).toContainText(/connect|connection|server/i);
  });

  test('connection error banner is dismissible', async ({ page }) => {
    // Block requests and trigger an error
    await page.route('**/api/bible/**', route => route.abort());

    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Romans 1');
    await searchInput.press('Enter');

    await expect(page.locator('.connection-banner')).toBeVisible({ timeout: 10000 });

    // Click the dismiss button
    await page.locator('.connection-banner__dismiss').click();

    // Banner should disappear
    await expect(page.locator('.connection-banner')).not.toBeVisible({ timeout: 3000 });
  });

  test('recovery after transient network failure', async ({ page }) => {
    // Block requests
    await page.route('**/api/bible/**', route => route.abort());

    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Romans 1');
    await searchInput.press('Enter');

    // Wait for error to appear
    await expect(page.locator('.connection-banner')).toBeVisible({ timeout: 10000 });

    // Unblock requests
    await page.unroute('**/api/bible/**');

    // Dismiss error and try again
    await page.locator('.connection-banner__dismiss').click();
    await searchInput.fill('Romans 1');
    await searchInput.press('Enter');

    // Should load successfully now
    await waitForVerses(page);
    await expect(page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title')).toContainText('Romans');
  });

  test('malformed API response does not crash the app', async ({ page }) => {
    // Intercept and return invalid JSON
    await page.route('**/api/bible/**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{ this is not valid json }',
      })
    );

    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Exodus 1');
    await searchInput.press('Enter');

    // App should still be alive — not a blank screen

    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.header')).toBeVisible();

    // Unblock for subsequent tests
    await page.unroute('**/api/bible/**');
  });

  test('app remains functional after error recovery', async ({ page }) => {
    // Cause an error, then recover and verify full functionality
    await page.route('**/api/bible/**', route => route.abort());

    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Leviticus 1');
    await searchInput.press('Enter');

    await expect(page.locator('.connection-banner')).toBeVisible({ timeout: 10000 });

    // Recover
    await page.unroute('**/api/bible/**');
    await page.locator('.connection-banner__dismiss').click();

    // Navigate to a passage
    await navigateTo(page, 'John 3');

    // Verify core features still work
    // 1. Verse clicking. Not the first verse: loading a chapter selects it, and
    // clicking the selected verse toggles it off, so this asserted the opposite
    // of what it meant to. It passed under Chromium only because the class was
    // still on the element when the assertion first polled.
    const verse = page.locator('.verse').nth(2);
    await verse.click();
    await expect(verse).toHaveClass(/verse--study/, { timeout: 5000 });

    // 2. Tab management
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    // Wait for the picker overlay to close before clicking Settings
    await expect(page.locator('.book-chapter-picker__overlay')).not.toBeVisible({ timeout: 3000 });

    // 3. Settings panel
    await page.locator('.header__action-btn[title="Settings"]').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
