import { test, expect, type Page } from '@playwright/test';
import { desktopOnly, navigateTo, waitForVerses } from '../helpers';

/**
 * Session mode: the reading app driving a screen.
 *
 * What has to be proved here is exactly the seam between the two -- that a
 * session started from the reading app's own chrome reaches a viewer opened
 * somewhere else, and that "what I am reading" and "what the room can see"
 * stay apart until the presenter joins them. Both halves run in real browser
 * pages, because the whole point is that they are two devices.
 *
 * On desktop the controls live in the Study pane's Present tab (`PresentTab`,
 * embedding `PresentPanelBody`) rather than the bottom strip mobile keeps;
 * the header's TV button reveals it directly. Most of the selectors below --
 * `.present-bar__*`, `.present-panel__*` -- are unchanged from the strip:
 * they are BEM class names, not descendant selectors, so `PresentTab` reuses
 * them and renders identically wherever it sits in the DOM.
 */

/** Start a session from the header and wait for the Present tab to appear. */
async function startPresenting(page: Page): Promise<string> {
  await page.locator('.header__action-btn .fa-tv').click();
  await expect(page.locator('.present-tab')).toBeVisible({ timeout: 10000 });

  // The tab opens on the join code, which is the first thing a presenter needs.
  const code = page.locator('.present-panel__code');
  await expect(code).toBeVisible();
  return (await code.textContent())!.trim();
}

/** Reveal the Present tab again (e.g. after a reload put the pane back on Study). */
async function openPresentTab(page: Page): Promise<void> {
  await page.locator('.header__action-btn .fa-tv').click();
  await expect(page.locator('.present-tab')).toBeVisible({ timeout: 10000 });
}

