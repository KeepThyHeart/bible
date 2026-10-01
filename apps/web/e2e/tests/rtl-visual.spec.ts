/**
 * RTL e2e assertions and visual baselines (task 0076).
 *
 * Two kinds of test live here:
 *
 *  1. Structural RTL assertions. They run with the rest of the suite, no gate:
 *     `<html dir>`/`lang`, content direction independent of UI direction,
 *     context menus staying on screen near either edge, logical-direction
 *     roving focus.
 *
 *  2. Visual baselines, `en` vs `ar`, for about ten key screens. Gated behind
 *     RTL_VISUAL=1 and Linux: the app uses system fonts, so a baseline is only
 *     meaningful on the machine (font set) that generated it. They never
 *     refresh on their own - see "RTL visual baselines" in e2e/README.md.
 *
 * The fixture data's Bible module is English (KJV-like, LTR), which is the
 * point: an Arabic UI wrapped around LTR scripture must flip the chrome and
 * leave the text alone.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { navigateTo, waitForVerses } from '../helpers';

const LANGS = ['en', 'ar'] as const;
type Lang = (typeof LANGS)[number];

const VISUAL_PROJECTS = ['desktop-chrome', 'mobile-chrome'];
const VISUAL_ENABLED = process.env.RTL_VISUAL === '1' && process.platform === 'linux';

const isMobile = (name: string) => name.includes('mobile');

/**
 * Open the app with the UI language preset.
 *
 * i18next's language detector reads `localStorage.i18nextLng` (see
 * `src/i18n.ts`), so the init script sets it before the app boots on every
 * navigation, including reloads.
 */
async function openApp(page: Page, lng: Lang, mobile: boolean) {
  await page.addInitScript((value: string) => {
    try { globalThis.localStorage.setItem('i18nextLng', value); } catch { /* storage blocked */ }
  }, lng);
  await page.goto('/');
  await page.waitForSelector(mobile ? '.app--mobile' : '.app', { timeout: 10000 });
  await expect(page.locator('html')).toHaveAttribute('lang', lng, { timeout: 10000 });
  await expect(page.locator('html')).toHaveAttribute('dir', lng === 'ar' ? 'rtl' : 'ltr');
}

/** Regions that change between runs and must not fail a pixel comparison. */
function volatileMasks(page: Page): Locator[] {
  return [
    page.locator('.header__offline-badge'),
    page.locator('[data-testid="app-version"]'),
    page.locator('.settings-panel__version'),
    page.locator('.header__clock'),
  ];
}

async function shot(page: Page, name: string, lng: Lang) {
  await expect(page).toHaveScreenshot(`${name}-${lng}.png`, {
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
    mask: volatileMasks(page),
  });
}

/** The settings button by its icon: its title is translated, so not by title. */
function settingsButton(page: Page): Locator {
  return page
    .locator('.header__action-btn:has(.fa-gear), .mobile-landscape-sidebar__action-btn:has(.fa-gear)')
    .first();
}

// ---------------------------------------------------------------------------
// Structural assertions (always run)
// ---------------------------------------------------------------------------

