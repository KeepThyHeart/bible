/**
 * Audio Bible on the desktop app (task 0223), against the real built app (build it with
 * `VITE_KTH_FLAGS=audio`; the main process flag is `KTH_FLAGS=audio`, set here).
 *
 * A tiny Range-capable http server stands in for the recordings host (`BIBLE_AUDIO_RECORDINGS_BASE`) and serves the
 * John 3 fixture. One app launch runs the cases in order, because the download in (c) is what (d) plays offline:
 *   (a) Listen on John 3 plays the recording and the position advances,
 *   (b) the follow highlight (`.verse--playing`) moves forward,
 *   (c) Preferences > Audio > Downloads fetches John into `<data dir>/audio-downloads/v1/KJV/fixture/r1/43/003.wav`,
 *   (d) with the server stopped and web requests switched off, John 3 still plays, and a seek lands past verse 18.
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

/** Verse numbers (the trailing digits of data-verse-id are the verse) currently marked as playing in the Bible pane. */
async function playingVerses(window: Page): Promise<number[]> {
  return window.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.verse--playing'))
    .filter((el) => !el.closest('[data-testid="audio-popup"]')) // the pop-up has its own verse pane
    .map((el) => Number(el.dataset.verseId ?? '') % 1000));
}

const highestPlaying = async (window: Page) => Math.max(0, ...(await playingVerses(window)));

test.describe.serial('Audio Bible (desktop)', () => {
  test.setTimeout(120_000);

  let scratch = '';
  let userDataDir = '';
  let dataDir = '';
  let server: http.Server | undefined;
  let app: ElectronApplication;
  let window: Page;
  let cleanupData: () => void = () => undefined;

  test.beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-audio-e2e-'));
    userDataDir = path.join(scratch, 'profile');
    const recordings = path.join(scratch, 'recordings');
    writeAudioFixture(recordings);
    const started = await startRangeServer(recordings);
    server = started.server;

    // This profile has already agreed to network access (the recordings host is a web request).
    fs.mkdirSync(path.join(userDataDir, 'network'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'network', 'config.json'), JSON.stringify({ allowNetwork: true }));
    const data = dataEnv(path.join(scratch, 'data'));
    cleanupData = data.cleanup;
    dataDir = data.env.BIBLE_DESKTOP_DATA_DIR ?? '';

    app = await electron.launch({
      args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA: userDataDir,
        ...data.env,
        BIBLE_REMOTE_SEMANTIC_URL: 'none',
        KTH_FLAGS: 'audio',
        BIBLE_AUDIO_RECORDINGS_BASE: `${started.base}/audio`,
      },
    });
    window = await app.firstWindow();
    await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30_000 });
    await window.waitForSelector('.dockview-tab-content', { timeout: 20_000 }).catch(() => undefined);
    await dismissFirstRunDialog(window);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    cleanupData();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test('(a) Listen on John 3 plays the recording and the position advances', async () => {
    const listen = window.getByTestId('audio-listen').first();
    await expect(listen).toBeEnabled({ timeout: 30_000 });
    await listen.click();

    await expect(window.getByTestId('audio-popup')).toBeVisible({ timeout: 20_000 });
    await expect(window.getByTestId('audio-speaker-badge')).toBeVisible();
    await expect(listen).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });

    const progress = window.getByTestId('audio-progress');
    const before = Number(await progress.inputValue());
    await expect.poll(async () => Number(await progress.inputValue()), { timeout: 15_000 }).toBeGreaterThan(before);
  });

  test('(b) the follow highlight moves forward', async () => {
    await expect.poll(() => highestPlaying(window), { timeout: 15_000 }).toBeGreaterThan(0);
    const first = await highestPlaying(window);
    await expect.poll(() => highestPlaying(window), { timeout: 15_000 }).toBeGreaterThan(first);
    // One verse at a time.
    expect(new Set(await playingVerses(window)).size).toBe(1); // the row and its text both carry the class
  });

  test('(c) Preferences > Audio downloads John into the data dir', async () => {
    await window.getByTestId('audio-close').click();
    await expect(window.getByTestId('audio-popup')).toHaveCount(0);

    await window.evaluate(() => (globalThis as unknown as { __services: { registry: { execute(id: string): unknown } } }).__services.registry.execute('app.openPreferences'));
    await window.locator('#preferences-tab-audio').click();
    const downloads = window.getByTestId('audio-downloads');
    await expect(downloads).toBeVisible({ timeout: 20_000 });
    await expect(window.getByTestId('audio-dl-translation')).toHaveValue('KJV', { timeout: 20_000 });

    const john = window.getByTestId('audio-dl-book-43');
    await expect(john).toBeVisible();
    await john.locator('input[type="checkbox"]').check();
    await window.getByTestId('audio-dl-start').click();
    await expect(john).toContainText(/downloaded/i, { timeout: 60_000 });

    const wav = path.join(dataDir, 'audio-downloads', 'v1', 'KJV', 'fixture', 'r1', '43', '003.wav');
    expect(fs.existsSync(wav)).toBe(true);
    expect(fs.statSync(wav).size).toBeGreaterThan(1000);
  });

  test('(d) offline, John 3 plays from disk and a seek lands past verse 18', async () => {
    // Recordings host gone, and the app's own switch off: only the download can answer.
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await window.locator('#preferences-tab-privacy').click();
    const allow = window.getByTestId('privacy-allow-web-requests-checkbox');
    await allow.uncheck();
    await expect(allow).not.toBeChecked();
    await window.keyboard.press('Escape');
    await expect(window.locator('#preferences-tab-privacy')).toHaveCount(0);

    const listen = window.getByTestId('audio-listen').first();
    await expect(listen).toBeEnabled({ timeout: 20_000 });
    await listen.click();
    await expect(window.getByTestId('audio-popup')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => highestPlaying(window), { timeout: 20_000 }).toBeGreaterThan(0);

    // Play starts at the selected verse (16). Go back to the first verse (Home on the range), then click the middle
    // of it: that lands on verse 18 or 19, and playing carries on from there.
    await window.getByTestId('audio-progress').focus();
    await window.keyboard.press('Home');
    await expect.poll(() => highestPlaying(window), { timeout: 5_000 }).toBeLessThan(5);
    const box = (await window.getByTestId('audio-progress').boundingBox())!;
    await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => highestPlaying(window), { timeout: 3_000 }).toBeGreaterThanOrEqual(17); // 3 s is too soon to get there by playing on (half a second per verse)
    const seeked = await highestPlaying(window);
    await expect.poll(() => highestPlaying(window), { timeout: 15_000 }).toBeGreaterThan(seeked);
  });
});
