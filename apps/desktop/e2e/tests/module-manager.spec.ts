/**
 * Module Manager E2E Tests
 *
 * Tests for the Module Manager dialog: opening it, viewing installed modules
 * (type tabs + the Installed filter chip + the module table), opening a row's
 * details panel, and verifying the Sources (repository) settings are accessible.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';


/**
 * Open the Module Manager dialog via the command registry exposed on
 * `window.__services`. This avoids reliance on Electron menu label text
 * which changes when the i18n layer resolves command titles.
 */
/**
 * Rows of the table for one module type. `tr[...]` matters: the row's status
 * cell, progress span and Install button also carry `module-row-*` test ids.
 */
function moduleRows(window: Page, type = 'bible') {
  return window.locator(`[data-testid="module-table-${type}"] tr[data-testid^="module-row-"]`);
}

async function openModuleManager(window: Page): Promise<void> {
  await window.waitForFunction(() => Boolean(globalThis.__services), null, { timeout: 15000 });
  // App.tsx registers 'command:module:openManager' in a useEffect, which runs
  // after first paint. Wait for the command to exist in the registry rather
  // than for 500ms - the registry is the thing being waited on.
  await window.waitForFunction(
    () => globalThis.__services!.registry.list().some(c => c.id === 'module.openManager'),
    null,
    { timeout: 15000 },
  );
  await window.evaluate(() => globalThis.__services!.registry.execute('module.openManager'));
}

test.describe('Module Manager', () => {
  test('should open Module Manager and display installed modules', async ({ window }) => {
    // Wait for app to be ready
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();

    // Open Module Manager via the command registry
    await openModuleManager(window);

    // Wait for the Module Manager dialog to appear
    const dialog = window.locator('[data-testid="module-manager-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Verify dialog header
    await expect(dialog.locator('text=Module Manager')).toBeVisible();
    await expect(dialog.locator('text=Browse, install, and manage Bible study resources')).toBeVisible();

    // Verify the tab strip: a Bibles type tab, then the Feature packs and
    // Sources panels on the right.
    await expect(window.locator('[data-testid="module-manager-type-tab-bible"]')).toBeVisible();
    await expect(window.locator('[data-testid="module-manager-features-tab"]')).toBeVisible();
    await expect(window.locator('[data-testid="module-manager-repositories-tab"]')).toBeVisible();

    // The All / Installed / Updates filter chips
    await expect(window.locator('[data-testid="module-manager-filter-all"]')).toBeVisible();
    await expect(window.locator('[data-testid="module-manager-filter-updates"]')).toBeVisible();

    // Narrow the Bibles table to the Installed filter
    await window.click('[data-testid="module-manager-filter-installed"]', { force: true });
    await expect(window.locator('[data-testid="module-manager-filter-installed"]')).toHaveAttribute('aria-pressed', 'true');

    await expect(window.locator('[data-testid="module-table-bible"]')).toBeVisible();
    const moduleRowsLocator = moduleRows(window);
    await expect(moduleRowsLocator.first()).toBeVisible({ timeout: 20000 });
    const rowCount = await moduleRowsLocator.count();

    // If there are module .db files in data/modules/, there should be installed modules
    // This is the core bug fix verification: installed modules should NOT be empty
    expect(rowCount).toBeGreaterThan(0);

    // Every row under the Installed filter is an installed module
    await expect(moduleRowsLocator.first().locator('[data-status="installed"], [data-status="update"]')).toBeVisible();

    // Close the dialog
    await window.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('should display Repositories tab with repository settings', async ({ window }) => {
    // Wait for app to be ready
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();

    // Open Module Manager via the command registry
    await openModuleManager(window);

    const dialog = window.locator('[data-testid="module-manager-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click on the Repositories tab
    await window.click('[data-testid="module-manager-repositories-tab"]', { force: true });

    const repoSettings = window.locator('[data-testid="repository-settings"]');
    await expect(repoSettings).toBeVisible({ timeout: 15000 });

    // Verify "Add Repository" button is present
    const addButton = window.locator('[data-testid="add-repository-button"]');
    await expect(addButton).toBeVisible();

    // A default repository is only seeded when the build supplies
    // BIBLE_MODULE_CATALOG_URL (see electron/config/appConfig.ts). Accept
    // either state: a seeded repository row with an Edit URL button, or the
    // honest "no repository is configured" guidance.
    const editButtons = window.locator('[data-testid^="repository-edit-url-"]');
    const editCount = await editButtons.count();
    if (editCount > 0) {
      await expect(repoSettings.locator('text=Official').first()).toBeVisible();
    } else {
      await expect(repoSettings.locator('[data-testid="no-repositories"]')).toBeVisible();
    }

    // Close
    await window.keyboard.press('Escape');
  });

  test('should show abbreviation and open the details panel for an installed module row', async ({ window }) => {
    // Wait for app to be ready
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();

    // Open Module Manager via the command registry
    await openModuleManager(window);

    const dialog = window.locator('[data-testid="module-manager-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Installed filter on the (default) Bibles tab
    await window.click('[data-testid="module-manager-filter-installed"]', { force: true });

    const rows = moduleRows(window);
    await expect(rows.first()).toBeVisible({ timeout: 20000 });
    const count = await rows.count();

    // Verify we have modules
    expect(count).toBeGreaterThan(0);

    // Each row's test id is `module-row-<abbreviation>`, and the abbreviation
    // is also shown as text in the row's name cell.
    for (let i = 0; i < Math.min(count, 5); i++) {
      const row = rows.nth(i);
      const testId = await row.getAttribute('data-testid');
      const abbreviation = testId!.replace(/^module-row-/, '');
      expect(abbreviation.length).toBeGreaterThan(0);
      await expect(row).toContainText(abbreviation);
    }

    // Clicking a row opens the details panel inside the dialog (not a nested modal)
    const firstRow = rows.first();
    const firstAbbreviation = (await firstRow.getAttribute('data-testid'))!.replace(/^module-row-/, '');
    await firstRow.click();
    const panel = dialog.locator('[data-testid="module-details-panel"]');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.locator('[data-testid="module-details-abbreviation"]')).toHaveText(firstAbbreviation);

    // Closing the panel leaves the dialog open
    await panel.locator('[data-testid="module-details-close"]').click();
    await expect(panel).not.toBeVisible();
    await expect(dialog).toBeVisible();

    // Close
    await window.keyboard.press('Escape');
  });
});
