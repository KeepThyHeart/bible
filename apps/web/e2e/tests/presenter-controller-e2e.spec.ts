import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { desktopOnly, waitForVerses } from '../helpers';

/**
 * The Presenter workspace (`#/@present`): the reading app driving a screen.
 *
 * What has to be proved is the seam between the two halves -- that a session
 * started from the Presenter's own Control pane reaches a viewer opened
 * somewhere else, whichever way the item was sent (command box, transport,
 * notes ▶). Both halves run in real browser pages, because the whole point is
 * that they are two devices.
 *
 * The Presenter is a full page (Notes / Control / Preview) reached by the
 * header's TV button; going live is the Control pane's own button. Below 760px
 * it becomes a different layout (frozen controls, Verse/Hymn/Quote row, a plan
 * list, a pinned command bar), covered by the phone smoke test.
 */

/** Open the Presenter from the app rail. */
async function openPresenter(page: Page): Promise<void> {
  await page.locator('.kth-app-rail [data-app-id="present"]').click();
  await expect(page).toHaveURL(/#\/@present$/);
  await expect(page.locator('.presenter-app')).toBeVisible({ timeout: 10000 });
}

/** Press Go live and return the join code (read from the settings menu). */
async function goLive(page: Page): Promise<string> {
  await page.locator('.pz-status .pz-btn--primary').click();
  await expect(page.locator('.pz-status__state--live')).toBeVisible({ timeout: 10000 });
  await page.locator('.pz-status [data-control-menu-toggle]').click();
  const code = page.locator('.pz-menu .present-panel__code');
  await expect(code).toBeVisible();
  const text = (await code.textContent())!.trim();
  await page.keyboard.press('Escape');
  return text;
}

async function openWall(context: BrowserContext, joinCode: string): Promise<Page> {
  const wall = await context.newPage();
  await wall.goto(`/present/v/${joinCode}`);
  return wall;
}

/** Type into the Control pane's command box and press Enter. */
async function command(page: Page, text: string): Promise<void> {
  const input = page.locator('.pz-control .present-cmd__input');
  await input.fill(text);
  await input.press('Enter');
}

test.describe('The Presenter workspace', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Desktop layout; the phone layout has its own test below.
    desktopOnly(testInfo);
    await page.goto('/');
    await waitForVerses(page);
  });

  test('the header TV button opens the full-page Presenter with three panes', async ({ page }) => {
    await openPresenter(page);
    await expect(page.locator('.pz-notes')).toBeVisible();
    await expect(page.locator('.pz-control')).toBeVisible();
    await expect(page.locator('.pz-preview')).toBeVisible();
    // Nothing is broadcast until "Go live".
    await expect(page.locator('.pz-status__state--live')).toHaveCount(0);
  });

  test('Go live yields a join code, and a joined viewer is counted', async ({ page, context }) => {
    await openPresenter(page);
    const joinCode = await goLive(page);
    expect(joinCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);

    const wall = await openWall(context, joinCode);
    await expect(wall.locator('.pv-lobby-code')).toBeVisible();
    await expect(page.locator('.pz-status__viewers')).toContainText('1', { timeout: 10000 });
    await wall.close();
  });

  test('the command box shows a reference on the wall, and "." blanks it', async ({ page, context }) => {
    await openPresenter(page);
    const wall = await openWall(context, await goLive(page));

    await command(page, 'John 3:16');
    await expect(wall.locator('.pv-heading')).toHaveText('John 3', { timeout: 10000 });
    await expect(wall.locator('.pv-verse--anchor')).toBeVisible();

    await command(page, '.');
    await expect(wall.locator('.pv-curtain')).toHaveCSS('opacity', '1', { timeout: 10000 });
    // Underneath, untouched: unblanking must restore the screen exactly.
    await expect(wall.locator('.pv-verse--anchor')).toHaveCount(1);

    await command(page, '.');
    await expect(wall.locator('.pv-curtain')).toHaveCSS('opacity', '0', { timeout: 10000 });
    await wall.close();
  });

  test('the transport icons blank, unblank and advance', async ({ page, context }) => {
    await openPresenter(page);
    const wall = await openWall(context, await goLive(page));
    await command(page, 'John 3:16');
    await expect(wall.locator('.pv-verse--anchor')).toBeVisible({ timeout: 10000 });

    await page.locator('.pz-transport__btn--blank').click();
    await expect(wall.locator('.pv-curtain')).toHaveCSS('opacity', '1', { timeout: 10000 });
    await page.locator('.pz-transport__btn--blank').click();
    await expect(wall.locator('.pv-curtain')).toHaveCSS('opacity', '0', { timeout: 10000 });

    const anchor = () => wall.locator('.pv-verse--anchor').textContent();
    const before = await anchor();
    await page.locator('.pz-transport__btn .fa-chevron-right').click();
    await expect.poll(anchor, { timeout: 10000 }).not.toBe(before);
    await wall.close();
  });

  test('a ▶ beside a reference in the notes sends it to the wall', async ({ page, context }) => {
    await openPresenter(page);
    const wall = await openWall(context, await goLive(page));

    const editor = page.locator('.pz-notes .ProseMirror');
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await page.keyboard.type('Romans 8:1');

    // Detection runs after a short pause; the ▶ appears once a reference is recognised.
    const play = page.locator('.pz-notes .pn-play').first();
    await expect(play).toBeVisible({ timeout: 10000 });
    await play.click();

    await expect(wall.locator('.pv-heading')).toHaveText('Romans 8', { timeout: 10000 });
    await wall.close();
  });

  test('a hymn from the Hymn picker goes on the wall with its credit line', async ({ page, context }) => {
    await openPresenter(page);
    const wall = await openWall(context, await goLive(page));

    await page.locator('.pz-addrow__btn', { hasText: 'Hymn' }).click();
    await page.locator('.present-hymns__search').fill('460');
    await expect(page.locator('.present-hymns__title').first()).toHaveText('Amazing Grace');
    await page.locator('.present-hymns__pick').first().click();

    await expect(wall.locator('.pv-hymn-line').first())
      .toHaveText('Amazing grace! how sweet the sound', { timeout: 10000 });
    await expect(wall.locator('.pv-hymn-credit')).toContainText('John Newton');
    await expect(wall.locator('.pv-verse')).toHaveCount(0);
    await wall.close();
  });

  test('ending the session tells the wall and returns the Control pane to not-live', async ({ page, context }) => {
    await openPresenter(page);
    const wall = await openWall(context, await goLive(page));

    await page.locator('.pz-status .pz-btn', { hasText: /end/i }).first().click();
    await page.locator('.pz-status__confirm .pz-btn--danger').click();

    await expect(wall.locator('.pv-lobby-hint')).toContainText(/ended/i, { timeout: 10000 });
    await expect(page.locator('.pz-status__state--live')).toHaveCount(0);
    await wall.close();
  });

  test('the back button returns to the reader', async ({ page }) => {
    await openPresenter(page);
    await page.locator('.pz-appbar__back').click();
    // Kept mounted (hidden) for a grace period after leaving, so assert it is not shown.
    await expect(page.locator('.presenter-app')).toBeHidden();
    await waitForVerses(page);
  });
});

