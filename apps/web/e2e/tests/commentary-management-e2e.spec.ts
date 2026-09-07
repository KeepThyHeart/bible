import { test, expect, type Page } from '@playwright/test';
import { desktopOnly, navigateTo, waitForVerses } from '../helpers';

/**
 * Open the Commentary tab and wait until it has actually rendered an entry.
 *
 * `data/settings.json` activates four commentary modules for these runs, so
 * every step here is an assertion rather than a guard: an absent tab or an
 * empty pane is a failure, not a reason to stop testing.
 */
async function openCommentary(page: Page): Promise<void> {
  const tab = page.locator('.right-pane-tabs__tab').filter({ hasText: /commentary/i });
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
  await expect(page.locator('.commentary-tab-bar')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.commentary-entry').first()).toBeVisible({ timeout: 15000 });
}

/**
 * The pin toggle, which lives in the passage header — not the tab bar.
 *
 * The two pin tests below used to look for `.commentary-tab-bar__pin` /
 * `.commentary-tab-bar__keep`. Neither has ever existed: the tab bar renders
 * only a `__pin-indicator` icon on an already-pinned tab. Both tests therefore
 * returned at their `isVisible` guard and asserted nothing at all.
 */
function pinButton(page: Page) {
  return page.locator('.commentary-passage-header__pin');
}

test.describe('Commentary Management', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/');
    await page.waitForSelector('.app');
    await navigateTo(page, 'John 3');
  });

  test('commentary tab shows entries for current chapter', async ({ page }) => {
    // Click a verse to trigger commentary loading
    await page.locator('.verse').first().click();

    // Unconditional throughout: `data/settings.json` activates four commentary
    // modules for these runs, so an absent tab bar or an empty entry list is a
    // failure, not a reason to stop asserting. The guards this replaces meant
    // the test passed with no commentary rendered at all.
    const commentaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /commentary/i });
    await expect(commentaryTab).toBeVisible({ timeout: 10000 });
    await commentaryTab.click();

    await expect(page.locator('.commentary-tab-bar')).toBeVisible({ timeout: 10000 });
    expect(await page.locator('.commentary-tab-bar__tab').count()).toBeGreaterThanOrEqual(1);

    await expect(page.locator('.commentary-entry').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.commentary-entry__ref').first()).toBeVisible();
  });

  test('commentary updates when navigating to a different chapter', async ({ page }) => {
    await page.locator('.verse').first().click();
    await openCommentary(page);

    const ref = page.locator('.commentary-entry__ref').first();
    const initialRef = (await ref.textContent())?.trim();
    expect(initialRef).toBeTruthy();

    await navigateTo(page, 'Genesis 1');
    await page.locator('.verse').first().click();

    await expect(ref).not.toContainText(initialRef!, { timeout: 10000 });
    await expect(ref).toContainText(/Genesis|Gen/i, { timeout: 10000 });
  });

  test('commentary pin preserves content during navigation', async ({ page }) => {
    // The whole point of the pin: keep a commentary on the passage you are
    // studying while you go and read somewhere else.
    await page.locator('.verse').first().click();
    await openCommentary(page);

    const ref = page.locator('.commentary-entry__ref').first();
    const pinnedRef = (await ref.textContent())?.trim();
    expect(pinnedRef).toBeTruthy();

    await pinButton(page).click();
    await expect(pinButton(page)).toHaveClass(/commentary-passage-header__pin--active/);

    await navigateTo(page, 'Revelation 1');
    await page.locator('.verse').first().click();

    // Still on the pinned passage, a whole testament away from the Bible pane.
    await expect(ref).toHaveText(pinnedRef!, { timeout: 10000 });
  });

  test('commentary unpin resumes tracking current verse', async ({ page }) => {
    // Unpinning has to catch the commentary up to wherever the reader went
    // while it was pinned — not merely stop holding still from now on.
    await page.locator('.verse').first().click();
    await openCommentary(page);

    const ref = page.locator('.commentary-entry__ref').first();
    await expect(ref).toContainText(/John/i, { timeout: 10000 });

    await pinButton(page).click();
    await expect(pinButton(page)).toHaveClass(/commentary-passage-header__pin--active/);

    await navigateTo(page, 'Genesis 1');
    await page.locator('.verse').first().click();
    await expect(ref).toContainText(/John/i);

    await pinButton(page).click();
    await expect(pinButton(page)).not.toHaveClass(/commentary-passage-header__pin--active/);

    await expect(ref).toContainText(/Genesis|Gen/i, { timeout: 10000 });
  });

  test('multiple commentary tabs can be opened', async ({ page }) => {
    await page.locator('.verse').first().click();

    const commentaryTab = page.locator('.right-pane-tabs__tab').filter({ hasText: /commentary/i });
    await expect(commentaryTab).toBeVisible({ timeout: 10000 });
    await commentaryTab.click();
    await expect(page.locator('.commentary-tab-bar')).toBeVisible({ timeout: 10000 });

    const tabs = page.locator('.commentary-tab-bar__tab');
    const before = await tabs.count();

    await page.locator('.commentary-tab-bar__add').click();
    await expect(page.locator('.module-dialog')).toBeVisible({ timeout: 5000 });

    // Pick a module that is NOT already open — clicking an open one would
    // *close* it, and the original assertion (`toBeGreaterThanOrEqual`) passed
    // either way, so it could not tell adding from removing.
    const unopened = page.locator('.module-dialog .module-card').filter({
      has: page.locator('.module-card__check--off'),
    });
    await expect(unopened.first()).toBeVisible({ timeout: 5000 });
    await unopened.first().click();

    await page.locator('.module-dialog__btn--apply').click();
    await expect(page.locator('.module-dialog')).toHaveCount(0, { timeout: 5000 });

    await expect(tabs).toHaveCount(before + 1, { timeout: 10000 });
  });
});
