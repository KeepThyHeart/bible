/**
 * Search tabs E2E (task 0210)
 *
 * Enter replaces the active search tab's query; Ctrl/Cmd+Enter opens another
 * tab. Tabs are capped at 8, restored on restart, and placed below the Bible
 * pane or on the right according to Preferences > Search. The third placement,
 * "Tab in the right pane", keeps one Search tab in the Study group with a
 * sub-tab per search.
 */

import { _electron as electron } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { test, expect, dismissFirstRunDialog } from '../fixtures/electron.fixture';
import { waitForAppReady, waitForKeywordIndexes } from '../fixtures/test-utils';
import { dataEnv } from '../fixtures/dataDir';

const SEARCH_TIMEOUT = 30000;
const MAIN_JS = process.env.E2E_MAIN_JS ?? path.resolve(__dirname, '../../out/main/index.js');

const input = (w: Page): Locator => w.locator('[data-testid="search-input"]');
const searchTabs = (w: Page): Locator => w.locator('.dv-tab[aria-label^="Search: "]');
const tab = (w: Page, query: string): Locator => w.locator(`.dv-tab[aria-label="Search: ${query}"]`);
const visiblePane = (w: Page): Locator => w.locator('[data-testid="search-results-pane"]:visible');

/** Type a query in the header and submit it (Enter, or Control+Enter for a new tab). */
async function submit(w: Page, query: string, newTab = false): Promise<void> {
  const el = input(w);
  await el.click({ force: true });
  await el.fill(query);
  await el.press(newTab ? 'Control+Enter' : 'Enter');
}

async function expectResults(w: Page, query: string): Promise<void> {
  await expect(visiblePane(w).getByRole('heading', { name: new RegExp(query, 'i') }))
    .toBeVisible({ timeout: SEARCH_TIMEOUT });
  await expect(visiblePane(w).locator('[data-testid="search-result"]').first())
    .toBeVisible({ timeout: SEARCH_TIMEOUT });
}

async function openTwo(w: Page): Promise<void> {
  await submit(w, 'love');
  await expectResults(w, 'love');
  await submit(w, 'faith', true);
  await expect(tab(w, 'faith')).toBeVisible({ timeout: SEARCH_TIMEOUT });
  await expectResults(w, 'faith');
}

async function openSearchPreferences(w: Page): Promise<void> {
  await w.evaluate(() => (globalThis as unknown as { __services: { registry: { execute(id: string): unknown } } }).__services.registry.execute('app.openPreferences'));
  await w.locator('#preferences-tab-search').click();
}

/** The one general Search tab of "Tab in the right pane" (its dockview title is the generic "Search"). */
const hostTab = (w: Page): Locator => w.locator('.dv-tab').filter({ has: w.getByText('Search', { exact: true }) });
const subTabs = (w: Page): Locator => w.locator('[data-testid="search-subtab"]');
const subTab = (w: Page, query: string): Locator => w.locator(`[data-testid="search-subtab"][aria-label="Search: ${query}"]`);

async function openTwoHosted(w: Page): Promise<void> {
  await submit(w, 'love');
  await expectResults(w, 'love');
  await expect(subTab(w, 'love')).toBeVisible({ timeout: SEARCH_TIMEOUT });
  await submit(w, 'faith', true);
  await expect(subTab(w, 'faith')).toBeVisible({ timeout: SEARCH_TIMEOUT });
  await expectResults(w, 'faith');
}

async function setPlacement(w: Page, value: 'below' | 'tab' | 'right'): Promise<void> {
  await openSearchPreferences(w);
  await w.locator(`[data-testid="search-placement-${value}"]`).check({ force: true });
  await w.keyboard.press('Escape');
  await expect(w.locator('#preferences-tab-search')).toHaveCount(0, { timeout: 10000 });
}

