/**
 * The Audio Bible, end to end: the real server serving the fixture recording of
 * John 3 (KJV) under /audio, and the built client playing it.
 *
 * Only that one chapter has a recording, and no speech engine is configured, which
 * is the state the app ships in: the specs cover the recorded channel, and the
 * "nothing can play this translation" case with ASV. On-device speech is covered by
 * the unit tests with a fake engine; a real voice is a 60 MB download.
 *
 * The fixture plays half a second per verse, so the highlight is seen moving.
 */
import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_VERSES } from '../audioFixture';
import { desktopOnly, mobileOnly, waitForVerses } from '../helpers';

const NO_AUDIO = 'No recording or speech voice is available for this translation yet.';

async function open(page: Page, hash: string) {
  // A fresh browser context per test: no stored session to restore.
  await page.goto(`/${hash}`);
  await waitForVerses(page);
  // The boot shows a default chapter for a moment before the hash's one: play only once it is John 3.
  await expect(page.locator('.verse').first()).toHaveAttribute('data-verse-id', /^43003\d{3}$/, { timeout: 15000 });
}

const playingVerse = (page: Page) => page.locator('.verse--playing').first();
const verseIdOf = async (page: Page, sel: string) => Number(await page.locator(sel).first().getAttribute('data-verse-id'));

test.describe('Audio Bible: desktop', () => {
  test.beforeEach(async ({}, testInfo) => { desktopOnly(testInfo); });

  test('plays the recording from the selected verse; the highlight follows but the selection does not move', async ({ page }) => {
    await open(page, '#/KJV/43/3/16');
    await expect(page.locator('.verse--study')).toHaveAttribute('data-verse-id', '43003016');
    await expect(page.locator('.audio-transport')).toHaveCount(0);
    const urlBefore = page.url();

    const listen = page.getByTestId('audio-listen');
    await expect(listen).toBeEnabled({ timeout: 15000 });
    await listen.click();

    // The transport bar docks under the toolbar and says what is playing.
    const bar = page.getByTestId('audio-transport');
    await expect(bar).toBeVisible({ timeout: 10000 });
    await expect(bar).toContainText('Recorded · KJV');
    await expect(listen).toHaveAttribute('aria-pressed', 'true');

    // The highlight starts at verse 16 and moves on; the selected verse stays 16.
    await expect(playingVerse(page)).toHaveAttribute('data-verse-id', '43003016', { timeout: 10000 });
    await expect.poll(async () => verseIdOf(page, '.verse--playing'), { timeout: 10000 }).toBeGreaterThan(43003016);
    await expect(page.locator('.verse--study')).toHaveAttribute('data-verse-id', '43003016');
    // Nothing else followed the reading: one selected verse, and the address is unchanged.
    await expect(page.locator('.verse--study')).toHaveCount(1);
    expect(page.url()).toBe(urlBefore);
  });

  test('pause, resume and close from the transport bar', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    const listen = page.getByTestId('audio-listen');
    await expect(listen).toBeEnabled({ timeout: 15000 });
    await listen.click();
    await expect(page.getByTestId('audio-transport')).toBeVisible({ timeout: 10000 });
    await expect(playingVerse(page)).toBeVisible({ timeout: 10000 });

    await page.getByTestId('audio-play-pause').click();
    await expect(page.getByTestId('audio-play-pause')).toHaveAttribute('aria-label', 'Play');
    const pausedAt = await verseIdOf(page, '.verse--playing');
    await page.waitForTimeout(1200); // deliberate: proving that nothing moves while paused
    expect(await verseIdOf(page, '.verse--playing')).toBe(pausedAt);

    await page.getByTestId('audio-play-pause').click();
    await expect.poll(async () => verseIdOf(page, '.verse--playing'), { timeout: 10000 }).toBeGreaterThan(pausedAt);

    await page.getByTestId('audio-close').click();
    await expect(page.getByTestId('audio-transport')).toHaveCount(0);
    await expect(page.locator('.verse--playing')).toHaveCount(0);
  });

  test('the progress slider covers the chapter’s verses and jumps when released', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    await expect(page.getByTestId('audio-listen')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('audio-listen').click();
    const slider = page.getByTestId('audio-progress');
    await expect(slider).toBeVisible({ timeout: 10000 });
    await expect(slider).toHaveAttribute('max', String(FIXTURE_VERSES - 1));
    await slider.focus();
    await page.keyboard.press('End');
    await expect.poll(async () => verseIdOf(page, '.verse--playing'), { timeout: 10000 }).toBeGreaterThanOrEqual(43003030);
  });

  test('Alt+P toggles playback', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    await expect(page.getByTestId('audio-listen')).toBeEnabled({ timeout: 15000 });
    await page.keyboard.press('Alt+p');
    await expect(page.getByTestId('audio-transport')).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Alt+p');
    await expect(page.getByTestId('audio-play-pause')).toHaveAttribute('aria-label', 'Play');
  });

  test('a translation with no recording and no speech engine: Listen is disabled and says why', async ({ page }) => {
    await open(page, '#/ASV/43/3');
    const listen = page.getByTestId('audio-listen');
    await expect(listen).toBeDisabled({ timeout: 15000 });
    await expect(listen).toHaveAttribute('title', NO_AUDIO);
  });

  test('Settings has an Audio tab with the toggles and no voice list (there are no engines)', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    await page.locator('.header__action-btn[title="Settings"]').click();
    await page.locator('.settings-panel__tab', { hasText: 'Audio' }).click();
    await expect(page.locator('[data-section="audio"]')).toBeVisible();
    const follow = page.getByTestId('audio-pref-follow');
    await expect(follow).toBeChecked();
    await follow.uncheck();
    await expect(follow).not.toBeChecked();
    await expect(page.getByTestId('audio-voices')).toHaveCount(0);
    // The choice is remembered across a reload.
    await page.reload();
    await waitForVerses(page);
    await page.locator('.header__action-btn[title="Settings"]').click();
    await page.locator('.settings-panel__tab', { hasText: 'Audio' }).click();
    await expect(page.getByTestId('audio-pref-follow')).not.toBeChecked();
  });
});

