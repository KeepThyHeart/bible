/**
 * PWA baseline: install, offline boot, cache rules, update, "Reset app cache"
 * and the server-side kill switch.
 *
 * Chromium only: service-worker behaviour is what is under test, and Playwright's
 * WebKit build cannot run a worker against a plain-HTTP localhost origin.
 *
 * Two servers (see playwright.config.ts): 3101 has `features.pwa` on, 3100 has
 * it off. They are separate origins, so no worker leaks between them.
 */
import { test, expect, type Page } from '@playwright/test';

const PWA_URL = 'http://localhost:3101';
const PLAIN_URL = 'http://localhost:3100';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Service-worker specs run on desktop Chromium only');
});

/** Load the app and wait until a worker controls the page. */
async function bootWithWorker(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('.app');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // clientsClaim() takes control shortly after activation on the first visit.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

const cacheNames = (page: Page) => page.evaluate(() => caches.keys());
const registrationCount = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length));

test.describe('PWA on (features.pwa = true)', () => {
  test.use({ baseURL: PWA_URL });

  test('installs: worker registered, manifest linked and valid, shell precached', async ({ page, request }) => {
    await bootWithWorker(page);

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = await (await request.get(new URL(href!, PWA_URL).href)).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);

    const names = await cacheNames(page);
    expect(names.some(n => n.startsWith('workbox-precache'))).toBe(true);

    const script = await request.get(`${PWA_URL}/sw.js`);
    expect(script.headers()['cache-control']).toBe('no-store');
    expect(await script.text()).not.toContain('KEEP_CACHES');
  });

  test('offline boot: an already-visited app shell loads with no network', async ({ page, context }) => {
    await bootWithWorker(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(page.locator('body')).not.toContainText('no cached copy is available');
    // Still controlled by the same worker, not unregistered because the config fetch failed.
    expect(await registrationCount(page)).toBe(1);
  });

  test('cache rules: declared content is cached, other API routes and /api/sync never are', async ({ page }) => {
    await bootWithWorker(page);
    await page.evaluate(async () => {
      await fetch('/api/commentary/all/43/3?modules=Barnes');
      await fetch('/api/health');
      await fetch('/api/config');
      await fetch('/api/sync');
      await fetch('/api/sync/pull?since=0');
    });

    const cached = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) out.push(`${name} ${new URL(req.url).pathname}`);
      }
      return out;
    });
    expect(cached.some(e => e.startsWith('commentary-text-v1 /api/commentary/all/43/3'))).toBe(true);
    for (const path of ['/api/health', '/api/config', '/api/sync']) {
      expect(cached.filter(e => e.includes(path)), path).toEqual([]);
    }
  });

  test('update: a newly activated worker takes over and the page reloads itself once', async ({ page }) => {
    await bootWithWorker(page);
    // Playwright cannot intercept a worker script's own update fetch, so make the
    // browser see a new worker the other way: register a different script URL for
    // the same scope. It installs, skips waiting and claims the page, exactly as a
    // rebuilt sw.js does, which is the path under test.
    const reloaded = page.waitForEvent('load');
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js?v=next', { scope: '/' }).then(() => undefined));
    await reloaded;
    await page.waitForSelector('.app');
    expect(await registrationCount(page)).toBe(1);
  });

  test('Reset app cache (Settings > About) clears caches, re-registers and reloads', async ({ page }) => {
    await bootWithWorker(page);
    await page.evaluate(async () => {
      await caches.open('stale-thing');
      await caches.open('embedding-model-v1'); // large cache: kept by a normal reset
    });

    await page.locator('.header__action-btn[title="Settings"]').click();
    await page.locator('.settings-panel__tab', { hasText: /about/i }).click();
    const reset = page.locator('[data-testid="reset-app-cache"]');
    await expect(reset).toBeVisible();
    const reloaded = page.waitForEvent('load');
    await reset.click();
    await reloaded;
    await page.waitForSelector('.app');

    const names = await cacheNames(page);
    expect(names).not.toContain('stale-thing');
    expect(names).toContain('embedding-model-v1');
    // The reload boots a fresh worker because the site still has the PWA on.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    expect(await registrationCount(page)).toBe(1);
  });

  test('kill switch: when the server starts handing out sw-kill.js, the worker and its caches go away', async ({ page, request }) => {
    await bootWithWorker(page);
    await page.evaluate(async () => {
      await caches.open('embedding-model-v1');
      await caches.open('stale-thing');
    });

    // Server side, features.pwa off answers /sw.js with this same script (unit-tested,
    // and checked against a real server in the next describe). Playwright cannot
    // intercept the worker script fetch, so install it as the scope's worker directly.
    const killSource = await (await request.get(`${PWA_URL}/sw-kill.js`)).text();
    expect(killSource).toContain('registration.unregister');
    await page.evaluate(() => {
      // This page still has the PWA on, so it would reload and re-register the real
      // worker the moment control changes; spend the one-shot reload guard first so
      // the kill worker's effect is what we observe.
      sessionStorage.setItem('br_nav_update', String(Date.now()));
      return navigator.serviceWorker.register('/sw-kill.js', { scope: '/' }).then(() => undefined);
    });

    await expect.poll(() => registrationCount(page), { timeout: 15000 }).toBe(0);
    const names = await cacheNames(page);
    expect(names).not.toContain('stale-thing');
    expect(names.some(n => n.startsWith('workbox-precache'))).toBe(false);
    expect(names).toContain('embedding-model-v1');
  });
});

test.describe('PWA off (features.pwa = false, the default)', () => {
  test.use({ baseURL: PLAIN_URL });

  test('/sw.js is the kill worker, the manifest is withheld and no worker registers', async ({ page, request }) => {
    const script = await request.get(`${PLAIN_URL}/sw.js`);
    expect(script.headers()['cache-control']).toBe('no-store');
    expect(await script.text()).toContain('registration.unregister');
    expect((await request.get(`${PLAIN_URL}/manifest.webmanifest`)).status()).toBe(404);

    await page.goto('/');
    await page.waitForSelector('.app');
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    expect(await registrationCount(page)).toBe(0);
  });

  test('leftover caches from an earlier PWA visit are cleared on the next boot', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');
    // Simulate what an earlier PWA visit left behind.
    await page.evaluate(async () => {
      await caches.open('stale-thing');
    });
    await page.reload();
    await page.waitForSelector('.app');
    await expect.poll(() => cacheNames(page)).not.toContain('stale-thing');
  });
});
