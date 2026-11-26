/**
 * Audio passage lists on the desktop app (task 0233), against the real built app (build it with
 * `VITE_KTH_FLAGS=audio`; the main process flag is `KTH_FLAGS=audio`, set here). Same setup as audio.spec.ts: a
 * Range-capable http server stands in for the recordings host and serves real WAV chapters (John 3, John 4, Ps 23),
 * so the audio genuinely runs.
 *
 *   (a) the popup's default list is the current chapter; "Continue to the next chapter" is one pref (popup list and gear),
 *   (b) a typed cross-chapter list shows chips and plays: pages turn, "1 of 2" then "2 of 2", stops at the end verses;
 *       "Loop the list" wraps back to "1 of 2",
 *   (c) invalid input shows the alert and Play stays disabled,
 *   (d) browsing a second pane away during playback: playback carries on in pane 1, pane 2 shows the "elsewhere" strip,
 *       and Go to it brings pane 1 back,
 *   (e) Stop keeps the verse selected; after an app restart (same profile) it is still selected and Listen resumes there.
 */

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { dismissFirstRunDialog } from '../fixtures/electron.fixture';
import { dataEnv } from '../fixtures/dataDir';
import { writeAudioFixture } from '../fixtures/audioFixture';

const MAIN_JS = process.env.E2E_MAIN_JS ?? path.resolve(__dirname, '../../out/main/index.js');

/** Serves `root` over http with Range support (206, and 416 past the end). */
function startRangeServer(root: string): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    const size = fs.statSync(file).size;
    const type = file.endsWith('.json') ? 'application/json' : 'audio/wav';
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (!m) { res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }); if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res); return; }
    const start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

type Seen = { __seenPlaying?: number[] };

/** Records every verse id that gets `.verse--playing` in a Bible pane (not the pop-up's own verse pane), so short-lived highlights are not missed. */
async function watchPlaying(window: Page): Promise<void> {
  await window.evaluate(() => {
    const g = globalThis as unknown as Seen & { __seenObserver?: MutationObserver };
    g.__seenPlaying = [];
    g.__seenObserver?.disconnect();
    const scan = () => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.verse--playing'))) {
        if (el.closest('[data-testid="audio-popup"]')) continue;
        const id = Number(el.dataset.verseId ?? '');
        if (id && g.__seenPlaying![g.__seenPlaying!.length - 1] !== id) g.__seenPlaying!.push(id);
      }
    };
    g.__seenObserver = new MutationObserver(scan);
    g.__seenObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    scan();
  });
}

const seenPlaying = (window: Page) => window.evaluate(() => (globalThis as unknown as Seen).__seenPlaying ?? []);

/** Full verse ids (book*1e6 + chapter*1e3 + verse) currently marked as playing in a Bible pane. */
async function playingIds(window: Page): Promise<number[]> {
  return window.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.verse--playing'))
    .filter((el) => !el.closest('[data-testid="audio-popup"]'))
    .map((el) => Number(el.dataset.verseId ?? '')));
}

/** Verse ids with the selection style in the Bible pane (never the pop-up's verse pane). */
async function selectedIds(window: Page): Promise<number[]> {
  return window.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-verse-id].verse-selected'))
    .filter((el) => !el.closest('[data-testid="audio-popup"]'))
    .map((el) => Number(el.dataset.verseId ?? '')))));
}

interface Rig { app: ElectronApplication; window: Page }

