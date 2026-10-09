import { test, expect } from '@playwright/test';
import { desktopOnly } from '../helpers';

/**
 * Bible games, end to end on the real server and the real built bundle (task 0115).
 *
 * The host screen is a lazy app inside the reader (`#/@games`); a phone joins
 * through `/games/play`, a second HTML entry that must not load the reader. Both
 * are build/routing properties, so only the built bundle can show a regression:
 * a page that answers 200 with the wrong shell looks fine to a status check.
 */

test.describe('Games', () => {
  test.beforeEach(async ({}, testInfo) => {
    desktopOnly(testInfo);
  });

  test('the API is mounted under /api/games and the old paths are gone', async ({ request }) => {
    const catalog = await request.get('/api/games/catalog');
    expect(catalog.status()).toBe(200);
    const body = (await catalog.json()) as { games: { id: string }[]; translations: string[] };
    expect(body.games.length).toBeGreaterThanOrEqual(9);
    expect(body.translations).toContain('KJV');
    // The old unprefixed path is gone: it is a 404 (API 404s are JSON, so check the status, not the type).
    expect((await request.get('/api/catalog')).status()).toBe(404);
  });

  test('serves the phone page, not the reading app, and loads no reader requests', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (req) => requests.push(new URL(req.url()).pathname));
    await page.goto('/games/play');

    await expect(page.getByRole('button', { name: /join room/i })).toBeVisible();
    await expect(page.locator('#app .app')).toHaveCount(0);
    // No reader boot traffic: no client config, no Bible text, no reader chunks for stores or apps.
    expect(requests.filter((p) => p.startsWith('/api/') && !p.startsWith('/api/games/'))).toEqual([]);
  });

  test('a host opens a room in the app and a phone joins it', async ({ page, browser }) => {
    await page.goto('/#/@games');
    await page.getByRole('button', { name: /host a room/i }).click();

    const code = (await page.locator('.big-code').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4,8}$/);

    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await phoneContext.newPage();
    await phone.goto(`/games/play?room=${code}`);
    await phone.getByLabel(/your name/i).fill('Ruth');
    await phone.getByRole('button', { name: /join room/i }).click();

    // The host's roster shows the phone, and the phone shows it is in the lobby.
    await expect(page.getByText('Ruth').first()).toBeVisible({ timeout: 10000 });
    await expect(phone.getByText(code).first()).toBeVisible({ timeout: 10000 });
    await phoneContext.close();
  });
});