test.describe('RTL structure (ar UI)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !['desktop-chrome', 'mobile-chrome'].includes(testInfo.project.name),
      'RTL structure runs on desktop-chrome and mobile-chrome only',
    );
    await openApp(page, 'ar', isMobile(testInfo.project.name));
  });

  test('html carries dir=rtl and lang=ar', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('KJV text stays LTR inside the RTL UI', async ({ page }, testInfo) => {
    if (!isMobile(testInfo.project.name)) await navigateTo(page, 'John 3');
    else await waitForVerses(page);

    // Content direction comes from the module's language, never from the UI.
    const container = page.locator('.bible-pane [data-content-dir]').first();
    await expect(container).toHaveAttribute('data-content-dir', 'ltr');
    await expect(container).toHaveAttribute('dir', 'ltr');
    await expect(container).toHaveAttribute('lang', /^en/);

    // ...while the chrome around it is RTL.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('verse context menu opened at either edge stays inside the viewport', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'Pointer-anchored menu is a desktop interaction');
    await navigateTo(page, 'John 3');
    const verse = page.locator('.verse').first();

    for (const edge of ['right', 'left'] as const) {
      const viewport = page.viewportSize()!;
      const box = (await verse.boundingBox())!;
      // A synthetic contextmenu at the very edge of the viewport: the menu
      // must flip or clamp, never overflow, whichever way it unfolds.
      await verse.dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: edge === 'right' ? viewport.width - 2 : 2,
        clientY: Math.max(1, Math.min(viewport.height - 2, box.y + 4)),
      });
      const menu = page.locator('.verse-context-menu');
      await expect(menu, `menu near the ${edge} edge`).toBeVisible();
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x, `${edge}: menu left edge`).toBeGreaterThanOrEqual(-1);
      expect(menuBox.x + menuBox.width, `${edge}: menu right edge`).toBeLessThanOrEqual(viewport.width + 1);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  });

  test('arrow keys rove focus in the logical direction', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'Study pane tabs are desktop-only');
    await navigateTo(page, 'John 3');
    await page.locator('.verse').first().click();
    await page.locator('.right-pane-tabs__tab').first().click();
    await expect(page.locator('.study-pane')).toBeVisible({ timeout: 15000 });

    const tabs = page.locator('.study-pane__modes [role="tab"]');
    // The tab strip only exists when the genealogy mode is enabled.
    test.skip((await tabs.count()) < 2, 'Study pane has no mode tab strip in this configuration');

    await tabs.nth(0).focus();
    // RTL: ArrowLeft is "next", ArrowRight is "previous".
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// Visual baselines (RTL_VISUAL=1, Linux only)
// ---------------------------------------------------------------------------

test.describe('RTL visual baselines', () => {
  test.skip(!VISUAL_ENABLED, 'Set RTL_VISUAL=1 on Linux to compare or update RTL baselines');

  for (const lng of LANGS) {
    test.describe(`${lng}`, () => {
      test.beforeEach(async ({ page }, testInfo) => {
        test.skip(
          !VISUAL_PROJECTS.includes(testInfo.project.name),
          'Visual baselines exist for desktop-chrome and mobile-chrome only',
        );
        await openApp(page, lng, isMobile(testInfo.project.name));
      });

      test('bible pane', async ({ page }, testInfo) => {
        if (isMobile(testInfo.project.name)) await waitForVerses(page);
        else await navigateTo(page, 'John 3');
        await shot(page, 'bible-pane', lng);
      });

      test('header and toolbar', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo.project.name), 'Mobile has no header search bar; covered by the nav screen');
        await waitForVerses(page);
        await expect(page.locator('.header')).toHaveScreenshot(`header-${lng}.png`, {
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
          mask: volatileMasks(page),
        });
      });

      test('search results', async ({ page }, testInfo) => {
        if (isMobile(testInfo.project.name)) {
          await page.locator('.mobile-nav__btn').nth(4).click();
          await page.locator('.search-panel-inline__mobile-input').fill('love');
          await page.locator('.search-panel-inline__mobile-submit').click();
        } else {
          const field = page.locator('.header__search-field');
          await field.fill('love');
          await field.press('Enter');
        }
        await page.waitForSelector('.search-panel-inline__header', { timeout: 10000 });
        await expect(page.locator('.search-result-item').first()).toBeVisible({ timeout: 10000 });
        await shot(page, 'search-results', lng);
      });

      test('study pane open', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo.project.name), 'Study pane is a side pane on desktop only');
        await navigateTo(page, 'John 3');
        await page.locator('.verse').first().click();
        await page.locator('.right-pane-tabs__tab').first().click();
        await expect(page.locator('.study-pane__passage')).toBeVisible({ timeout: 15000 });
        await shot(page, 'study-pane', lng);
      });

      test('settings panel', async ({ page }) => {
        await settingsButton(page).click();
        await expect(page.locator('.settings-panel')).toBeVisible();
        await shot(page, 'settings-panel', lng);
      });

      test('verse context menu', async ({ page }, testInfo) => {
        if (isMobile(testInfo.project.name)) await waitForVerses(page);
        else await navigateTo(page, 'John 3');
        await page.locator('.verse').first().click({ button: 'right' });
        await expect(page.locator('.verse-context-menu')).toBeVisible();
        await shot(page, 'verse-context-menu', lng);
      });

      test('mobile navigation bar', async ({ page }, testInfo) => {
        test.skip(!isMobile(testInfo.project.name), 'Mobile-only screen');
        await waitForVerses(page);
        await expect(page.locator('.mobile-nav')).toBeVisible();
        await shot(page, 'mobile-nav', lng);
      });
    });
  }
});
