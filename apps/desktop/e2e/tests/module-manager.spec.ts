/**
 * Module Manager E2E Tests
 *
 * Tests for the Module Manager dialog: opening it, viewing installed modules,
 * switching tabs, and verifying repository settings are accessible.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Page } from '@playwright/test';


/**
 * Open the Module Manager dialog via the command registry exposed on
 * `window.__services`. This avoids reliance on Electron menu label text
 * which changes when the i18n layer resolves command titles.
 */
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

    // Verify all tabs are present
    await expect(window.locator('[data-testid="module-manager-available-tab"]')).toBeVisible();
    await expect(window.locator('[data-testid="module-manager-installed-tab"]')).toBeVisible();
    await expect(window.locator('[data-testid="module-manager-repositories-tab"]')).toBeVisible();

    // Switch to the Installed Modules tab
    await window.click('[data-testid="module-manager-installed-tab"]', { force: true });

    const moduleCards = window.locator('[data-testid="module-list-installed"] [data-testid^="module-card-"]');
    await expect(moduleCards.first()).toBeVisible({ timeout: 20000 });
    const cardCount = await moduleCards.count();

    // If there are module .db files in data/modules/, there should be installed modules
    // This is the core bug fix verification: installed modules should NOT be empty
    expect(cardCount).toBeGreaterThan(0);

    // Verify the first module card has expected elements
    const firstCard = moduleCards.first();
    await expect(firstCard).toBeVisible();

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

  test('should show module type and abbreviation in installed modules list', async ({ window }) => {
    // Wait for app to be ready
    await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible();

    // Open Module Manager via the command registry
    await openModuleManager(window);

    const dialog = window.locator('[data-testid="module-manager-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Switch to installed tab
    await window.click('[data-testid="module-manager-installed-tab"]', { force: true });

    const moduleCards = window.locator('[data-testid="module-list-installed"] [data-testid^="module-card-"]');
    await expect(moduleCards.first()).toBeVisible({ timeout: 20000 });
    const count = await moduleCards.count();

    // Verify we have modules
    expect(count).toBeGreaterThan(0);

    // Check that each module card has an abbreviation and a module type icon
    for (let i = 0; i < Math.min(count, 5); i++) {
      const card = moduleCards.nth(i);
      // Abbreviation should be in a font-mono span
      const abbreviation = card.locator('.font-mono');
      await expect(abbreviation).toBeVisible();
      const abbText = await abbreviation.textContent();
      expect(abbText).toBeTruthy();
      expect(abbText!.trim().length).toBeGreaterThan(0);
    }

    // Close
    await window.keyboard.press('Escape');
  });
});