test.describe('The Presenter on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the controls, Verse/Hymn/Quote row, plan list and command bar', async ({ page }) => {
    await page.goto('/#/@present');
    await expect(page.locator('.pz-phone')).toBeVisible({ timeout: 10000 });

    // Not the desktop panes, and no rich-text editor at all.
    await expect(page.locator('.pz-notes')).toHaveCount(0);
    await expect(page.locator('.ProseMirror')).toHaveCount(0);

    await expect(page.locator('.pzp-controls .pz-transport')).toBeVisible();
    await expect(page.locator('.pzp-add')).toHaveCount(3);
    await expect(page.locator('.pzp-list')).toBeVisible();
    await expect(page.locator('.pzp-bottom .present-cmd--bar .present-cmd__input')).toBeVisible();
  });
});

test.describe('The simple viewer (/present/solo)', () => {
  test('"/" opens the command prompt and a reference shows on the screen', async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    await page.goto('/present/solo');

    // The always-visible launcher is there before anything is asked of it.
    await expect(page.locator('.pv-solo-launch')).toBeVisible({ timeout: 10000 });

    await page.keyboard.press('/');
    const input = page.locator('.pv-solo-cmd .present-cmd__input');
    await expect(input).toBeVisible();
    await input.fill('John 3:16');
    await input.press('Enter');

    await expect(page.locator('.pv-heading')).toHaveText('John 3', { timeout: 10000 });
    await expect(page.locator('.pv-verse--anchor')).toBeVisible();
  });
});