test.describe('Search tabs', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
    await waitForKeywordIndexes(window);
  });

  test('Ctrl+Enter opens a second tab for a different query', async ({ window }) => {
    await openTwo(window);
    await expect(searchTabs(window)).toHaveCount(2);
    await expect(tab(window, 'love')).toBeVisible();
    await expect(tab(window, 'faith')).toHaveAttribute('aria-selected', 'true');
    await expect(input(window)).toHaveValue('faith');
  });

  test('clicking a tab shows its results and syncs the header input', async ({ window }) => {
    await openTwo(window);
    await tab(window, 'love').click();
    await expectResults(window, 'love');
    await expect(input(window)).toHaveValue('love');
    await expect(tab(window, 'love')).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter replaces the active tab query instead of adding a tab', async ({ window }) => {
    await openTwo(window);
    await submit(window, 'hope');
    await expect(tab(window, 'hope')).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await expect(searchTabs(window)).toHaveCount(2);
    await expect(tab(window, 'faith')).toHaveCount(0);
    await expect(tab(window, 'hope')).toHaveAttribute('aria-selected', 'true');
    await expectResults(window, 'hope');
  });

  test('closing the active tab leaves the other and updates the header', async ({ window }) => {
    await openTwo(window);
    await tab(window, 'faith').locator('[data-testid="close-tab"]').click();
    await expect(searchTabs(window)).toHaveCount(1);
    await expect(tab(window, 'love')).toBeVisible();
    await expect(input(window)).toHaveValue('love', { timeout: 10000 });
  });

  test('Ctrl+Enter with no tabs open opens a single tab', async ({ window }) => {
    await expect(searchTabs(window)).toHaveCount(0);
    await submit(window, 'love', true);
    await expectResults(window, 'love');
    await expect(searchTabs(window)).toHaveCount(1);
  });

  test('opening a ninth search drops the oldest (cap of 8)', async ({ window }) => {
    test.setTimeout(240000);
    const queries = ['love', 'faith', 'hope', 'grace', 'peace', 'joy', 'light', 'truth', 'life'];
    for (const q of queries) {
      await submit(window, q, true);
      await expect(tab(window, q)).toBeVisible({ timeout: SEARCH_TIMEOUT });
    }
    await expect(searchTabs(window)).toHaveCount(8);
    await expect(tab(window, 'love')).toHaveCount(0);
    await expect(tab(window, 'life')).toHaveAttribute('aria-selected', 'true');
  });

  test('"Open in New Search Tab" from the tab menu duplicates the query', async ({ window }) => {
    await submit(window, 'love');
    await expectResults(window, 'love');
    await tab(window, 'love').click({ button: 'right' });
    await window.locator('[data-testid="search-tab-open-in-new-tab"]').click();
    await expect(searchTabs(window)).toHaveCount(2, { timeout: SEARCH_TIMEOUT });
    await expect(window.locator('.dv-tab[aria-label="Search: love"]')).toHaveCount(2);
  });

  test('right placement puts the pane on the right at full height; below is under the Bible pane', async ({ window }) => {
    // Default: below the Bible pane.
    await submit(window, 'love');
    await expectResults(window, 'love');
    const bible = window.locator('[data-testid="bible-pane"], .bible-pane').first();
    const belowBox = (await visiblePane(window).boundingBox())!;
    const bibleBox = (await bible.boundingBox())!;
    expect(belowBox.y).toBeGreaterThan(bibleBox.y);

    // Close it and switch to the right-hand placement.
    await visiblePane(window).getByRole('button', { name: /close/i }).first().click();
    await expect(searchTabs(window)).toHaveCount(0, { timeout: 10000 });
    await setPlacement(window, 'right');

    await submit(window, 'faith');
    await expectResults(window, 'faith');
    const win = window.viewportSize() ?? (await window.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    const rightBox = (await visiblePane(window).boundingBox())!;
    const workbench = (await window.locator('.dv-dockview').first().boundingBox())!;
    expect(rightBox.x + rightBox.width / 2).toBeGreaterThan(win.width / 2);
    expect(rightBox.height).toBeGreaterThan(workbench.height * 0.8);
  });
});

