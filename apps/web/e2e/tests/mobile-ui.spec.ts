import { test, expect } from '@playwright/test';

test.describe('Mobile UI Tests', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only tests');
    // Clear session storage so home screen shows on fresh load
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.app--mobile', { timeout: 10000 });
  });

  test('mobile layout renders correctly', async ({ page }) => {
    // Bottom nav bar is visible with Home / Study / Read / Cmt / Search buttons
    await expect(page.locator('.mobile-nav')).toBeVisible();
    const navBtns = page.locator('.mobile-nav__btn');
    await expect(navBtns).toHaveCount(5);
    await expect(navBtns.nth(0)).toContainText('Home');
    await expect(navBtns.nth(1)).toContainText('Study');
    await expect(navBtns.nth(2)).toContainText('Read');
    await expect(navBtns.nth(3)).toContainText('Cmt');
    await expect(navBtns.nth(4)).toContainText('Search');

    // Header search bar is hidden on mobile (search is a dedicated tab)
    await expect(page.locator('.header__search')).not.toBeVisible();

    // Resize handle should not be visible
    await expect(page.locator('.resize-handle')).toHaveCount(0);
  });

  test('bottom nav tab switching', async ({ page }) => {
    // After initial load, Read tab should be active (default navigation to Genesis 1)
    await page.waitForSelector('.verse', { timeout: 15000 });
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Read');
    await expect(page.locator('.bible-pane')).toBeVisible();

    // Tap Search tab
    await page.locator('.mobile-nav__btn', { hasText: 'Search' }).click();
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Search');

    // Tap Cmt (Commentary) tab
    await page.locator('.mobile-nav__btn', { hasText: 'Cmt' }).click();
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Cmt');

    // Tap Home tab
    await page.locator('.mobile-nav__btn', { hasText: 'Home' }).click();
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Home');

    // Tap Read to go back
    await page.locator('.mobile-nav__btn', { hasText: 'Read' }).click();
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Read');
    await expect(page.locator('.bible-pane')).toBeVisible();
  });

  test('mobile search tab shows search input', async ({ page }) => {
    // Navigate to search tab
    await page.locator('.mobile-nav__btn', { hasText: 'Search' }).click();
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Search');

    // Mobile search bar should be visible
    const searchInput = page.locator('.search-panel-inline__mobile-input');
    await expect(searchInput).toBeVisible();

    // Perform a search
    await searchInput.fill('love');
    await page.locator('.search-panel-inline__mobile-submit').click();

    // Wait for results
    await page.waitForSelector('.search-panel-inline__header', { timeout: 10000 });
    await expect(page.locator('.search-panel-inline__title')).toContainText('love');
  });

  test('Read tab shows Bible content with toolbar', async ({ page }) => {
    // Navigate to Read tab
    await page.locator('.mobile-nav__btn', { hasText: 'Read' }).click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Bible toolbar should be visible
    await expect(page.locator('.bible-toolbar')).toBeVisible();

    // History back button should exist and be disabled at start
    const backBtn = page.locator('.bible-toolbar__nav-btn[title="Go back in history"]');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toBeDisabled();
  });

  test('settings panel at mobile width', async ({ page }) => {
    // Open settings
    const settingsBtn = page.locator('.header__action-btn[title="Settings"], .mobile-landscape-sidebar__action-btn[title="Settings"]').first();
    // On mobile portrait, settings button is in the header area
    if (!await settingsBtn.isVisible().catch(() => false)) {
      // Might be accessible differently; try the gear icon
      const gearBtn = page.locator('button[title="Settings"]').first();
      await gearBtn.click();
    } else {
      await settingsBtn.click();
    }

    // Settings panel should appear as overlay
    await expect(page.locator('.settings-panel-overlay')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Text Size is the default tab
    await expect(page.locator('.settings-panel__section-title', { hasText: 'Text Size' })).toBeVisible();

    // Switch to Theme tab
    await page.locator('.settings-panel__tab', { hasText: 'Theme' }).click();
    await expect(page.locator('.settings-panel__section-title', { hasText: 'Theme' })).toBeVisible();

    // Escape closes panel
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-panel-overlay')).not.toBeVisible();
  });

  test('study via context menu switches view', async ({ page }) => {
    // The menu used to carry one item per study target (Commentary, Topics,
    // Cross-references, Dictionary), each landing on a view still showing the
    // previously selected verse. They are now a single "Study" item.
    // Go to Read tab first
    await page.locator('.mobile-nav__btn', { hasText: 'Read' }).click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Right-click a verse and click Study
    const firstVerse = page.locator('.verse').first();
    await firstVerse.click({ button: 'right' });
    await page.locator('.verse-context-menu__item', { hasText: 'Study' }).click();

    // Should switch to the study view
    await expect(page.locator('.mobile-nav__btn--active')).toContainText('Study');
  });

  test('chapter navigation within Read tab', async ({ page }) => {
    // Go to Read tab
    await page.locator('.mobile-nav__btn', { hasText: 'Read' }).click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    // The chapter header is always rendered (deliberately, to avoid flicker),
    // so it is required rather than guarded.
    const chapterTitle = page.locator('.bible-content__chapter-title');
    await expect(chapterTitle).toBeVisible({ timeout: 10000 });
    const initialTitle = await chapterTitle.textContent();

    // The chevrons are icon-only `.bible-content__nav-btn` buttons. The old
    // lookup was `button` with text "Next", which matches nothing here — so the
    // test never clicked anything and never checked the title changed.
    const nextChapter = page.locator('.bible-content__nav-btn').last();
    await expect(nextChapter).toBeEnabled();
    await nextChapter.click();
    await page.waitForSelector('.verse', { timeout: 10000 });

    await expect(chapterTitle).not.toHaveText(initialTitle ?? '', { timeout: 10000 });

    // And back again, so the pair is covered rather than only one direction.
    await page.locator('.bible-content__nav-btn').first().click();
    await expect(chapterTitle).toHaveText(initialTitle ?? '', { timeout: 10000 });
  });
});
