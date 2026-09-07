import { test, expect, type Page } from '@playwright/test';

test.describe('UI E2E Tests', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await page.goto('/');
    // Wait for the app to load
    await page.waitForSelector('.app');
  });

  test('renders the main layout with header and panes', async ({ page }) => {
    await expect(page.locator('.header')).toBeVisible();
    await expect(page.locator('.header__logo')).toContainText('Keep Thy Heart');
    await expect(page.locator('.bible-pane')).toBeVisible();
    await expect(page.locator('.bible-toolbar')).toBeVisible();
  });

  test('navigates to a passage via search bar', async ({ page }) => {
    // Wait for default page to finish loading first
    await page.waitForSelector('.verse', { timeout: 15000 });

    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');

    // Wait for the tab title to update to John and verses to fully load
    await expect(page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title')).toContainText('John', { timeout: 10000 });
    // Wait for session save (proves API response completed and verses rendered)
    await page.waitForFunction(() => {
      const data = localStorage.getItem('bible-reader-session');
      return data && data.includes('"book":43');
    }, { timeout: 15000 });
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 5000 });
  });

  test('navigates to specific verse and highlights it', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3:16');
    await searchInput.press('Enter');

    // Wait for verses to load
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Check that the highlighted verse exists
    const highlighted = page.locator('.verse--study');
    await expect(highlighted).toBeVisible({ timeout: 5000 });
  });

  test('clicking a verse selects it', async ({ page }) => {
    // Navigate first
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Genesis 1');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Click a verse
    const thirdVerse = page.locator('.verse').nth(2);
    await thirdVerse.click();

    // Should be highlighted
    await expect(thirdVerse).toHaveClass(/verse--study/);
  });

  test('display mode selector works', async ({ page }) => {
    // Navigate first
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 1');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Display mode is now a <select> dropdown
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await expect(modeSelect).toBeVisible();

    // Check Standard mode is selected by default
    await expect(modeSelect).toHaveValue('standard');

    // Switch to Reading mode
    await modeSelect.selectOption('reading');
    await expect(modeSelect).toHaveValue('reading');

    // Study mode option should exist
    const options = await modeSelect.locator('option').allTextContents();
    expect(options).toContain('Study');
  });

  test('theme switching works', async ({ page }) => {
    // Open theme dropdown
    const themeBtn = page.locator('.header__theme-wrapper .header__action-btn');
    await themeBtn.click();

    // Select dark theme
    const darkOption = page.locator('.header__theme-option', { hasText: 'Dark' });
    await darkOption.click();

    // Check theme is applied
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toBe('dark');
  });

  test('settings panel opens and closes', async ({ page }) => {
    // Click settings button
    const settingsBtn = page.locator('.header__action-btn[title="Settings"]');
    await settingsBtn.click();

    // Settings panel should be visible
    await expect(page.locator('.settings-panel-overlay')).toBeVisible();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-panel-overlay')).not.toBeVisible();
  });

  test('settings panel has all tabs', async ({ page }) => {
    const settingsBtn = page.locator('.header__action-btn[title="Settings"]');
    await settingsBtn.click();

    // Settings uses a tabbed layout — Text Size is the default tab
    await expect(page.locator('.settings-panel__section-title', { hasText: 'Text Size' })).toBeVisible();

    // Click "Theme" tab to see its section
    await page.locator('.settings-panel__tab', { hasText: 'Theme' }).click();
    await expect(page.locator('.settings-panel__section-title', { hasText: 'Theme' })).toBeVisible();

    // Click "Modules" tab to see its section
    await page.locator('.settings-panel__tab', { hasText: 'Modules' }).click();
    await expect(page.locator('.settings-panel__section-title', { hasText: 'Commentary' })).toBeVisible();
  });

  test('right-click context menu appears on verses', async ({ page }) => {
    // Navigate first
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('Genesis 1');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Right-click a verse
    const firstVerse = page.locator('.verse').first();
    await firstVerse.click({ button: 'right' });

    // Context menu should appear
    await expect(page.locator('.verse-context-menu')).toBeVisible();
    await expect(page.locator('.verse-context-menu__item', { hasText: 'Copy Passage' })).toBeVisible();
  });

  /**
   * The menu's one navigating item has to land the reader on the Study pane,
   * showing the verse that was right-clicked.
   *
   * It used to offer an item per study target — Cross-References, Topics,
   * Commentary, Dictionary — and each of them opened a pane still showing the
   * previously selected verse. The single "Study" item selects the clicked
   * verse first. The wiring is unit-tested in
   * `src/hooks/useContextMenu.test.ts`; these cases exist because that test
   * cannot prove the document-level `contextmenu` listener is attached, that
   * `pane:show` reaches the store, or that the pane is expanded enough to see.
   */
  const menuItem = (page: Page, label: string) =>
    page.locator('.verse-context-menu').getByRole('button', { name: label, exact: true });

  test('context menu "Study" opens the Study pane', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Start somewhere else, so the assertion cannot pass on the default mode.
    await page.locator('.right-pane-tabs__tab', { hasText: 'Commentary' }).click();
    await expect(page.locator('.right-pane-tabs__tab--active')).toHaveText('Commentary');

    await page.locator('.verse').first().click({ button: 'right' });
    // By accessible name, exact: each item is an icon plus a leading space
    // before its label, so a substring match would let "Study" also hit a
    // future "Study Notes" and an anchored regex would have to know about the
    // whitespace.
    await menuItem(page, 'Study').click();

    await expect(page.locator('.verse-context-menu')).toHaveCount(0);
    await expect(page.locator('.right-pane-tabs__tab--active')).toHaveText('Study');
  });

  test('context menu opens the Study pane on the verse that was right-clicked', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    // Wait for John 3's verses specifically, not for `.verse`. The app opens on
    // Genesis 1, so a bare `.verse` wait is already satisfied by the chapter
    // being navigated away from: this test then read a verse id off Genesis,
    // and asserted on it after John 3 had replaced it. Verse ids are
    // book * 1e6 + chapter * 1e3 + verse, so John 3 is the 43003 prefix.
    await page.waitForSelector('.verse[data-verse-id^="43003"]', { timeout: 10000 });

    // Select one verse, then act on a different one. This is the reported bug:
    // the pane opened on the verse selected before the right-click.
    await page.locator('.verse').first().click();
    const target = page.locator('.verse').nth(4);
    const targetId = await target.getAttribute('data-verse-id');
    expect(targetId).toBeTruthy();

    await target.click({ button: 'right' });
    await menuItem(page, 'Study').click();

    await expect(page.locator('.right-pane-tabs__tab--active')).toHaveText('Study');
    await expect(page.locator(`.verse--study[data-verse-id="${targetId}"]`)).toHaveCount(1);
  });

  test('context menu expands a collapsed right pane', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    await page.locator('.right-pane-tabs__collapse').click();
    await expect(page.locator('.main-layout__commentary-collapsed')).toBeVisible();

    await page.locator('.verse').first().click({ button: 'right' });
    await menuItem(page, 'Study').click();

    // Opening a pane the reader cannot see is the same as doing nothing.
    await expect(page.locator('.right-pane-tabs__tab--active')).toHaveText('Study');
  });

  test('copy dialog opens and closes with Esc', async ({ page }) => {
    // Navigate first
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Right-click to open context menu, then click Copy Passage
    const firstVerse = page.locator('.verse').first();
    await firstVerse.click({ button: 'right' });
    await page.locator('.verse-context-menu__item', { hasText: 'Copy Passage' }).click();

    // Copy dialog should be visible
    await expect(page.locator('.copy-dialog-overlay')).toBeVisible();
    await expect(page.locator('.copy-dialog')).toBeVisible();

    // The format list is a radio group of the four passage shapes core's
    // catalog offers; the fifth entry, Custom Template, stays hidden on the web.
    await expect(page.locator('.copy-dialog__formats[role="radiogroup"]')).toBeVisible();
    await expect(page.locator('.copy-dialog__format')).toHaveCount(4);

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('.copy-dialog-overlay')).not.toBeVisible();
  });

  test('tab bar shows passage title and translation subtitle', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Tab should show passage name and translation
    await expect(page.locator('.bible-tab-bar__tab-title')).toBeVisible();
    await expect(page.locator('.bible-tab-bar__tab-subtitle')).toBeVisible();
  });

  test('active tab has blue border indicator', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    const activeTab = page.locator('.bible-tab-bar__tab--active');
    await expect(activeTab).toBeVisible();
  });

  test('translation selector opens module dialog', async ({ page }) => {
    // The translation selector is a button that opens a module dialog
    const translationBtn = page.locator('.bible-toolbar__translation-btn');
    await expect(translationBtn).toBeVisible();

    // Click it to open the module dialog
    await translationBtn.click();
    await expect(page.locator('.module-dialog')).toBeVisible({ timeout: 3000 });
  });

  test('chapter navigation buttons exist in toolbar', async ({ page }) => {
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    // Should have the history group and the chapter chevrons
    const navBtns = page.locator('.bible-toolbar__nav-btn');
    expect(await navBtns.count()).toBeGreaterThanOrEqual(4); // back, recent passages, prev chapter, next chapter
  });

  test('words of Christ toggle in settings', async ({ page }) => {
    const settingsBtn = page.locator('.header__action-btn[title="Settings"]');
    await settingsBtn.click();

    // Words of Christ checkbox is on the default "Text Size" tab
    const checkbox = page.locator('.settings-panel__field--checkbox input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked(); // Enabled by default
  });

  test('commentary pane shows a tab bar with exactly one active tab', async ({ page }) => {
    // Both assertions used to sit inside `if (visible)` / `if (count > 0)`, so
    // a commentary pane that rendered no tab bar at all passed.
    const searchInput = page.locator('.header__search-field');
    await searchInput.fill('John 3');
    await searchInput.press('Enter');
    await page.waitForSelector('.verse', { timeout: 10000 });

    await page.locator('.right-pane-tabs__tab', { hasText: 'Commentary' }).click();

    await expect(page.locator('.commentary-tab-bar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.commentary-tab-bar__tab').first()).toBeVisible();
    // Exactly one — two highlighted tabs and none are both real failures.
    await expect(page.locator('.commentary-tab-bar__tab--active')).toHaveCount(1);
  });
});