test.describe('Audio Bible: phone', () => {
  test.beforeEach(async ({}, testInfo) => { mobileOnly(testInfo); });

  test('Listen opens the full-screen player; closing it leaves a mini-player, and playback continues', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    const listen = page.getByTestId('audio-listen');
    await expect(listen).toBeEnabled({ timeout: 15000 });
    await listen.click();

    const player = page.getByTestId('audio-player-screen');
    await expect(player).toBeVisible({ timeout: 10000 });
    await expect(player).toHaveAttribute('role', 'dialog');
    await expect(player).toContainText('John 3');
    await expect(page.getByTestId('audio-mini')).toHaveCount(0);

    await page.getByTestId('audio-player-close').click();
    await expect(player).toHaveCount(0);
    const mini = page.getByTestId('audio-mini');
    await expect(mini).toBeVisible();
    await expect(mini).toContainText('John 3');
    // The text keeps following the reading behind the mini-player.
    await expect.poll(async () => verseIdOf(page, '.verse--playing'), { timeout: 10000 }).toBeGreaterThan(43003001);

    // Tapping the mini-player text reopens the player; stop closes both.
    await mini.getByRole('button', { name: /open/i }).click();
    await expect(player).toBeVisible();
    await page.getByTestId('audio-player-stop').click();
    await expect(player).toHaveCount(0);
    await expect(mini).toHaveCount(0);
  });

  test('the Android Back button closes the player and leaves playback going', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    await expect(page.getByTestId('audio-listen')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('audio-listen').click();
    await expect(page.getByTestId('audio-player-screen')).toBeVisible({ timeout: 10000 });
    await page.goBack();
    await expect(page.getByTestId('audio-player-screen')).toHaveCount(0);
    await expect(page.getByTestId('audio-mini')).toBeVisible();
  });

  test('the mini-player is there in the other views too', async ({ page }) => {
    await open(page, '#/KJV/43/3/1');
    await expect(page.getByTestId('audio-listen')).toBeEnabled({ timeout: 15000 });
    await page.getByTestId('audio-listen').click();
    await expect(page.getByTestId('audio-player-screen')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('audio-player-close').click();
    await page.locator('.mobile-nav__btn', { hasText: 'Search' }).click();
    await expect(page.getByTestId('audio-mini')).toBeVisible();
  });
});