test.describe('Search tabs: Tab in the right pane', () => {
  test.beforeEach(async ({ window }) => {
    await waitForAppReady(window);
    await waitForKeywordIndexes(window);
    await setPlacement(window, 'tab');
  });

  test('a search opens one generic Search tab in the Study group, with a sub-tab strip', async ({ window }) => {
    await submit(window, 'love');
    await expectResults(window, 'love');

    await expect(hostTab(window)).toHaveCount(1);
    // No tab of its own for the search itself.
    await expect(searchTabs(window)).toHaveCount(0);
    // It sits in the right-hand group: the one that holds the Study tab.
    const group = window.locator('.dv-groupview', { has: window.locator('.dv-tab:has-text("Study")') });
    await expect(group.locator('.dv-tab').filter({ has: window.getByText('Search', { exact: true }) })).toHaveCount(1);
    await expect(window.locator('[data-testid="search-subtabs"]')).toBeVisible();
    await expect(subTabs(window)).toHaveCount(1);
    await expect(subTab(window, 'love')).toHaveAttribute('aria-selected', 'true');
    await expect(input(window)).toHaveValue('love');
  });

  test('Ctrl+Enter adds a sub-tab and keeps a single Search tab', async ({ window }) => {
    await openTwoHosted(window);

    await expect(subTabs(window)).toHaveCount(2);
    await expect(hostTab(window)).toHaveCount(1);
    await expect(searchTabs(window)).toHaveCount(0);
    await expect(subTabs(window).nth(0)).toHaveAttribute('data-session-id', /.+/);
    await expect(subTab(window, 'faith')).toHaveAttribute('aria-selected', 'true');
    await expect(subTab(window, 'love')).toHaveAttribute('aria-selected', 'false');
    await expect(input(window)).toHaveValue('faith');
    // Opening order is kept: love first.
    await expect(subTabs(window).first()).toHaveAttribute('aria-label', 'Search: love');
  });

  test('Enter replaces the selected sub-tab instead of adding one', async ({ window }) => {
    await openTwoHosted(window);
    await submit(window, 'hope');
    await expect(subTab(window, 'hope')).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await expect(subTabs(window)).toHaveCount(2);
    await expect(subTab(window, 'faith')).toHaveCount(0);
    await expectResults(window, 'hope');
  });

  test('clicking a sub-tab shows its results and syncs the header box', async ({ window }) => {
    await openTwoHosted(window);

    await subTab(window, 'love').click();

    await expectResults(window, 'love');
    await expect(input(window)).toHaveValue('love');
    await expect(subTab(window, 'love')).toHaveAttribute('aria-selected', 'true');

    await subTab(window, 'faith').click();
    await expectResults(window, 'faith');
    await expect(input(window)).toHaveValue('faith');
  });

  test('closing a sub-tab leaves the other and updates the header', async ({ window }) => {
    await openTwoHosted(window);

    await subTab(window, 'faith').locator('xpath=following-sibling::*[@data-testid="search-subtab-close"]').click();
    await expect(subTabs(window)).toHaveCount(1);
    await expect(subTab(window, 'love')).toBeVisible();
    await expect(hostTab(window)).toHaveCount(1);
    await expect(input(window)).toHaveValue('love', { timeout: 10000 });
    await expectResults(window, 'love');
  });

  // The box keeps its text after the last sub-tab closes; the empty Search tab must still go.
  test('closing the last sub-tab removes the Search tab', async ({ window }) => {
    await submit(window, 'love');
    await expectResults(window, 'love');
    await window.locator('[data-testid="search-subtab-close"]').click();
    await expect(hostTab(window)).toHaveCount(0, { timeout: 10000 });
    await expect(subTabs(window)).toHaveCount(0);
  });

  test('the results pane close button closes only the selected sub-tab', async ({ window }) => {
    await openTwoHosted(window);
    await visiblePane(window).getByRole('button', { name: /close/i }).first().click();
    await expect(subTabs(window)).toHaveCount(1, { timeout: 10000 });
    await expect(subTab(window, 'love')).toBeVisible();
    await expect(hostTab(window)).toHaveCount(1);
  });

  test('closing the Search tab itself drops every sub-tab', async ({ window }) => {
    await openTwoHosted(window);
    await hostTab(window).locator('[data-testid="close-tab"]').click();
    await expect(hostTab(window)).toHaveCount(0, { timeout: 10000 });
    await expect(subTabs(window)).toHaveCount(0);
  });

  test('with no right-hand pane group the search opens as the full-height column', async ({ window }) => {
    // Reading Mode collapses the study group, so there is no right-hand group to join.
    await window.evaluate(() => (globalThis as unknown as { __services: { registry: { execute(id: string): unknown } } }).__services.registry.execute('layout.applyPreset.reading-mode'));
    await expect(window.getByText(/Show hidden panes/).first()).toBeVisible({ timeout: 10000 });

    await submit(window, 'love');
    await expectResults(window, 'love');

    await expect(tab(window, 'love')).toBeVisible();
    await expect(hostTab(window)).toHaveCount(0);
    await expect(window.locator('[data-testid="search-subtabs"]')).toHaveCount(0);
    const win = window.viewportSize() ?? (await window.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    const box = (await visiblePane(window).boundingBox())!;
    const workbench = (await window.locator('.dv-dockview').first().boundingBox())!;
    expect(box.x + box.width / 2).toBeGreaterThan(win.width / 2);
    expect(box.height).toBeGreaterThan(workbench.height * 0.8);
  });
});

test('search tabs come back after a restart', async () => {
  test.setTimeout(180000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-e2e-search-tabs-'));
  const data = dataEnv(`${userDataDir}-data`);
  const launch = () => electron.launch({
    args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_USER_DATA: userDataDir,
      ...data.env,
      BIBLE_REMOTE_SEMANTIC_URL: 'none',
    },
  });
  const boot = async (app: Awaited<ReturnType<typeof launch>>): Promise<Page> => {
    const w = await app.firstWindow();
    await w.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    await dismissFirstRunDialog(w);
    await waitForAppReady(w);
    await waitForKeywordIndexes(w);
    return w;
  };

  try {
    const app1 = await launch();
    try {
      const w = await boot(app1);
      await openTwo(w);
      // Force the session save the periodic timer would do.
      await w.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
      await w.waitForTimeout(2000);
    } finally {
      await app1.close();
    }

    const app2 = await launch();
    try {
      const w = await boot(app2);
      await expect(searchTabs(w)).toHaveCount(2, { timeout: 20000 });
      await expect(tab(w, 'love')).toBeVisible();
      await expect(tab(w, 'faith')).toBeVisible();
      // Re-run the visible one.
      await submit(w, 'faith');
      await expectResults(w, 'faith');
    } finally {
      await app2.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    data.cleanup();
  }
});

test('right-pane search sub-tabs come back after a restart', async () => {
  test.setTimeout(240000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-e2e-search-host-'));
  const data = dataEnv(`${userDataDir}-data`);
  const launch = () => electron.launch({
    args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_USER_DATA: userDataDir,
      ...data.env,
      BIBLE_REMOTE_SEMANTIC_URL: 'none',
    },
  });
  const boot = async (app: Awaited<ReturnType<typeof launch>>): Promise<Page> => {
    const w = await app.firstWindow();
    await w.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    await dismissFirstRunDialog(w);
    await waitForAppReady(w);
    await waitForKeywordIndexes(w);
    return w;
  };

  try {
    const app1 = await launch();
    try {
      const w = await boot(app1);
      await setPlacement(w, 'tab');
      await openTwoHosted(w);
      // Select the first sub-tab so the saved selection is not just "the last one".
      await subTab(w, 'love').click();
      await expectResults(w, 'love');
      await w.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
      await w.waitForTimeout(2000);
    } finally {
      await app1.close();
    }

    const app2 = await launch();
    try {
      const w = await boot(app2);
      await expect(hostTab(w)).toHaveCount(1, { timeout: 20000 });
      await expect(subTabs(w)).toHaveCount(2, { timeout: 20000 });
      await expect(searchTabs(w)).toHaveCount(0);
      await expect(subTabs(w).nth(0)).toHaveAttribute('aria-label', 'Search: love');
      await expect(subTabs(w).nth(1)).toHaveAttribute('aria-label', 'Search: faith');
      // The one that was selected comes back selected and re-runs.
      await expect(subTab(w, 'love')).toHaveAttribute('aria-selected', 'true');
      await expectResults(w, 'love');
      await subTab(w, 'faith').click();
      await expectResults(w, 'faith');
      await expect(input(w)).toHaveValue('faith');
    } finally {
      await app2.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
    data.cleanup();
  }
});
