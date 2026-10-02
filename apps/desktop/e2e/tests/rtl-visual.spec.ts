/**
 * RTL e2e assertions and visual baselines for the desktop app (task 0076).
 *
 *  1. Structural RTL assertions run with the rest of the suite (no gate):
 *     `<html dir>`/`lang`, content direction independent of UI direction,
 *     the verse context menu staying on screen at either edge, roving focus
 *     moving in the logical direction.
 *
 *  2. Visual baselines, `en` vs `ar`, for the key screens. Gated behind
 *     RTL_VISUAL=1 and Linux: the app uses system fonts, so a baseline is only
 *     meaningful on the machine that generated it. Baselines change only on an
 *     explicit `--update-snapshots`; see "RTL visual baselines" in
 *     e2e/README.md.
 *
 * The fixture's Bible module is KJV (LTR): an Arabic UI must flip the chrome
 * and leave the scripture text alone.
 */
import { test, expect } from '../fixtures/electron.fixture';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { ensurePaneOpen, waitForAppReady } from '../fixtures/test-utils';

const LANGS = ['en', 'ar'] as const;
type Lang = (typeof LANGS)[number];

/** Every RTL UI language the structural assertions run for. */
const RTL_LANGS = ['ar', 'he-IL', 'fa-IR'] as const;
type RtlLang = (typeof RTL_LANGS)[number];

const VISUAL_ENABLED = process.env.RTL_VISUAL === '1' && process.platform === 'linux';

