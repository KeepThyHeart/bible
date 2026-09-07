import { test, expect } from '@playwright/test';
import { desktopOnly, navigateTo, waitForVerses } from '../helpers';

test.describe('Display Modes', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/');
    await page.waitForSelector('.app');
    await navigateTo(page, 'John 1');
  });

  test('Standard mode shows verse numbers as blocks', async ({ page }) => {
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await expect(modeSelect).toHaveValue('standard');

    // Wait for verses to be present
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 10000 });

    // In standard (block) mode, verse numbers use .verse__number-left
    const verseNum = page.locator('.verse__number-left').first();
    await expect(verseNum).toBeVisible();
  });

  test('Reading mode renders prose-style layout', async ({ page }) => {
    // Ensure verses are loaded first
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 10000 });

    // Switch to Reading mode
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await modeSelect.selectOption('reading');
    await expect(modeSelect).toHaveValue('reading');

    // In reading mode, verses render as inline spans, content area should have text
    await expect(page.locator('.bible-content--reading')).toBeVisible({ timeout: 5000 });
    // Wait for verses to re-render in reading mode before reading text
    await expect(page.locator('.bible-content--reading .verse').first()).toBeVisible({ timeout: 5000 });

    // Polled, not sampled once: the first verse becomes visible a frame or more
    // before the chapter's text is all in place, and under a loaded machine that
    // gap was wide enough to read back a heading and nothing else.
    await expect
      .poll(async () => (await page.locator('.bible-content--reading').textContent())?.length ?? 0, { timeout: 5000 })
      .toBeGreaterThan(100);
  });

  test('Study mode is selectable and shows study controls', async ({ page }) => {
    // Ensure verses are loaded before switching mode
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 10000 });

    // Switch to Study mode
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await modeSelect.selectOption('study');
    await expect(modeSelect).toHaveValue('study');

    // Verses should still render
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 10000 });

    // Study mode may show additional controls (interlinear toggle, etc.)
    // The exact UI depends on available data — just verify the mode is applied
    const bibleContent = page.locator('.bible-content').first();
    await expect(bibleContent).toBeVisible();
  });

  test('switching between all three modes does not lose content', async ({ page }) => {
    const modeSelect = page.locator('.bible-toolbar__mode-select');

    // Wait for John 1 verses to fully load
    await expect(page.locator('.bible-tab-bar__tab--active .bible-tab-bar__tab-title')).toContainText('John', { timeout: 10000 });
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 10000 });
    // Wait for full chapter to load — John 1 has 51 verses; wait until count stabilises
    await page.waitForFunction(() => document.querySelectorAll('.verse').length >= 50, { timeout: 10000 });

    // Standard → Reading
    await modeSelect.selectOption('reading');

    await expect(page.locator('.bible-content').first()).toBeVisible();
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 15000 });

    // Reading → Study
    await modeSelect.selectOption('study');

    await expect(page.locator('.bible-content').first()).toBeVisible();
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 15000 });

    // Study → Standard
    await modeSelect.selectOption('standard');
    await expect(modeSelect).toHaveValue('standard', { timeout: 10000 });
    // Verses should still be present after cycling through all modes
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 15000 });
  });

  test('display mode selector reflects current mode after navigation', async ({ page }) => {
    // Set to Reading mode
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await modeSelect.selectOption('reading');

    // Navigate to a different chapter within the same tab
    await navigateTo(page, 'John 2');

    // Mode should persist within the tab
    await expect(modeSelect).toHaveValue('reading');
  });

  test('interlinear toggle appears in Study mode', async ({ page }) => {
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await modeSelect.selectOption('study');
    await expect(modeSelect).toHaveValue('study', { timeout: 10000 });

    // The control is a checkbox in `.bible-content__study-toggles`, next to the
    // text it affects — not a toolbar button. The old selector list
    // (`.bible-toolbar__interlinear-toggle, .interlinear-toggle,
    // [title*="nterlinear"]`) matched nothing anywhere in the app, and the
    // `if (await interlinearToggle.isVisible())` around the body meant the
    // whole test was a no-op.
    const toggles = page.locator('.bible-content__study-toggles');
    await expect(toggles).toBeVisible({ timeout: 15000 });
    const interlinear = toggles.locator('label', { hasText: /interlinear/i })
      .locator('input[type="checkbox"]');
    await expect(interlinear).toBeVisible({ timeout: 15000 });

    // The layout switch only exists while the interlinear is on, so it is the
    // visible consequence of the toggle. Both directions are exercised from
    // wherever the persisted setting left the checkbox — asserting a
    // particular starting state would just be asserting the default.
    const layoutToggle = page.locator('.interlinear-layout-toggle');

    await interlinear.uncheck();
    await expect(interlinear).not.toBeChecked();
    await expect(layoutToggle).toHaveCount(0, { timeout: 10000 });

    await interlinear.check();
    await expect(interlinear).toBeChecked();
    await expect(layoutToggle).toBeVisible({ timeout: 15000 });

    await interlinear.uncheck();
    await expect(layoutToggle).toHaveCount(0, { timeout: 10000 });
  });

  test('the interlinear toggle is absent outside Study mode', async ({ page }) => {
    const modeSelect = page.locator('.bible-toolbar__mode-select');
    await modeSelect.selectOption('standard');
    await expect(modeSelect).toHaveValue('standard', { timeout: 10000 });
    await expect(page.locator('.verse').first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.bible-content__study-toggles')).toHaveCount(0);
  });
});
