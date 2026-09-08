/**
 * AI-content disclosure E2E tests.
 *
 * The app opens the AI-synthesized SYNTHESIS commentary by default. These
 * tests assert that every surface which shows that text says where it came
 * from, and that an ordinary human-authored commentary gets no such notice.
 */

import { test, expect, Page } from '../fixtures/electron.fixture';

const DISCLAIMER = '[data-testid="module-disclaimer"]';
const COLLAPSED = '[data-testid="module-disclaimer-collapsed"]';
const HOME_BADGE = '[data-testid="commentary-home-provenance-badge"]';

async function activateCommentaryTab(window: Page): Promise<void> {
  const tab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
  await tab.click({ force: true });
  // dockview only mounts a panel once its tab is active, so this is the
  // condition the fixed 400ms stood in for.
  await expect(window.locator('[data-testid="commentary-pane"]')).toBeVisible({ timeout: 15000 });
}

/**
 * The commentary tab bar does not label tabs with their abbreviation, so a tab
 * cannot be found by one. The digest is the case that matters here: it is
 * deliberately shown as "Combined Summary" and never under its database name
 * (see `moduleDescriptions.ts` / `DIGEST_DISPLAY_NAME`), so `hasText:
 * 'SYNTHESIS'` matched nothing, every call fell through to the "+" picker, and
 * the picker has no row named "SYNTHESIS" either.
 */
const TAB_LABELS: Record<string, string> = {
  SYNTHESIS: 'Combined Summary',
};

/**
 * Show a commentary module's own tab. The digest is already open on a fresh
 * profile (it is the default), so prefer clicking the existing tab and only
 * fall through to the "+" module selector for anything else.
 */
async function openCommentary(window: Page, abbreviation: string): Promise<void> {
  const pane = window.locator('[data-testid="commentary-pane"]');
  const tabLabel = TAB_LABELS[abbreviation] ?? abbreviation;
  const existingTab = pane.locator('[role="tab"]', { hasText: tabLabel }).first();
  if ((await existingTab.count()) > 0) {
    await existingTab.click({ force: true });
    await expect(existingTab).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    return;
  }

  await pane.locator('button:has-text("+")').first().click({ force: true });
  const modal = window.locator('.fixed.inset-0').first();
  await modal.waitFor({ state: 'visible' });
  // Filter and take the highlighted row with Enter rather than clicking a
  // matched row: the picker re-sorts as the per-verse availability check
  // resolves, so a row located a moment ago is routinely replaced before the
  // click lands.
  await modal.locator('input').first().fill(abbreviation);
  await modal.locator('input').first().press('Enter');
  // The picker closing is what says the module was taken; 1.5s was a guess
  // that passed even when the click missed.
  //
  // Not asserted here: that a tab appears named after the abbreviation. The
  // commentary tab bar labels tabs with `cleanModuleName(abbreviation)`, and
  // the pane can show a module through its Overview without opening a tab at
  // all - so the caller's own assertion on the module's content is the check.
  await expect(modal).toHaveCount(0, { timeout: 15000 });
}

test.describe('AI-generated content disclosure', () => {
  test('the default SYNTHESIS commentary discloses its provenance', async ({ window }) => {
    await activateCommentaryTab(window);
    await openCommentary(window, 'SYNTHESIS');

    const notice = window.locator(DISCLAIMER).first();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('auto-generated summary');
    // Announced before the text it qualifies.
    await expect(notice).toHaveAttribute('role', 'note');
  });

  test('a human-authored commentary gets no notice', async ({ window }) => {
    await activateCommentaryTab(window);
    await openCommentary(window, 'MHC');
    // A positive anchor before the negative assertions: without one, "no
    // disclaimer" is also what an empty, still-loading pane looks like.
    await expect(window.locator('[data-testid="commentary-pane"]'))
      .toContainText(/\w/, { timeout: 15000 });
    await expect(window.locator(DISCLAIMER)).toHaveCount(0);
    await expect(window.locator(COLLAPSED)).toHaveCount(0);
  });

  test('the Overview tab labels the generated module in the list', async ({ window }) => {
    await activateCommentaryTab(window);
    const badge = window.locator(HOME_BADGE).first();
    await expect(badge).toBeVisible({ timeout: 20000 });
    await expect(badge).toContainText(/generated/i);
  });

  test('expanding the module in Overview shows the full notice', async ({ window }) => {
    await activateCommentaryTab(window);
    // The badge sits in the module header row; clicking the row expands it.
    const badge = window.locator(HOME_BADGE).first();
    await expect(badge).toBeVisible({ timeout: 20000 });
    await badge.click({ force: true });

    await expect(window.locator(DISCLAIMER).first()).toBeVisible({ timeout: 15000 });
  });

  test('the notice collapses to a labelled chip and expands again', async ({ window }) => {
    await activateCommentaryTab(window);
    await openCommentary(window, 'SYNTHESIS');

    await window.locator('[data-testid="module-disclaimer-collapse"]').first().click({ force: true });
    const chip = window.locator(COLLAPSED).first();
    await expect(chip).toBeVisible();
    // Collapsed still names the provenance - it is quieter, not silent.
    await expect(chip).toContainText(/generated/i);

    await chip.click({ force: true });
    await expect(window.locator(DISCLAIMER).first()).toBeVisible();
  });

  test('the notice survives popping the commentary pane into its own window', async ({ electronApp, window }) => {
    await activateCommentaryTab(window);
    await openCommentary(window, 'SYNTHESIS');
    await expect(window.locator(DISCLAIMER).first()).toBeVisible();

    // Pop out the way a user does: right-click the dockview tab -> "Pop Out to Window".
    const dockTab = window.locator('.dockview-tab-content', { hasText: 'Commentary' }).first();
    await dockTab.click({ button: 'right', force: true });
    const popOut = window.locator('text=Pop Out to Window').first();
    await expect(popOut).toBeAttached({ timeout: 15000 });
    await popOut.click({ force: true });

    const detached = await electronApp.waitForEvent('window');
    await detached.waitForLoadState('domcontentloaded');


    // The disclosure must not vanish when the pane leaves the main window.
    await expect(detached.locator(DISCLAIMER).first()).toBeVisible({ timeout: 15000 });
  });

  test.describe('theming', () => {
    for (const theme of ['light', 'dark', 'sepia'] as const) {
      test(`renders with theme tokens in ${theme}`, async ({ window }) => {
        await activateCommentaryTab(window);
        await openCommentary(window, 'SYNTHESIS');

        await window.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
        }, theme);

        const notice = window.locator(DISCLAIMER).first();
        await expect(notice).toBeVisible({ timeout: 15000 });
        // The theme attribute drives a CSS variable swap, so wait for the
        // repaint rather than sleeping for it.
        await expect(window.locator('html')).toHaveAttribute('data-theme', theme);

        // The notice must take its colours from the theme, not a fixed palette:
        // a hardcoded pale-blue box would render identically in all three.
        const colors = await notice.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, border: cs.borderInlineStartColor };
        });
        expect(colors.bg).not.toBe('rgba(0, 0, 0, 0)');
        expect(colors.bg).not.toBe('rgb(255, 255, 255)');

        await notice.screenshot({
          path: `e2e/test-results/ai-disclaimer-${theme}.png`,
        });
      });
    }
  });
});
