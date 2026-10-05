import { test, expect, type Page } from '@playwright/test';
import { desktopOnly, waitForVerses } from '../helpers';

/**
 * The app host's lean boot: `#/@present` is a Presenter-only page load. Study
 * (its stores, Bible data and chunk) must not start until the reader goes there.
 * Fresh storage on every test, so no saved app or session decides for us.
 */

/** Collect every request URL the page makes. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (req) => urls.push(req.url()));
  return urls;
}

const bibleApi = (urls: string[]) => urls.filter((u) => u.includes('/api/bible/'));

test.describe('App host: Presenter-only boot', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.addInitScript(() => {
      // Fresh storage per test (only on first load of the test, not on reloads).
      if (!sessionStorage.getItem('__fresh')) {
        localStorage.clear();
        sessionStorage.setItem('__fresh', '1');
      }
    });
  });

  test('a cold load of #/@present shows the Presenter and never asks for Bible data', async ({ page }) => {
    const urls = recordRequests(page);
    await page.goto('/#/@present');
    await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    expect(bibleApi(urls)).toEqual([]);
    await expect(page.locator('.bible-pane')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/@present$/);
  });

  test('the Presenter back button goes to Study, which then loads its chapter', async ({ page }) => {
    const urls = recordRequests(page);
    await page.goto('/#/@present');
    await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });
    expect(bibleApi(urls)).toEqual([]);

    await page.locator('.pz-appbar__back').click();
    await waitForVerses(page);
    // Kept mounted (hidden) for a grace period after leaving, so assert it is not shown.
    await expect(page.locator('.presenter-app')).toBeHidden();
    await expect(page).not.toHaveURL(/@present/);
    expect(bibleApi(urls).length).toBeGreaterThan(0);
  });

  test('browser Back from a Presenter opened out of Study returns to Study', async ({ page }) => {
    await page.goto('/');
    await waitForVerses(page);
    await page.locator('.header__action-btn .fa-tv').click();
    await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/#\/@present$/);

    await page.goBack();
    await waitForVerses(page);
    // Kept mounted (hidden) for a grace period after leaving, so assert it is not shown.
    await expect(page.locator('.presenter-app')).toBeHidden();
    await expect(page).not.toHaveURL(/@present/);
  });

  test('Ctrl+Shift+0 returns to Study from the Presenter', async ({ page }) => {
    await page.goto('/#/@present');
    await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('Control+Shift+Digit0');
    await waitForVerses(page);
    // Kept mounted (hidden) for a grace period after leaving, so assert it is not shown.
    await expect(page.locator('.presenter-app')).toBeHidden();
    await expect(page).not.toHaveURL(/@present/);
  });

  test('reloading on #/@present stays on the Presenter', async ({ page }) => {
    await page.goto('/#/@present');
    await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });

    const urls = recordRequests(page);
    await page.reload();
    await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/#\/@present$/);
    await expect(page.locator('.bible-pane')).toHaveCount(0);
    expect(bibleApi(urls)).toEqual([]);
  });
});
