/**
 * Updater e2e (task 0234): Check for Updates -> Download & Update, driven in the
 * real Electron app against a local fake update feed, with the REAL
 * electron-updater (no mocks).
 *
 * Guards the 1.0.0-beta.2 bug: the lazily loaded electron-updater had no
 * `autoUpdater` as the built bundle loads it, so "Download & Update" failed with
 * "Cannot set properties of undefined (setting 'autoDownload')" and no unit test
 * (which mocks the module) could see it. This spec fails on that bundle.
 *
 * The fake server plays both feeds: the GitHub-style release list the check
 * reads (BIBLE_UPDATE_MANIFEST_URL) and electron-updater's generic provider
 * (`latest-linux.yml` + an .AppImage), wired in by BIBLE_E2E_UPDATE_FEED_URL,
 * which UpdateInstallService honours only in an unpackaged build. Install /
 * restart is NOT exercised (the app would quit); the spec stops at "downloaded".
 * Linux only: the generic feed file name and installer type are per platform.
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { dismissFirstRunDialog } from '../fixtures/electron.fixture';
import { dataEnv } from '../fixtures/dataDir';
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS_PATH = process.env.E2E_MAIN_JS ?? path.resolve(__dirname, '../../out/main/index.js');
// Above any real version: an unpackaged launch reports Electron's own version (44.x), not package.json's.
const NEW_VERSION = '99.0.0';
const PAYLOAD = crypto.randomBytes(512 * 1024);
const APPIMAGE_NAME = `Bible-${NEW_VERSION}.AppImage`;

interface Feed { url: string; requests: string[]; close(): Promise<void> }

async function startFeed(): Promise<Feed> {
  const requests: string[] = [];
  const sha512 = crypto.createHash('sha512').update(PAYLOAD).digest('base64');
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    requests.push(url);
    if (url.startsWith('/releases')) {
      const body = [{ tag_name: `v${NEW_VERSION}`, name: NEW_VERSION, body: 'Fake release for the updater e2e.', html_url: `http://127.0.0.1/releases/v${NEW_VERSION}`, prerelease: false, draft: false }];
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    } else if (url === '/latest-linux.yml') {
      const yml = `version: ${NEW_VERSION}\nfiles:\n  - url: ${APPIMAGE_NAME}\n    sha512: ${sha512}\n    size: ${PAYLOAD.length}\npath: ${APPIMAGE_NAME}\nsha512: ${sha512}\nreleaseDate: '2026-11-27T00:00:00.000Z'\n`;
      res.writeHead(200, { 'content-type': 'text/yaml' }).end(yml);
    } else if (url === `/${APPIMAGE_NAME}`) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': PAYLOAD.length }).end(PAYLOAD);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test.skip(process.platform !== 'linux', 'fake feed is the Linux AppImage one');

test('Download & Update gets past configure() and downloads from the feed', async ({}, testInfo) => {
  const feed = await startFeed();
  const root = path.join(os.tmpdir(), 'bible-e2e', `updater-${testInfo.workerIndex}`);
  fs.rmSync(root, { recursive: true, force: true });
  const userDataDir = path.join(root, 'user');
  const cacheDir = path.join(root, 'cache'); // electron-updater caches the payload under XDG_CACHE_HOME
  fs.mkdirSync(path.join(userDataDir, 'network'), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  // Offline until the user allows web requests; the feed is a web request.
  fs.writeFileSync(path.join(userDataDir, 'network', 'config.json'), JSON.stringify({ allowNetwork: true }));
  const data = dataEnv(path.join(root, 'data'));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: ['--password-store=basic', '--no-sandbox', '--disable-dev-shm-usage', MAIN_JS_PATH],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_USER_DATA: userDataDir,
        XDG_CACHE_HOME: cacheDir,
        ...data.env,
        BIBLE_REMOTE_SEMANTIC_URL: 'none',
        BIBLE_UPDATE_MANIFEST_URL: `${feed.url}/releases/latest`,
        BIBLE_E2E_UPDATE_FEED_URL: feed.url,
        // An installed AppImage sets this; without it the app reports "package-manager install".
        APPIMAGE: path.join(root, 'Bible.AppImage'),
      },
    });
    const window: Page = await app.firstWindow();
    await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    await dismissFirstRunDialog(window);

    const dialog = window.getByTestId('update-check-dialog');
    await window.evaluate(() => globalThis.dispatchEvent(new CustomEvent('command:app:checkForUpdates')));
    await expect(dialog).toBeVisible();
    await window.getByTestId('update-check-confirm').click();
    await expect(window.getByTestId('update-available')).toBeVisible({ timeout: 15000 });
    await window.screenshot({ path: path.join(testInfo.outputDir, 'update-available.png') });

    await window.getByTestId('update-download-install').click();
    await expect(window.getByTestId('update-downloaded')).toBeVisible({ timeout: 30000 });
    await expect(window.getByTestId('update-download-failed')).toHaveCount(0);
    await expect(dialog).not.toContainText('autoDownload');
    await window.screenshot({ path: path.join(testInfo.outputDir, 'update-downloaded.png') });

    // The payload really came from the feed, through electron-updater.
    expect(feed.requests).toContain('/latest-linux.yml');
    expect(feed.requests).toContain(`/${APPIMAGE_NAME}`);
  } finally {
    await app?.close().catch(() => undefined);
    await feed.close();
    data.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
