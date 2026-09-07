import { test, expect } from '@playwright/test';
import { tabletOnly, waitForVerses } from '../helpers';

test.describe('Tablet Layout (1024px)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    tabletOnly(testInfo);
    await page.goto('/');
    await page.waitForSelector('.app');
    await waitForVerses(page);
  });

  test('uses desktop layout, not mobile', async ({ page }) => {
    // Should NOT have mobile class
    const isMobile = await page.locator('.app--mobile').isVisible().catch(() => false);
    expect(isMobile).toBe(false);

    // Desktop header search bar should be visible
    await expect(page.locator('.header__search')).toBeVisible();

    // Mobile bottom nav should NOT be present
    await expect(page.locator('.mobile-nav')).toHaveCount(0);
  });

  test('right pane renders as fixed overlay at 1024px', async ({ page }) => {
    // Click a verse to trigger study/commentary pane
    await page.locator('.verse').first().click();

    // Unconditional: the two guards this replaced meant that if the study tab
    // or the right pane failed to render at tablet width — the exact regression
    // the test is named for — it passed.
    const studyTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /study/i });
    await expect(studyTab).toBeVisible({ timeout: 10000 });
    await studyTab.click();

    const rightPane = page.locator('.main-layout__right-pane');
    await expect(rightPane).toBeVisible({ timeout: 10000 });

    // At 1024px the right pane overlays rather than shrinking the reader
    // (see _responsive.scss).
    await expect
      .poll(async () => rightPane.evaluate(el => getComputedStyle(el).position), { timeout: 5000 })
      .toBe('fixed');

    const box = await rightPane.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeCloseTo(350, -1); // within ~10px
  });

  test('all core desktop features work at tablet width', async ({ page }) => {
    // 1. Search bar works
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Psalm 23');
    await searchInput.press('Enter');
    await waitForVerses(page);
    await expect(page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title')).toContainText('Psalm');

    // 2. Display mode selector works
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await expect(modeSelect).toBeVisible();

    // 3. Tab management works
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');

    // 4. Settings panel works
    await page.locator('.header__action-btn[title="Settings"]').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('context menu stays within viewport at tablet width', async ({ page }) => {
    // Right-click a verse near the edge
    const lastVerse = page.locator('.verse').last();
    await lastVerse.scrollIntoViewIfNeeded();
    await lastVerse.click({ button: 'right' });

    await expect(page.locator('.verse-context-menu')).toBeVisible();

    // Menu should be within viewport bounds
    const menuBox = await page.locator('.verse-context-menu').boundingBox();
    const viewport = page.viewportSize();
    if (menuBox && viewport) {
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  test('tab bar handles limited width without overflow', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');

    // Open several tabs to stress the tab bar at 1024px width
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await waitForVerses(page);

    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.locator('.book-chapter-picker__book-btn').first().click();
    await page.locator('.book-chapter-picker__chapter-btn').first().click();
    await waitForVerses(page);

    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });
    await page.locator('.book-chapter-picker__book-btn', { hasText: /^Psalms$/ }).click();
    await page.locator('.book-chapter-picker__chapter-btn').first().click();
    await waitForVerses(page);

    // All 3 tabs should be present and the tab bar should not overflow the viewport
    await expect(page.locator('.bible-tab-bar__tab')).toHaveCount(3);
    const tabBarBox = await page.locator('.bible-tab-bar').boundingBox();
    const viewport = page.viewportSize();
    if (tabBarBox && viewport) {
      expect(tabBarBox.x + tabBarBox.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});
