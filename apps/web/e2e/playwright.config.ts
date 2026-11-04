import { defineConfig, devices } from '@playwright/test';
import { rmSync } from 'fs';
import { join, resolve } from 'path';
import { prepareE2eData } from './prepareData';
import { E2E_PORT, E2E_PWA_PORT, PLAIN_URL, PWA_URL } from './ports';

const packageRoot = resolve(import.meta.dirname, '..');
const SERVER_COMMAND = 'node node_modules/tsx/dist/cli.mjs server/index.ts';

// Assembles e2e/.data and checks the client is built. Runs here rather than in
// globalSetup because Playwright starts webServer during plugin setup, which
// happens first — see the header of prepareData.ts.
const { dataDir, modulesDir } = prepareE2eData();

// What each server writes (presenter sessions in present.db, logs, plugin data): a fresh directory per
// server and per run, never the checkout's apps/web/data. Sessions used to pile up there across runs until
// the store's cap (200 active) answered every new one with 503. Only the main process clears it; the
// workers load this config too, while the servers are running.
const stateDir = (port: string) => join(dataDir, `state-${port}`);
if (!process.env.TEST_WORKER_INDEX) {
  for (const port of [E2E_PORT, E2E_PWA_PORT]) rmSync(stateDir(String(port)), { recursive: true, force: true });
}

function serverEnv(port: string, pwa: '0' | '1'): Record<string, string> {
  return {
    PORT: port,
    NO_AUTH: '1',
    DISABLE_RATE_LIMIT: '1',
    FEATURE_PWA: pwa,
    BIBLE_DATA_DIR: dataDir,
    BIBLE_MODULES_DIR: modulesDir,
    BIBLE_APP_STATE_DIR: stateDir(port),
  };
}

export default defineConfig({
  testDir: './tests',
  // Runs after webServer is up — see the header of globalSetup.ts.
  globalSetup: './globalSetup.ts',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: PLAIN_URL,
    headless: true,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tablet-chrome',
      use: {
        viewport: { width: 1024, height: 768 },
        hasTouch: false,
      },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  // Two servers on the same data: 3100 is the default deployment (PWA off, so
  // every other spec runs against a plain website), 3101 has `features.pwa` on
  // for pwa-e2e.spec.ts. They are separate origins, so a worker installed by
  // one can never leak into the other.
  webServer: [
    {
      // tsx's own entry run by node: not the bare `tsx` in node_modules/.bin, a
      // shell script with no Windows counterpart, and not `pnpm run`, which
      // (pnpm 11+) starts the script in a process group of its own, so the kill
      // Playwright sends its webServer's group at the end of the run misses the
      // server and the run hangs instead of exiting. The environment goes in
      // `env` because `FOO=1 cmd` is POSIX shell syntax that cmd.exe reads as a
      // command name.
      command: SERVER_COMMAND,
      cwd: packageRoot,
      env: serverEnv(String(E2E_PORT), '0'),
      // Wait for the app to answer, not merely for the port to be bound.
      url: `${PLAIN_URL}/api/health`,
      // Deliberately not reusing: a server already on 3100 was started with some
      // other data directory and build, and silently testing against it is how a
      // green run stops meaning anything. Set PW_REUSE_SERVER=1 to opt in while
      // iterating on a single spec.
      reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
      // A first run on a fresh clone builds the keyword indexes before the server
      // answers (minutes on a slow or busy disk), so 60 s was not enough.
      timeout: 300000,
      stdout: 'pipe',
      stderr: 'pipe',
      // SIGTERM first, so the server closes its databases; SIGKILL after 10 s.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
    {
      command: SERVER_COMMAND,
      cwd: packageRoot,
      env: serverEnv(String(E2E_PWA_PORT), '1'),
      url: `${PWA_URL}/api/health`,
      reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
      // A first run on a fresh clone builds the keyword indexes before the server
      // answers (minutes on a slow or busy disk), so 60 s was not enough.
      timeout: 300000,
      stdout: 'pipe',
      stderr: 'pipe',
      // SIGTERM first, so the server closes its databases; SIGKILL after 10 s.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    },
  ],
});
