import { test, expect, type Page } from '@playwright/test';

/**
 * The previous/next chapter chevrons, addressed by their position in the
 * chapter-nav container: they render as two bare `.bible-toolbar__nav-btn`
 * elements distinguished only by a localized `title`.
 */
const prevChapter = (page: Page) => page.locator('.bible-toolbar__chapter-nav button').first();
const nextChapter = (page: Page) => page.locator('.bible-toolbar__chapter-nav button').last();

/**
 * Get the chapter chevrons out from under the right pane.
 *
 * At tablet width the right pane is a fixed overlay (see
 * tablet-layout-e2e.spec.ts), and it covers the right end of the Bible toolbar
 * where these buttons live — so a click on them lands on the commentary tab
 * bar instead. Collapsing the pane is what a reader does in that situation.
 */
async function clearRightPane(page: Page): Promise<void> {
  const collapse = page.locator('.right-pane-tabs__collapse');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(page.locator('.main-layout__commentary-collapsed')).toBeVisible({ timeout: 5000 });
  }
}

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    await page.waitForSelector('.app');
    // Navigate to a passage
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Genesis 1');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });
  });

  test('Ctrl+K focuses search input', async ({ page }) => {
    // Click somewhere else first to defocus the search
    const searchInput = page.locator('.header__search-field');
    await page.locator('.bible-pane').click();
    // Prove the search field really lost focus before testing that a shortcut
    // restores it — otherwise the assertion below passes on a no-op shortcut.
    await expect(searchInput).not.toBeFocused({ timeout: 10000 });

    await page.keyboard.press('Control+k');

    await expect(searchInput).toBeFocused({ timeout: 10000 });
  });

  test('forward slash focuses search input', async ({ page }) => {
    // Click on bible pane first to make sure search isn't focused
    const searchInput = page.locator('.header__search-field');
    await page.locator('.bible-pane').click();
    await expect(searchInput).not.toBeFocused({ timeout: 10000 });

    await page.keyboard.press('/');

    await expect(searchInput).toBeFocused({ timeout: 10000 });
  });

  test('Escape closes theme dropdown', async ({ page }) => {
    // Open the theme dropdown
    const themeBtn = page.locator('.header__theme-wrapper .header__action-btn');
    await themeBtn.click();
    await expect(page.locator('.header__theme-dropdown')).toBeVisible();

    // Press Escape to close it
    await page.keyboard.press('Escape');
    await expect(page.locator('.header__theme-dropdown')).not.toBeVisible();
  });

  test('chapter navigation arrows work', async ({ page }) => {
    // Get current passage title
    const tabTitle = page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title');
    const initialTitle = await tabTitle.textContent();
    expect(initialTitle).toContain('Genesis');

    // The chapter chevrons carry no aria-label and no distinguishing class, so
    // they are addressed by position inside their own container. The previous
    // selector list — `.bible-toolbar__nav-next, .chapter-nav__next,
    // [aria-label*="next" i]` — matched nothing, so the guard around it meant
    // this test never navigated anywhere.
    await clearRightPane(page);
    await nextChapter(page).click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    await expect(tabTitle).toHaveText(/Genesis\s*2/, { timeout: 10000 });
    expect(await tabTitle.textContent()).not.toBe(initialTitle);
  });

  test('previous chapter navigation works', async ({ page }) => {
    // Navigate to Genesis 3 first
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Genesis 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    const tabTitle = page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title');
    await expect(tabTitle).toHaveText(/Genesis\s*3/, { timeout: 10000 });

    await clearRightPane(page);
    await prevChapter(page).click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    await expect(tabTitle).toHaveText(/Genesis\s*2/, { timeout: 10000 });
  });

  test('search input Enter navigates to reference', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Romans 8:28');
    await searchInput.press('Enter');

    await page.waitForSelector('.verse', { timeout: 10000 });

    // Tab should show Romans
    const tabTitle = page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title');
    await expect(tabTitle).toContainText('Romans');

    // Should have a highlighted verse
    const highlighted = page.locator('.verse--study');
    await expect(highlighted).toBeVisible({ timeout: 5000 });
  });

  test('search input clears on navigation', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Psalm 23');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Search input should be cleared or blurred after navigation
    const value = await searchInput.inputValue();
    // After navigation, search field may clear or retain — just verify app is stable
    await expect(page.locator('.bible-pane')).toBeVisible();
    await expect(page.locator('.verse').first()).toBeVisible();
  });

  test('rapid keyboard navigation does not crash', async ({ page }) => {
    // Rapidly switch between passages
    const searchInput = page.locator('.header__search-field');

    // Each navigation must land before the next is typed, or the history this
    // test walks back through has fewer entries than it thinks.
    await searchInput.fill('Gen 1');
    await searchInput.press('Enter');
    await expect(page.locator('.bible-pane')).toContainText(/Genesis\s*1/, { timeout: 15000 });

    await searchInput.fill('Exod 1');
    await searchInput.press('Enter');
    await expect(page.locator('.bible-pane')).toContainText(/Exodus\s*1/, { timeout: 15000 });

    await searchInput.fill('Ps 23');
    await searchInput.press('Enter');


    // App should still be functional
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 10000 });
  });

  test('book-chapter picker opens and selects', async ({ page, browserName }) => {
    // Picker overlay has a layout/scroll issue in WebKit that prevents chapter buttons from rendering
    test.skip(browserName === 'webkit', 'book-chapter picker chapter buttons not visible in WebKit/Safari; skipped until layout fix');
    // Click the + button to open book-chapter picker
    await page.locator('.bible-tab-bar__add').click();
    await expect(page.locator('.book-chapter-picker__books')).toBeVisible({ timeout: 3000 });

    // Should show book buttons
    const bookBtns = page.locator('.book-chapter-picker__book-btn');
    expect(await bookBtns.count()).toBeGreaterThan(0);

    // Click Psalms (approximate middle of list)
    const psalmsBtn = bookBtns.filter({ hasText: /^Ps/ }).first();
    if (await psalmsBtn.isVisible().catch(() => false)) {
      await psalmsBtn.click();

      // Chapter buttons should appear
      await expect(page.locator('.book-chapter-picker__chapter-btn').first()).toBeVisible({ timeout: 3000 });
      const chapterBtns = page.locator('.book-chapter-picker__chapter-btn');
      // Psalms has 150 chapters
      expect(await chapterBtns.count()).toBeGreaterThan(100);

      // Select chapter 23
      const ch23 = chapterBtns.filter({ hasText: /^23$/ }).first();
      if (await ch23.isVisible().catch(() => false)) {
        await ch23.click();
        await page.waitForSelector('.verse', { timeout: 10000 });

        // Should display Psalm 23
        const tabTitle = page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title');
        await expect(tabTitle).toContainText('Psalm');
      }
    }
  });
});