/** Fixed size so baselines are comparable run to run (as chrome-bands does). */
async function fixWindowSize(electronApp: ElectronApplication, window: Page) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1400, height: 900 });
  });
  await window.evaluate(
    () => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/**
 * Switch the UI locale the way chrome-bands does: store it, reload, and wait
 * for `<html dir>` to flip. `en` is a no-op reload so both locales go through
 * the same path.
 */
async function setLocale(window: Page, lang: Lang | RtlLang) {
  await expect(window.locator('[data-testid="app-loaded"]')).toBeAttached({ timeout: 30000 });
  await window.evaluate((value: string) => globalThis.localStorage.setItem('bible.ui.locale', value), lang);
  await window.reload();
  await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
  await window.waitForSelector('[data-testid^="verse-"]', { timeout: 30000 });
  await expect(window.locator('html')).toHaveAttribute('dir', lang === 'en' ? 'ltr' : 'rtl', { timeout: 15000 });
  await expect(window.locator('html')).toHaveAttribute('lang', new RegExp(`^${lang.split('-')[0]}`));
}

/** Regions that change between runs and must not fail a pixel comparison. */
function volatileMasks(window: Page): Locator[] {
  return [
    window.locator('[data-testid="app-version"]'),
    window.locator('[data-testid="onboarding-welcome-bar"]'),
  ];
}

async function shot(window: Page, name: string, lang: Lang) {
  await expect(window).toHaveScreenshot(`${name}-${lang}.png`, {
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
    mask: volatileMasks(window),
  });
}

/**
 * The verse context menu. Not addressed by its aria-label: that is translated
 * ("Verse actions"), so in `ar` the label differs.
 */
function verseMenu(window: Page): Locator {
  return window.locator('[role="menu"]:has([role="menuitem"])').first();
}

async function openVerseMenu(window: Page) {
  const verse = window.locator('[data-testid="verse-1"]');
  await expect(verse).toBeAttached({ timeout: 15000 });
  // `force`: the Electron window is minimized during the run, which fails
  // Playwright's actionability checks.
  await verse.click({ button: 'right', force: true });
  await expect(verseMenu(window)).toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Structural assertions (always run)
// ---------------------------------------------------------------------------

for (const rtlLang of RTL_LANGS) {
test.describe(`RTL structure (${rtlLang} UI)`, () => {
  test.beforeEach(async ({ electronApp, window }) => {
    await waitForAppReady(window);
    await fixWindowSize(electronApp, window);
    await setLocale(window, rtlLang);
  });

  test('html carries dir=rtl and the language', async ({ window }) => {
    await expect(window.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(window.locator('html')).toHaveAttribute('lang', new RegExp(`^${rtlLang.split('-')[0]}`));
  });

  test('search box: input has room and the shortcut chip sits at the inline end', async ({ window }) => {
    const input = window.locator('[data-testid="search-input"]');
    await expect(input).toBeVisible({ timeout: 15000 });
    const box = (await input.boundingBox())!;
    expect(box.width, 'input is wide enough to show its placeholder').toBeGreaterThan(80);
    const chip = window.locator('[data-testid="search-shortcut-hint"]');
    if (await chip.count() === 0 || !(await chip.isVisible())) return; // hidden when focused or narrow
    const c = (await chip.boundingBox())!;
    const inputRect = { left: box.x, right: box.x + box.width };
    const overlap = Math.min(inputRect.right, c.x + c.width) - Math.max(inputRect.left, c.x);
    if (overlap > 0) {
      // Overlaid chip: it must sit on the inline-end (left, in RTL) half of the input, never over the start.
      expect(c.x + c.width / 2, 'chip centre is left of the input centre').toBeLessThan(box.x + box.width / 2);
    }
  });

  test('KJV text stays LTR inside the RTL UI', async ({ window }) => {
    const bible = window.locator('[data-testid="bible-pane"] [data-content-dir]').first();
    await expect(bible).toBeAttached({ timeout: 15000 });
    // Content direction comes from the module's language, not the UI locale.
    await expect(bible).toHaveAttribute('data-content-dir', 'ltr');
    await expect(bible).toHaveAttribute('dir', 'ltr');
    await expect(bible).toHaveAttribute('lang', /^en/);
    await expect(window.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('verse context menu opened at either edge stays inside the viewport', async ({ window }) => {
    const verse = window.locator('[data-testid="verse-1"]');
    await expect(verse).toBeAttached({ timeout: 15000 });

    for (const edge of ['right', 'left'] as const) {
      const size = await window.evaluate(() => ({ w: globalThis.innerWidth, h: globalThis.innerHeight }));
      const box = (await verse.boundingBox())!;
      // A synthetic contextmenu at the very edge of the viewport: the menu
      // must flip or clamp, never overflow, whichever way it unfolds.
      await verse.dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: edge === 'right' ? size.w - 2 : 2,
        clientY: Math.max(1, Math.min(size.h - 2, box.y + 4)),
      });
      const menu = verseMenu(window);
      await expect(menu, `menu near the ${edge} edge`).toBeVisible({ timeout: 5000 });
      const m = (await menu.boundingBox())!;
      expect(m.x, `${edge}: menu left edge`).toBeGreaterThanOrEqual(-1);
      expect(m.x + m.width, `${edge}: menu right edge`).toBeLessThanOrEqual(size.w + 1);
      await window.keyboard.press('Escape');
      await expect(menu).toHaveCount(0, { timeout: 5000 });
    }
  });

  test('arrow keys rove focus in the logical direction', async ({ window }) => {
    // First visible tab strip with at least two tabs. The first-run layout
    // may only have single-tab strips, in which case there is nothing to rove.
    const strips = window.locator('[role="tablist"]');
    const count = await strips.count();
    let tabs: Locator | undefined;
    for (let i = 0; i < count; i++) {
      const candidate = strips.nth(i).locator('[role="tab"]');
      if (await strips.nth(i).isVisible() && (await candidate.count()) >= 2) { tabs = candidate; break; }
    }
    test.skip(!tabs, 'No tab strip with two or more tabs in the default layout');

    await tabs!.nth(0).focus();
    // RTL: ArrowLeft is "next", ArrowRight is "previous".
    await window.keyboard.press('ArrowLeft');
    await expect(tabs!.nth(1)).toBeFocused();
    await window.keyboard.press('ArrowRight');
    await expect(tabs!.nth(0)).toBeFocused();
  });
});
}

// ---------------------------------------------------------------------------
// Visual baselines (RTL_VISUAL=1, Linux only)
// ---------------------------------------------------------------------------

test.describe('RTL visual baselines', () => {
  test.skip(!VISUAL_ENABLED, 'Set RTL_VISUAL=1 on Linux to compare or update RTL baselines');

  for (const lang of LANGS) {
    test.describe(`${lang}`, () => {
      test.beforeEach(async ({ electronApp, window }) => {
        await waitForAppReady(window);
        await fixWindowSize(electronApp, window);
      });

      test('default layout', async ({ window }) => {
        await setLocale(window, lang);
        await shot(window, 'default-layout', lang);
      });

      test('bible pane', async ({ window }) => {
        await setLocale(window, lang);
        const pane = window.locator('[data-testid="bible-pane"]');
        await expect(pane).toBeVisible();
        await expect(pane).toHaveScreenshot(`bible-pane-${lang}.png`, {
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
          mask: volatileMasks(window),
        });
      });

      test('preferences dialog', async ({ window }) => {
        await setLocale(window, lang);
        await window.evaluate(() => globalThis.__services!.registry.execute('app.openPreferences'));
        await expect(window.locator('[role="dialog"][aria-labelledby="preferences-dialog-title"]'))
          .toBeVisible({ timeout: 10000 });
        await shot(window, 'preferences-dialog', lang);
      });

      test('verse context menu', async ({ window }) => {
        await setLocale(window, lang);
        await openVerseMenu(window);
        await shot(window, 'verse-context-menu', lang);
      });

      test('command palette', async ({ window }) => {
        await setLocale(window, lang);
        // The palette is the top search bar's command mode: a leading "/".
        const input = window.locator('[data-testid="search-input"]');
        await input.click({ force: true });
        await input.fill('/');
        await shot(window, 'command-palette', lang);
      });

      test('notes pane (empty)', async ({ window }) => {
        // Open in English first: pane labels and the New-tab button are
        // translated, and the opener helper matches English text. The layout
        // survives the reload that switches the locale.
        await ensurePaneOpen(window, 'Notes');
        await setLocale(window, lang);
        const pane = window.locator('[data-testid="notes-pane"]');
        await expect(pane).toBeVisible({ timeout: 15000 });
        await shot(window, 'notes-pane', lang);
      });
    });
  }
});