test.describe.serial('Audio passage lists (desktop)', () => {
  test.setTimeout(150_000);

  let scratch = '';
  let server: http.Server | undefined;
  let base = '';
  let cleanupData: () => void = () => undefined;
  let dataEnvVars: Record<string, string | undefined> = {};
  const apps: ElectronApplication[] = [];

  async function launch(profile: string): Promise<Rig> {
    const userDataDir = path.join(scratch, profile);
    // This profile has already agreed to network access (the recordings host is a web request).
    fs.mkdirSync(path.join(userDataDir, 'network'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'network', 'config.json'), JSON.stringify({ allowNetwork: true }));
    const app = await electron.launch({
      args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA: userDataDir,
        ...dataEnvVars,
        BIBLE_REMOTE_SEMANTIC_URL: 'none',
        KTH_FLAGS: 'audio',
        BIBLE_AUDIO_RECORDINGS_BASE: `${base}/audio`,
      },
    });
    apps.push(app);
    const window = await app.firstWindow();
    await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30_000 });
    await window.waitForSelector('.dockview-tab-content', { timeout: 20_000 }).catch(() => undefined);
    await dismissFirstRunDialog(window);
    return { app, window };
  }

  test.beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-audio-passages-e2e-'));
    const recordings = path.join(scratch, 'recordings');
    writeAudioFixture(recordings);
    const started = await startRangeServer(recordings);
    server = started.server;
    base = started.base;
    const data = dataEnv(path.join(scratch, 'data'));
    cleanupData = data.cleanup;
    dataEnvVars = data.env;
  });

  test.afterAll(async () => {
    for (const app of apps) await app.close().catch(() => undefined);
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    cleanupData();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test.describe.serial('one launch: lists, errors, panes', () => {
    let window: Page;

    test.beforeAll(async () => { ({ window } = await launch('profile-lists')); });

    test('(a) the default list is the current chapter, and "continue" is one pref', async () => {
      const listen = window.getByTestId('audio-listen').first();
      await expect(listen).toBeEnabled({ timeout: 30_000 });
      await window.getByTestId('audio-passages-open').first().click();

      const popup = window.getByTestId('audio-popup');
      await expect(popup).toBeVisible({ timeout: 20_000 });
      await expect(window.getByTestId('audio-popup-title')).toBeVisible();
      const input = window.getByTestId('audio-passages-input');
      await expect(input).toHaveValue(/John 3/);
      await expect(window.getByTestId('audio-passage-chip')).toHaveCount(1);
      await expect(window.getByTestId('audio-passages-play')).toBeEnabled();

      // Continue off here...
      const cont = window.getByTestId('audio-continue');
      await expect(cont).toBeChecked(); // the default is to carry on into the next chapter
      await cont.uncheck();
      await expect(cont).not.toBeChecked();

      // ...and the gear's checkbox, once playing, is the very same setting.
      await window.getByTestId('audio-passages-play').click();
      await expect(window.getByTestId('audio-now-playing')).toBeVisible({ timeout: 20_000 });
      await window.getByTestId('audio-gear').click();
      const quick = window.getByTestId('audio-quick-continue');
      await expect(quick).toBeVisible();
      await expect(quick).not.toBeChecked();
      await quick.check();
      await expect(window.getByTestId('audio-continue')).toBeChecked();
      await quick.uncheck();
      await expect(window.getByTestId('audio-continue')).not.toBeChecked();
      await window.keyboard.press('Escape');
      await window.getByTestId('audio-close').click();
      await expect(window.getByTestId('audio-popup')).toHaveCount(0);
    });

    test('(b) a typed cross-chapter list plays: pages turn, 1 of 2 then 2 of 2, stops at the end verses', async () => {
      await window.getByTestId('audio-passages-open').first().click();
      const input = window.getByTestId('audio-passages-input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill('John 3:34-4:2; John 3:1-2');
      await expect(window.getByTestId('audio-passage-chip')).toHaveCount(2);
      await expect(window.getByTestId('audio-passages-error')).toBeHidden();

      await watchPlaying(window);
      await window.getByTestId('audio-passages-play').click();

      const progress = window.getByTestId('audio-passage-progress');
      await expect(progress).toContainText('1 of 2', { timeout: 20_000 });
      // The page turns to John 4 for the end of passage 1.
      await expect.poll(() => seenPlaying(window), { timeout: 20_000 }).toContain(43004002);
      await expect(progress).toContainText('2 of 2', { timeout: 20_000 });
      await expect.poll(() => seenPlaying(window), { timeout: 20_000 }).toContain(43003002);

      // It stops after 3:2 (the last verse of the last passage); nothing outside the two ranges was read.
      await expect(window.getByTestId('audio-popup')).toHaveCount(0, { timeout: 20_000 });
      await expect(window.getByTestId('audio-listen').first()).toHaveAttribute('aria-pressed', 'false');
      const seen = await seenPlaying(window);
      const allowed = new Set([43003034, 43003035, 43003036, 43004001, 43004002, 43003001, 43003002]);
      expect(seen.filter((id) => !allowed.has(id))).toEqual([]);
      expect(seen[seen.length - 1]).toBe(43003002);
      expect(seen).toEqual(expect.arrayContaining([43003034, 43004001, 43004002, 43003001, 43003002]));
    });

    test('(b2) with "Loop the list" on, the list wraps back to 1 of 2', async () => {
      await window.getByTestId('audio-passages-open').first().click();
      const input = window.getByTestId('audio-passages-input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill('John 3:35-36; Psalm 23:1-2');
      await expect(window.getByTestId('audio-passage-chip')).toHaveCount(2);
      const loopList = window.getByTestId('audio-loop-list');
      await loopList.click();
      await expect(loopList).toHaveAttribute('aria-pressed', 'true');

      await window.getByTestId('audio-passages-play').click();
      const progress = window.getByTestId('audio-passage-progress');
      await expect(progress).toContainText('1 of 2', { timeout: 20_000 });
      await expect(progress).toContainText('2 of 2', { timeout: 20_000 });
      await expect(progress).toContainText('1 of 2', { timeout: 20_000 }); // wrapped
      await expect(window.getByTestId('audio-popup')).toBeVisible();

      await window.getByTestId('audio-close').click();
      await expect(window.getByTestId('audio-popup')).toHaveCount(0);
      // Back to play-once for the cases that follow.
      await window.getByTestId('audio-passages-open').first().click();
      await window.getByTestId('audio-loop-once').click();
      await expect(window.getByTestId('audio-loop-once')).toHaveAttribute('aria-pressed', 'true');
      await window.getByTestId('audio-popup-close').click();
      await expect(window.getByTestId('audio-popup')).toHaveCount(0);
    });

    test('(c) invalid input shows the alert and Play is disabled', async () => {
      await window.getByTestId('audio-passages-open').first().click();
      const input = window.getByTestId('audio-passages-input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill('Foo 9');
      const err = window.getByTestId('audio-passages-error');
      await expect(err).toBeVisible();
      await expect(err).toHaveAttribute('role', 'alert');
      await expect(window.getByTestId('audio-passages-play')).toBeDisabled();
      await expect(window.getByTestId('audio-passage-chip')).toHaveCount(0);
      // Fixing the input clears it.
      await input.fill('John 3:1');
      await expect(err).toBeHidden();
      await expect(window.getByTestId('audio-passages-play')).toBeEnabled();
      await window.getByTestId('audio-popup-close').click();
      await expect(window.getByTestId('audio-popup')).toHaveCount(0);
    });

    test('(d) browsing a second pane elsewhere: playback stays in pane 1, pane 2 shows "elsewhere", Go to it returns', async () => {
      // Pane 1 reads John 4 (27 s): long enough to work with.
      await window.getByTestId('audio-passages-open').first().click();
      const input = window.getByTestId('audio-passages-input');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill('John 4');
      await expect(window.getByTestId('audio-passage-chip')).toHaveCount(1);
      await window.getByTestId('audio-passages-play').click();
      await expect(window.getByTestId('audio-now-playing')).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => (await playingIds(window)).length, { timeout: 20_000 }).toBeGreaterThan(0);

      const seenBefore = await playingIds(window);
      // Dock the player to the bar (the "elsewhere" strip belongs to bar style).
      await window.getByTestId('audio-dock').click();
      // The pop-up that the chevron opened stays as a playlist-only card (observed: docking does not close it); close it.
      await expect(window.getByTestId('audio-popup-close')).toBeVisible();
      await window.getByTestId('audio-popup-close').click();
      await expect(window.getByTestId('audio-popup')).toHaveCount(0);
      await expect(window.getByTestId('audio-transport').first()).toBeVisible();

      // A second Bible pane (a new tab), browsed to Genesis 1.
      await window.locator('[data-tour-anchor="add-pane"]').first().click({ force: true });
      const quick = window.locator('input[id^="newtab-query-"]').first();
      await expect(quick).toBeVisible({ timeout: 10_000 });
      await quick.fill('Gen 1');
      await quick.press('Enter');

      const elsewhere = window.getByTestId('audio-elsewhere').first();
      await expect(elsewhere).toBeVisible({ timeout: 20_000 });
      await expect(window.getByTestId('audio-elsewhere-play-pause').first()).toHaveAttribute('aria-label', /pause/i);
      // Still playing in pane 1: the hidden pane shows no highlight, so check the verse reached once we are back.
      const before = Math.max(0, ...seenBefore);
      await window.waitForTimeout(2_500);

      await elsewhere.getByTestId('audio-goto-tab').click();
      await expect(window.getByTestId('audio-elsewhere')).toHaveCount(0, { timeout: 10_000 });
      await expect(window.getByTestId('audio-transport').first()).toBeVisible();
      await expect(window.getByTestId('audio-now-playing').first()).toContainText('John 4');
      // About 2.5 s (5 verses) went by while pane 2 was in front, and playback was not restarted.
      await expect.poll(async () => Math.max(0, ...(await playingIds(window))), { timeout: 10_000 }).toBeGreaterThan(before + 3);

      await window.getByTestId('audio-close').first().click();
      await expect(window.getByTestId('audio-transport')).toHaveCount(0, { timeout: 10_000 });
    });
  });

  test('(e) Stop keeps the verse selected across an app restart, and Listen resumes there', async () => {
    let { app, window } = await launch('profile-resume');
    await expect(window.getByTestId('audio-listen').first()).toBeEnabled({ timeout: 30_000 });
    await window.getByTestId('audio-listen').first().click();
    await expect(window.getByTestId('audio-popup')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => Math.max(0, ...(await playingIds(window))), { timeout: 20_000 }).toBeGreaterThanOrEqual(43003018);
    await window.getByTestId('audio-close').click();
    await expect(window.getByTestId('audio-popup')).toHaveCount(0);

    const stopped = await selectedIds(window);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toBeGreaterThan(43003016);
    expect(stopped[0]).toBeLessThan(43004000);

    // Restart on the same profile and data.
    await app.close();
    ({ app, window } = await launch('profile-resume'));
    const listen = window.getByTestId('audio-listen').first();
    await expect(listen).toBeEnabled({ timeout: 30_000 });
    await expect.poll(() => selectedIds(window), { timeout: 20_000 }).toEqual(stopped);

    await watchPlaying(window);
    await listen.click();
    await expect(window.getByTestId('audio-popup')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => seenPlaying(window), { timeout: 20_000 }).not.toHaveLength(0);
    const seen = await seenPlaying(window);
    expect(seen[0]).toBe(stopped[0]);
  });
});
