import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// Regression specs for the task 0209 (UI hardening) fixes, one comment per bug id.

async function load(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.locator('.header__search-field').fill('John 3');
  await page.locator('.header__search-field').press('Enter');
  await page.waitForSelector('.verse', { timeout: 10000 });
}

async function addTab(page: Page) {
  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(page.locator('.kth-picker__books')).toBeVisible({ timeout: 3000 });
  await page.locator('.kth-picker__cell--book').first().click();
  await page.locator('.kth-picker__cell--chapter').first().click();
}

async function focusedRole(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName.toLowerCase());
}

test.describe('UI hardening 0209 (desktop)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only tests');
    await load(page);
  });

  // U-003 / U-004: theme popup is a non-modal popup with expanded/pressed state; focusing search closes it.
  test('U-003/U-004 theme popup state and non-modal behaviour', async ({ page }) => {
    const themeBtn = page.getByRole('button', { name: /^Theme(: |$)/ }).first();
    await expect(themeBtn).toHaveAttribute('aria-expanded', 'false');
    await themeBtn.click();
    await expect(themeBtn).toHaveAttribute('aria-expanded', 'true');
    const popup = page.getByRole('dialog', { name: 'Theme' });
    await expect(popup).toBeVisible();
    await expect(popup).not.toHaveAttribute('aria-modal', /.*/);
    await expect(popup.locator('button[aria-pressed="true"]')).toHaveCount(1);
    expect(await popup.locator('button[aria-pressed]').count()).toBeGreaterThanOrEqual(3);
    await page.locator('.header__search-field').focus();
    await expect(popup).toHaveCount(0);
    await expect(themeBtn).toHaveAttribute('aria-expanded', 'false');
  });

  // U-015: an open modal makes the rest of the app inert; closing restores it and returns focus.
  test('U-015 modal makes background inert and restores focus', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: 'Settings', exact: true });
    await settingsBtn.click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => !!document.querySelector('header.header')!.closest('[inert]'))).toBe(true);
    expect(await dialog.evaluate((el) => !!el.closest('[inert]'))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(settingsBtn).toBeFocused();
    expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBe(0);
  });

  // U-017 / U-073: Bible tabs are a tablist; closing / Delete leaves focus on a tab.
  test('U-017/U-073 Bible tabs tablist, close and Delete keep focus on a tab', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'Bible tabs' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab', { selected: true })).toHaveCount(1);
    await addTab(page);
    await addTab(page);
    const tabs = tablist.locator('[role="tab"]:not([aria-label="Home"])');
    await expect(tabs).toHaveCount(3);
    const active = tablist.getByRole('tab', { selected: true });
    await expect(active).toHaveCount(1);
    // Both added tabs are "Genesis 1", so scope the "Close <title>" button to the active tab's wrapper.
    await page.locator('.bible-tab-bar__tab--active').getByRole('button', { name: /^Close \S/ }).click();
    await expect(tabs).toHaveCount(2);
    await expect.poll(() => focusedRole(page)).toBe('tab');

    await tabs.first().focus();
    await page.keyboard.press('Delete');
    await expect(tabs).toHaveCount(1);
    await expect.poll(() => focusedRole(page)).toBe('tab');
  });

  // U-030: clearing the search must stay cleared after switching the side pane view.
  test('U-030 cleared search stays empty after side pane switch', async ({ page }) => {
    const field = page.locator('.header__search-field');
    await field.fill('mercy');
    await field.press('Enter');
    await page.getByRole('button', { name: 'Clear search' }).first().click();
    await expect(field).toHaveValue('');
    await page.getByRole('tab', { name: 'Dictionary' }).click();
    await page.getByRole('tab', { name: /^(Study|Commentary)/ }).first().click();
    await expect(field).toHaveValue('');
  });

  // U-074: search-type menu is keyboard operable and returns focus.
  test('U-074 search-type menu keyboard', async ({ page }) => {
    const btn = page.locator('.header__search-type-btn');
    await btn.focus();
    await page.keyboard.press('ArrowDown');
    const items = page.getByRole('menuitemradio');
    await expect(items.first()).toBeVisible();
    // Focus moves in an effect after the menu renders, so wait for it rather than reading it once.
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
    await expect(btn).toBeFocused();
  });

  // U-075: side pane switcher is a tablist with aria-selected on the current view.
  test('U-075 side pane switcher is a tablist', async ({ page }) => {
    const list = page.getByRole('tablist', { name: 'Side pane views' });
    await expect(list).toBeVisible();
    const dict = list.getByRole('tab', { name: 'Dictionary' });
    await dict.click();
    await expect(dict).toHaveAttribute('aria-selected', 'true');
    await expect(list.getByRole('tab', { selected: true })).toHaveCount(1);
  });

  // U-134: Settings opened from the Theme popup "More…" returns focus to the Theme button on Escape.
  test('U-134 Settings from Theme More returns focus to Theme button', async ({ page }) => {
    const themeBtn = page.getByRole('button', { name: /^Theme(: |$)/ }).first();
    await themeBtn.click();
    await page.getByRole('button', { name: /^More/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(themeBtn).toBeFocused();
  });
});

test.describe('UI hardening 0209 (mobile)', () => {
  // U-080: the mobile Topics browser is a named modal dialog; Escape returns focus to the opener.
  test('U-080 Browse All Topics dialog', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only test');
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.app--mobile', { timeout: 10000 });
    await page.locator('.mobile-nav__btn', { hasText: 'Study' }).click();
    const opener = page.getByRole('button', { name: /Browse All Topics/ });
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    const dialog = page.getByRole('dialog', { name: /Topics Browser/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