test.describe('Presenting from the reading app', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // The tab exists on both layouts, but the preview and the running order
    // are laid out for a desktop; running the whole flow on every phone
    // profile tests the profiles.
    desktopOnly(testInfo);
    await page.goto('/');
    await waitForVerses(page);
  });

  test('starting a session shows a join code and a control strip', async ({ page }) => {
    const joinCode = await startPresenting(page);
    expect(joinCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);

    // Nothing has been sent, and the strip says so rather than implying the
    // screen is already showing what the presenter is reading.
    await expect(page.locator('.present-bar__live-empty')).toBeVisible();
  });

  test('the Present tab carries a live dot visible from another tab', async ({ page }) => {
    await startPresenting(page);
    await page.locator('.right-pane-tabs__tab', { hasText: 'Study' }).click();
    await expect(page.locator('.right-pane-tabs__live-dot')).toBeVisible();
  });

  test('what the presenter reads does not reach the wall until they send it', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);
    await expect(wall.locator('.pv-lobby-code')).toBeVisible();

    // Navigate the reader. This is the preview -- and it must stay private.
    await navigateTo(page, 'John 3');
    await expect(page.locator('.present-bar__send')).toBeEnabled();
    // Still the lobby: a preacher looking ahead has not broadcast anything.
    await expect(wall.locator('.pv-lobby-code')).toBeVisible();

    await page.locator('.present-bar__send').click();
    await expect(wall.locator('.pv-heading')).toHaveText('John 3', { timeout: 10000 });
    // And the strip now agrees the two are the same.
    await expect(page.locator('.present-bar__send--live')).toBeVisible();

    await wall.close();
  });

  test('the viewer count is how a presenter knows the screen is connected', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    await expect(page.locator('.present-bar__viewers')).toHaveText('0');

    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);
    await expect(page.locator('.present-bar__viewers')).toHaveText('1', { timeout: 10000 });

    await wall.close();
    await expect(page.locator('.present-bar__viewers')).toHaveText('0', { timeout: 10000 });
  });

  test('blanking takes the wall and gives it back unchanged', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);

    await navigateTo(page, 'John 3');
    await page.locator('.present-bar__send').click();
    await expect(wall.locator('.pv-verse--anchor')).toBeVisible({ timeout: 10000 });

    await page.locator('.present-bar__btn--blank').click();
    await expect(wall.locator('.pv-curtain')).toHaveCSS('opacity', '1');
    // Underneath, untouched: unblanking has to restore the screen exactly.
    await expect(wall.locator('.pv-verse--anchor')).toHaveCount(1);

    await page.locator('.present-bar__btn--blank').click();
    await expect(wall.locator('.pv-curtain')).toHaveCSS('opacity', '0');

    await wall.close();
  });

  test('the running order survives the controller being reloaded', async ({ page }) => {
    // The plan lives on the session, not in this browser, which is what lets a
    // service be prepared on a desktop and driven from a phone.
    await startPresenting(page);
    await navigateTo(page, 'John 3');

    await page.locator('.present-panel__tab', { hasText: 'Running order' }).click();
    await page.locator('.present-plan__add').click();
    await expect(page.locator('.present-plan__ref')).toHaveText('John 3');

    await page.reload();
    await waitForVerses(page);

    // A reload always lands back on Study -- the Present tab only exists
    // while a session is live, and (like Search) does not try to survive a
    // reload as the *active* tab. The session itself does survive: this is
    // still the same presenter, and the join code before still works.
    await openPresentTab(page);
    await page.locator('.present-panel__tab', { hasText: 'Running order' }).click();
    await expect(page.locator('.present-plan__ref')).toHaveText('John 3');
  });

  test('an entry in the running order sends to the wall', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);

    await navigateTo(page, 'Romans 8');
    await page.locator('.present-panel__tab', { hasText: 'Running order' }).click();
    await page.locator('.present-plan__add').click();

    // Wander off the plan, the way a presenter does.
    await navigateTo(page, 'John 3');
    await page.locator('.present-plan__label').click();

    await expect(wall.locator('.pv-heading')).toHaveText('Romans 8', { timeout: 10000 });
    await wall.close();
  });

  test('a hymn goes on the wall with its credit line', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);

    await page.locator('.present-panel__tab', { hasText: 'Hymns' }).click();
    // By hymnal number, which is how a hymn actually gets called for.
    await page.locator('.present-hymns__search').fill('460');
    await expect(page.locator('.present-hymns__title').first()).toHaveText('Amazing Grace');
    await page.locator('.present-hymns__pick').first().click();

    await expect(wall.locator('.pv-hymn-line').first())
      .toHaveText('Amazing grace! how sweet the sound', { timeout: 10000 });
    // Attribution is rendered from the library's own metadata rather than typed
    // by whoever prepared the service -- which is what keeps the credit right.
    await expect(wall.locator('.pv-hymn-credit')).toContainText('John Newton');
    // Nothing that belongs to a Bible passage leaks onto a hymn slide.
    await expect(wall.locator('.pv-verse')).toHaveCount(0);

    await wall.close();
  });

  test('next advances a hymn by slide and stops at the end', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);

    await page.locator('.present-panel__tab', { hasText: 'Hymns' }).click();
    await page.locator('.present-hymns__search').fill('amazing grace');
    await page.locator('.present-hymns__pick').first().click();
    await expect(wall.locator('.pv-hymn-line').first()).toBeVisible({ timeout: 10000 });

    const firstLine = () => wall.locator('.pv-hymn-line').first().textContent();
    expect(await firstLine()).toContain('Amazing grace!');

    await page.locator('.present-bar__btn .fa-chevron-right').click();
    await expect.poll(firstLine).toContain("'Twas grace");

    // Off the end of the last slide, the wall must simply stay where it is
    // rather than emptying.
    for (let i = 0; i < 8; i++) await page.locator('.present-bar__btn .fa-chevron-right').click();
    await expect(wall.locator('.pv-hymn-line').first()).toBeVisible();

    await wall.close();
  });

  test('a hymn in the running order is named, not numbered', async ({ page }) => {
    // The session carries a hymn id; the strip has to show a title.
    await startPresenting(page);
    await page.locator('.present-panel__tab', { hasText: 'Hymns' }).click();
    await page.locator('.present-hymns__search').fill('my jesus');
    await page.locator('.present-hymns__row').first().locator('.present-plan__icon').click();

    await page.locator('.present-panel__tab', { hasText: 'Running order' }).click();
    await expect(page.locator('.present-plan__ref')).toHaveText('My Jesus, I Love Thee');
  });

  test('ending the session clears the wall and the strip', async ({ page, context }) => {
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);
    await navigateTo(page, 'John 3');
    await page.locator('.present-bar__send').click();
    await expect(wall.locator('.pv-verse--anchor')).toBeVisible({ timeout: 10000 });

    await page.locator('.present-panel__tab', { hasText: 'Joining' }).click();
    await page.locator('.present-panel__button--danger').click();
    await page.locator('.present-panel__button--danger', { hasText: 'End it' }).click();

    await expect(wall.locator('.pv-lobby-hint')).toContainText(/ended/i, { timeout: 10000 });
    await expect(page.locator('.present-tab')).toHaveCount(0);
    // And the reader underneath is exactly as it was.
    await expect(page.locator('.verse').first()).toBeVisible();

    await wall.close();
  });

  test('stopping control leaves the screen alone', async ({ page, context }) => {
    // Closing a laptop lid must not blank a wall mid-service.
    const joinCode = await startPresenting(page);
    const wall = await context.newPage();
    await wall.goto(`/present/v/${joinCode}`);
    await navigateTo(page, 'John 3');
    await page.locator('.present-bar__send').click();
    await expect(wall.locator('.pv-verse--anchor')).toBeVisible({ timeout: 10000 });

    await page.locator('.present-panel__tab', { hasText: 'Joining' }).click();
    await page.locator('.present-panel__button', { hasText: 'Stop controlling' }).click();

    await expect(page.locator('.present-tab')).toHaveCount(0);
    await expect(wall.locator('.pv-verse--anchor')).toBeVisible();

    await wall.close();
  });
});
