import { test, expect } from '../fixtures';
import { desktopOnly, navigateTo, waitForVerses } from '../helpers';

test.describe('Accessibility Basics', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/');
    await page.waitForSelector('.app');
    await navigateTo(page, 'John 3');
  });

  test('search input is reachable by keyboard', async ({ page }) => {
    // Click away from any focused element
    const searchInput = page.locator('.header__search-field');
    await page.locator('.bible-pane').click();
    await expect(searchInput).not.toBeFocused({ timeout: 10000 });

    // Ctrl+K should focus search
    await page.keyboard.press('Control+k');
    await expect(searchInput).toBeFocused({ timeout: 2000 });
  });

  test('Escape closes all dialog types', async ({ page }) => {
    // 1. Settings panel
    await page.locator('.header__action-btn[title="Settings"]').click();
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-panel-overlay')).not.toBeVisible({ timeout: 2000 });

    // 2. Context menu
    await page.locator('.verse').first().click({ button: 'right' });
    await expect(page.locator('.verse-context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.verse-context-menu')).not.toBeVisible({ timeout: 2000 });

    // 3. Copy dialog
    await page.locator('.verse').first().click({ button: 'right' });
    await page.locator('.verse-context-menu__item', { hasText: 'Copy Passage' }).click();
    await expect(page.locator('.copy-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.copy-dialog-overlay')).not.toBeVisible({ timeout: 2000 });

    // 4. Module dialog
    await page.locator('.bible-toolbar__translation-btn').click();
    await expect(page.locator('.module-dialog')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.module-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('navigation buttons are keyboard-accessible', async ({ page }) => {
    // History and chapter nav buttons should be focusable
    const navBtns = page.locator('.bible-toolbar__nav-btn');
    const count = await navBtns.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const btn = navBtns.nth(i);
      // Buttons should be actual <button> elements (natively focusable)
      const tagName = await btn.evaluate(el => el.tagName.toLowerCase());
      expect(tagName).toBe('button');
    }
  });

  test('tab bar buttons are keyboard-accessible', async ({ page }) => {
    // The Bible tab strip is a tablist (0209 U-017): every tab is focusable and the selected
    // one is in the Tab order (roving tabindex; arrows move between the others).
    const tabs = page.getByRole('tablist', { name: /Bible tabs/ }).getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    const indexes = await tabs.evaluateAll(els => els.map(el => (el as HTMLElement).tabIndex));
    expect(indexes.every(i => i >= -1)).toBe(true);
    const selected = page.getByRole('tablist', { name: /Bible tabs/ }).getByRole('tab', { selected: true });
    await expect(selected).toHaveCount(1);
    expect(await selected.evaluate(el => (el as HTMLElement).tabIndex)).toBe(0);
  });

  test('interactive elements use semantic HTML or have roles', async ({ page }) => {
    // Check that key interactive elements are proper buttons, not just divs with onClick
    const interactiveSelectors = [
      '.header__action-btn',
      '.bible-toolbar__translation-btn',
      '.bible-tab-bar__add',
    ];

    // Unconditional: an element that has stopped rendering is a regression in
    // its own right, and the `if (visible)` this replaced turned that into a
    // pass. Each selector is required to exist and to be semantic.
    for (const selector of interactiveSelectors) {
      const el = page.locator(selector).first();
      await expect(el, `${selector} should be present`).toBeVisible({ timeout: 10000 });

      const { tagName, role } = await el.evaluate(node => ({
        tagName: node.tagName.toLowerCase(),
        role: node.getAttribute('role'),
      }));

      expect(
        ['button', 'a'].includes(tagName) || role != null,
        `${selector} renders as <${tagName}> with no role`,
      ).toBe(true);
    }
  });
});
