/**
 * Online meaning search (task 0190): `search.mode: remote`, first-use consent.
 *
 * Starts its own web server per `via` setting (the shared servers run with the
 * default config) next to a local bibsearch stub, so no live service is needed.
 * Chrome desktop only; the consent logic does not depend on the layout.
 */
import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prepareE2eData } from '../prepareData';
import { E2E_PORT } from '../ports';
// @ts-expect-error plain .mjs helper with no type declarations
import { startBibsearchStub } from '../../../../scripts/bibsearch-stub.mjs';

const packageRoot = resolve(import.meta.dirname, '..', '..');
const QUERY = 'forgive someone who wronged me';

interface Stub {
  url: string;
  close(): Promise<void>;
}
interface StubRequest { path: string; query: Record<string, string>; headers: Record<string, string | undefined> }

async function stubRequests(stubUrl: string): Promise<StubRequest[]> {
  const res = await fetch(`${stubUrl}/__requests`);
  return (await res.json()) as StubRequest[];
}
async function searchRequests(stubUrl: string): Promise<StubRequest[]> {
  return (await stubRequests(stubUrl)).filter((r) => r.path === '/v1/search');
}

async function startServer(via: 'server' | 'browser', port: number, stubUrl: string): Promise<{ proc: ChildProcess; dir: string; url: string }> {
  const { dataDir, modulesDir } = prepareE2eData();
  // A data dir of our own: the registry and audio fixture are linked, the site config is ours.
  const dir = join(dataDir, `remote-${via}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dataDir)) {
    if (name === 'site-config.json' || name.startsWith('state-') || name.startsWith('remote-')) continue;
    if (name.startsWith('main.db')) continue; // copied below: SQLite writes -wal/-shm beside it
    symlinkSync(join(dataDir, name), join(dir, name));
  }
  writeFileSync(join(dir, 'main.db'), readFileSync(join(dataDir, 'main.db')));
  const base = JSON.parse(readFileSync(join(packageRoot, 'e2e', 'fixtures', 'site-config.json'), 'utf-8'));
  base.features = { ...base.features, semanticSearch: true };
  base.search = { mode: 'remote', remote: { url: stubUrl, via } };
  writeFileSync(join(dir, 'site-config.json'), JSON.stringify(base, null, 2));

  const proc = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NO_AUTH: '1',
      DISABLE_RATE_LIMIT: '1',
      FEATURE_PWA: '0',
      BIBLE_DATA_DIR: dir,
      BIBLE_MODULES_DIR: modulesDir,
      BIBLE_APP_STATE_DIR: join(dir, 'state'),
    },
    stdio: 'ignore',
  });
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('remote-semantic e2e server did not start');
    await new Promise((r) => setTimeout(r, 500));
  }
  return { proc, dir, url };
}

async function ideasSearch(page: Page, query: string): Promise<void> {
  await page.locator('.header__search-type-btn').click();
  await page.locator('[data-search-type="semantic"]').dispatchEvent('mousedown');
  const input = page.locator('.header__search-field');
  await input.fill(query);
  await input.press('Enter');
}

for (const [via, portOffset] of [['server', 20], ['browser', 21]] as const) {
  test.describe(`remote semantic search, via ${via}`, () => {
    test.describe.configure({ mode: 'serial', timeout: 120_000 });

    let stub: Stub;
    let server: { proc: ChildProcess; dir: string; url: string };

    test.beforeAll(async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop Chrome only');
      testInfo.setTimeout(300_000);
      stub = await startBibsearchStub({ port: 0 });
      server = await startServer(via, E2E_PORT + portOffset, stub.url);
    });

    test.afterAll(async () => {
      server?.proc.kill('SIGTERM');
      await stub?.close();
      if (server) rmSync(server.dir, { recursive: true, force: true });
    });

    test.beforeEach(async ({ page }) => {
      await fetch(`${stub.url}/__requests`, { method: 'DELETE' });
      await page.goto(server.url);
      await page.waitForSelector('.app');
    });

    test('asks first, sends nothing before Agree, then searches and remembers', async ({ page }) => {
      await ideasSearch(page, QUERY);
      await expect(page.getByTestId('remote-consent-dialog')).toBeVisible();
      expect(await stubRequests(stub.url)).toEqual([]);

      await page.getByTestId('remote-consent-agree').click();
      await expect(page.locator('.search-result-item').first()).toBeVisible({ timeout: 20_000 });

      const reqs = await searchRequests(stub.url);
      expect(reqs.length).toBeGreaterThan(0);
      for (const r of reqs) {
        expect(r.query.include_text).toBe('false');
        expect(r.headers.cookie).toBeUndefined();
        expect(r.headers.authorization).toBeUndefined();
      }

      // Consent survives a reload: no dialog on the next Ideas search.
      await page.reload();
      await page.waitForSelector('.app');
      await ideasSearch(page, 'comfort when anxious');
      await expect(page.getByTestId('remote-consent-dialog')).toHaveCount(0);
      await expect(page.locator('.search-result-item').first()).toBeVisible({ timeout: 20_000 });

      // A facet row (suffixed id, mapped through passage/start/end) shows as a normal result.
      await ideasSearch(page, 'creation in the beginning');
      await expect(page.locator('.search-result-item').first()).toContainText('Genesis 1:1', { timeout: 20_000 });
    });

    test('Not now falls back to keyword with the hint and never asks or sends again', async ({ page }) => {
      await ideasSearch(page, QUERY);
      await page.getByTestId('remote-consent-decline').click();
      await expect(page.getByTestId('semantic-note')).toBeVisible({ timeout: 20_000 });

      await ideasSearch(page, 'comfort when anxious');
      await expect(page.getByTestId('remote-consent-dialog')).toHaveCount(0);
      await expect(page.getByTestId('semantic-note')).toBeVisible();
      expect(await stubRequests(stub.url)).toEqual([]);
    });
  });
}
