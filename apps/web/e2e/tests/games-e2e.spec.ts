import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
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

    await expect(page.getByRole('button', { name: /^join/i })).toBeVisible();
    await expect(page.locator('#app .app')).toHaveCount(0);
    // No reader boot traffic: no client config, no Bible text, no reader chunks for stores or apps.
    expect(requests.filter((p) => p.startsWith('/api/') && !p.startsWith('/api/games/'))).toEqual([]);
  });

  test('the reader opens the organizer setup, with every game on a card', async ({ page }) => {
    await page.goto('/#/@games');
    await page.locator('.home-host').click();
    await expect(page.locator('.org-card').first()).toBeVisible();
    expect(await page.locator('.org-card').count()).toBeGreaterThanOrEqual(9);
  });
});

/**
 * The same game seen from every device the redesign has: the organizer's
 * remote, a display opened by game code, players, and an organizer who is the
 * screen or a player. Fill in the blank throughout: its answer is a single word.
 */
test.describe('Games, a group evening', () => {
  test.beforeEach(async ({}, testInfo) => {
    desktopOnly(testInfo);
  });

  const PHONE = { viewport: { width: 390, height: 844 } };
  const WORD = (answer: string) => new RegExp(`(^|[^\\p{L}])${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu');

  /** Home, "Run a game for a group", fill in the blank, Short. Leaves the options page ready to open. */
  async function chooseFillInTheBlank(page: Page): Promise<void> {
    await page.goto('/#/@games');
    await page.locator('.home-host').click();
    await page.getByRole('button', { name: /fill in the blank/i }).click();
    await page.getByRole('button', { name: /^short/i }).click();
  }

  /** Opens the room and reads the code off the screen step. */
  async function openGame(page: Page): Promise<string> {
    await page.locator('form button[type="submit"]').click();
    const code = (await page.locator('.org-code').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4,8}$/);
    return code;
  }

  async function join(browser: Browser, code: string, name: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.goto(`/games/play?room=${code}`);
    await page.getByLabel(/your name/i).fill(name);
    await page.getByRole('button', { name: /^join/i }).click();
    await expect(page.getByText(code).first()).toBeVisible({ timeout: 10000 });
    return { context, page };
  }

  async function answer(player: Page, word: string): Promise<void> {
    await player.locator('.fitb-input').fill(word);
    await player.locator('.fitb-submit').click();
  }

  /** The visible text of a page, without the verse: the verse can repeat the answer word legitimately. */
  function textOutsideVerse(page: Page): Promise<string> {
    return page.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('.fitb-verse').forEach((node) => node.remove());
      return copy.textContent ?? '';
    });
  }

  test('an organizer phone runs a game on a TV for two players, then plays again', async ({ page: organizer, browser }) => {
    await organizer.setViewportSize(PHONE.viewport);
    await chooseFillInTheBlank(organizer);
    const code = await openGame(organizer);

    // The TV is opened by the code alone.
    const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const tv = await tvContext.newPage();
    await tv.goto('/games/tv');
    await tv.locator('.tv-code-input').fill(code);
    await tv.locator('button[type="submit"]').click();
    await expect(tv.getByText(code).first()).toBeVisible({ timeout: 10000 });

    await organizer.getByRole('button', { name: /^continue/i }).click();
    await expect(organizer.locator('.org-lobby-head')).toBeVisible();

    const ruth = await join(browser, code, 'Ruth');
    const naomi = await join(browser, code, 'Naomi');
    await expect(tv.locator('.name-chip')).toHaveCount(2, { timeout: 10000 });

    // The remote starts the game; the TV explains it first.
    await organizer.locator('.btn-primary').filter({ hasText: /start/i }).click();
    await expect(tv.locator('.how-to-play')).toBeVisible({ timeout: 10000 });
    await organizer.locator('.organizer-main').click();

    // The remote alone shows the answer. Nothing else the room can see has it.
    const card = organizer.locator('.organizer-private-answer');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(organizer.locator('.organizer-private')).toContainText(/only you/i);
    const expected = ((await card.innerText()).split(':').pop() ?? '').trim();
    expect(expected.length).toBeGreaterThan(0);

    await expect(tv.locator('.fitb-blank')).toBeVisible();
    await expect(tv.locator('.fitb-blank')).not.toContainText(WORD(expected));
    expect(await textOutsideVerse(tv)).not.toMatch(WORD(expected));
    await expect(tv.locator('.organizer-private, .organizer-bar')).toHaveCount(0);
    expect(await textOutsideVerse(ruth.page)).not.toMatch(WORD(expected));

    await expect(ruth.page.locator('.fitb-input')).toBeVisible({ timeout: 10000 });
    await answer(ruth.page, expected);
    await answer(naomi.page, 'nothing');
    // Showing the answer is a remote button, and only then does the TV have the word.
    await organizer.locator('.organizer-main').click();
    await expect(tv.locator('.fitb-reveal')).toBeVisible({ timeout: 10000 });
    await expect(tv.locator('.fitb-word')).toContainText(WORD(expected));

    // The rest of the game is Next question until the results.
    await organizer.locator('.organizer-main').click();
    for (let round = 1; round < 5; round += 1) {
      await expect(tv.locator('.fitb-reveal')).toBeHidden({ timeout: 10000 });
      await expect(card).toBeVisible({ timeout: 10000 });
      await organizer.locator('.organizer-main').click();
      await expect(tv.locator('.fitb-reveal')).toBeVisible({ timeout: 10000 });
      await organizer.locator('.organizer-main').click();
    }
    await expect(organizer.locator('.organizer-summary')).toBeVisible({ timeout: 10000 });
    await expect(tv.locator('.podium-screen')).toBeVisible();

    // Play again keeps the room, its players and its settings.
    const summary = organizer.locator('.organizer-summary');
    await expect(summary.locator('.btn-primary')).toHaveText(/keep going/i);
    await summary.getByRole('button', { name: /play again/i }).click();
    await expect(tv.locator('.how-to-play')).toBeVisible({ timeout: 10000 });
    await expect(tv.locator('.podium-screen')).toHaveCount(0);

    await Promise.all([ruth.context.close(), naomi.context.close(), tvContext.close()]);
  });

  test('a laptop is the screen and the organizer, driven from the keyboard', async ({ page: laptop, browser }) => {
    await chooseFillInTheBlank(laptop);
    const code = await openGame(laptop);
    await laptop.getByRole('button', { name: /use this device/i }).click();
    await expect(laptop.locator('.org-code')).toBeHidden();
    await expect(laptop.getByText(code).first()).toBeVisible({ timeout: 10000 });

    const ruth = await join(browser, code, 'Ruth');
    await expect(laptop.locator('.name-chip')).toHaveCount(1, { timeout: 10000 });

    // The bar comes up with the mouse; Space does the next step without it.
    await laptop.mouse.move(200, 200);
    await laptop.mouse.move(260, 240);
    await expect(laptop.getByRole('toolbar')).toBeVisible();
    await laptop.locator('body').click({ position: { x: 5, y: 5 } });

    await laptop.keyboard.press('Space');
    await expect(laptop.locator('.how-to-play')).toBeVisible({ timeout: 10000 });
    await laptop.keyboard.press('Space');
    await expect(laptop.locator('.fitb-blank')).toBeVisible({ timeout: 10000 });
    // The projector computer never draws an answer card of any kind.
    await expect(laptop.locator('.organizer-private')).toHaveCount(0);

    await expect(ruth.page.locator('.fitb-input')).toBeVisible({ timeout: 10000 });
    await answer(ruth.page, 'anything');
    // P pauses and P resumes; the bar names whichever is next.
    await laptop.keyboard.press('p');
    await expect(laptop.getByRole('toolbar').getByRole('button', { name: /resume/i }).first()).toBeVisible();
    await laptop.keyboard.press('p');
    await expect(laptop.getByRole('toolbar').getByRole('button', { name: /pause/i }).first()).toBeVisible();

    for (let round = 0; round < 5; round += 1) {
      await laptop.keyboard.press('Space');
      await expect(laptop.locator('.fitb-reveal')).toBeVisible({ timeout: 10000 });
      await laptop.keyboard.press('Space');
      if (round < 4) await expect(laptop.locator('.fitb-reveal')).toBeHidden({ timeout: 10000 });
    }
    await expect(laptop.locator('.podium-screen')).toBeVisible({ timeout: 10000 });
    await ruth.context.close();
  });

  test('an organizer who plays has the player view and the controls, and is never shown the answer', async ({ page: phone, browser }) => {
    await phone.setViewportSize(PHONE.viewport);
    await chooseFillInTheBlank(phone);
    await phone.getByLabel(/playing too/i).check();
    await phone.locator('input[name="display-name"]').fill('Debbie');
    const code = await openGame(phone);
    await phone.getByRole('button', { name: /no big screen/i }).click();
    await expect(phone.locator('.org-code')).toBeHidden();

    const ruth = await join(browser, code, 'Ruth');
    // The organizer is a player with the organizer's controls above.
    await expect(phone.locator('.btn-primary').filter({ hasText: /start/i })).toBeVisible({ timeout: 10000 });
    await phone.locator('.btn-primary').filter({ hasText: /start/i }).click();
    await phone.locator('.organizer-main').click();

    await expect(phone.locator('.fitb-input')).toBeVisible({ timeout: 10000 });
    await expect(phone.locator('.organizer-main')).toBeVisible();
    await expect(phone.locator('.organizer-private')).toHaveCount(0);
    const beforeReveal = await textOutsideVerse(phone);
    await answer(phone, 'nothing');
    await answer(ruth.page, 'nothing');

    await phone.locator('.organizer-main').click();
    const word = phone.locator('.fitb-word, .fitb-answer').first();
    await expect(word).toBeVisible({ timeout: 10000 });
    const expected = (await word.innerText()).trim();
    // The word the reveal shows was nowhere on this phone before it.
    expect(beforeReveal).not.toMatch(WORD(expected));
    await expect(phone.locator('.organizer-private')).toHaveCount(0);

    await ruth.context.close();
  });
});
