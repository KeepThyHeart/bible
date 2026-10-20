/**
 * Online meaning search E2E (task 0190): first-use consent, the stub service,
 * Not now, and the Preferences > Search toggle.
 *
 * NOT RUN by the writer. The shared fixture launches Electron without extra
 * env, so this spec launches its own instance with BIBLE_REMOTE_SEMANTIC_URL
 * pointing at the local bibsearch stub (scripts/bibsearch-stub.mjs). The worker
 * adapts the launch to the fixture if it grows an env option.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS_PATH = path.resolve(__dirname, '../../out/main/index.js');
const STUB_PATH = path.resolve(__dirname, '../../../../scripts/bibsearch-stub.mjs');

interface StubRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body?: { include_text?: unknown };
}
interface Stub {
  url: string;
  requests: StubRequest[];
  clearRequests(): void;
  setMode(mode: string): void;
  close(): Promise<void> | void;
}

const test = base.extend<{ stub: Stub; app: ElectronApplication; window: Page }>({
  stub: async ({}, use) => {
    const mod = (await import(pathToFileURL(STUB_PATH).href)) as { startBibsearchStub(o?: { port?: number }): Promise<Stub> };
    const stub = await mod.startBibsearchStub({ port: 0 });
    await use(stub);
    await stub.close();
  },
  app: async ({ stub }, use, testInfo) => {
    const userDataDir = path.join(os.tmpdir(), 'bible-e2e', `remote-semantic-${testInfo.workerIndex}`);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    const app = await electron.launch({
      args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS_PATH],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA: userDataDir,
        BIBLE_REMOTE_SEMANTIC_URL: stub.url,
      },
    });
    await use(app);
    await app.close();
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    // First-run language dialog is modal; dismiss it as the shared fixture does.
    const dialog = window.locator('[data-testid="first-run-language-dialog"]');
    if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dialog.getByRole('button').last().click({ force: true });
      await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
    }
    await use(window);
  },
});

/** Keyword search from the global box, then switch the results to meaning search. */
async function runSemanticSearch(window: Page, query: string): Promise<void> {
  const input = window.locator('[data-testid="search-input"]');
  await input.fill(query);
  await input.press('Enter');
  const toggle = window.getByRole('button', { name: /semantic/i }).first();
  await expect(toggle).toBeVisible({ timeout: 20000 });
  await toggle.click({ force: true });
}

async function openSearchPreferences(window: Page): Promise<void> {
  await window.evaluate(() => (globalThis as unknown as { __services: { registry: { execute(id: string): unknown } } }).__services.registry.execute('app.openPreferences'));
  await window.locator('#preferences-tab-search').click();
}

const searchCalls = (stub: Stub) => stub.requests.filter((r) => r.path === '/v1/search');

test.describe('Online meaning search', () => {
  test('asks before the first search and sends nothing until Agree', async ({ window, stub }) => {
    await runSemanticSearch(window, 'love');
    await expect(window.getByTestId('remote-consent-dialog')).toBeVisible({ timeout: 15000 });
    expect(stub.requests).toHaveLength(0);

    await window.getByTestId('remote-consent-agree').click();
    await expect(window.locator('[data-testid="semantic-result"]').first()).toBeVisible({ timeout: 30000 });

    const calls = searchCalls(stub);
    expect(calls.length).toBeGreaterThan(0);
    const first = calls[0];
    const includeText = first.query.include_text ?? first.body?.include_text;
    expect(String(includeText)).toBe('false');
    expect(first.headers.authorization).toBeUndefined();
  });

  test('Not now shows the hint and later semantic searches send nothing', async ({ window, stub }) => {
    await runSemanticSearch(window, 'love');
    await window.getByTestId('remote-consent-decline').click();
    await expect(window.getByTestId('semantic-note')).toContainText('Preferences > Search', { timeout: 15000 });

    // Search again: no modal, no remote call.
    const input = window.locator('[data-testid="search-input"]');
    await input.fill('mercy');
    await input.press('Enter');
    await expect(window.getByTestId('remote-consent-dialog')).toHaveCount(0);
    expect(stub.requests).toHaveLength(0);
  });

  test('Preferences toggle shows the state and withdrawing stops calls', async ({ window, stub }) => {
    await openSearchPreferences(window);
    await expect(window.getByTestId('remote-semantic-toggle')).toBeChecked();
    await expect(window.getByTestId('remote-semantic-status')).toContainText('Not active until you agree');
    await window.keyboard.press('Escape');

    await runSemanticSearch(window, 'love');
    await window.getByTestId('remote-consent-agree').click();
    await expect(window.locator('[data-testid="semantic-result"]').first()).toBeVisible({ timeout: 30000 });

    await openSearchPreferences(window);
    await expect(window.getByTestId('remote-semantic-status')).toContainText('On. You agreed on');
    await window.getByTestId('remote-semantic-toggle').click();
    await expect(window.getByTestId('remote-semantic-status')).toHaveText('Off');
    await expect(window.getByTestId('remote-semantic-toggle')).not.toBeChecked();
    await window.keyboard.press('Escape');

    stub.clearRequests();
    const input = window.locator('[data-testid="search-input"]');
    await input.fill('grace');
    await input.press('Enter');
    await window.waitForTimeout(1500);
    expect(stub.requests).toHaveLength(0);
  });
});
