import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'path';
import { prepareE2eData } from './prepareData';

const packageRoot = resolve(import.meta.dirname, '..');

// Assembles e2e/.data and checks the client is built. Runs here rather than in
// globalSetup because Playwright starts webServer during plugin setup, which
// happens first — see the header of prepareData.ts.
const { dataDir, modulesDir } = prepareE2eData();

export default defineConfig({
  testDir: './tests',
  // Runs after webServer is up — see the header of globalSetup.ts.
  globalSetup: './globalSetup.ts',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3100',
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
  webServer: {
    // `npm run` rather than a path into node_modules/.bin: the bare `tsx` there
    // is a shell script with no Windows counterpart, and cmd.exe cannot run it.
    // The environment goes in `env` for the same reason — `FOO=1 cmd` is POSIX
    // shell syntax that cmd.exe reads as a command name.
    command: 'npm run e2e:server',
    cwd: packageRoot,
    env: {
      PORT: '3100',
      NO_AUTH: '1',
      DISABLE_RATE_LIMIT: '1',
      BIBLE_DATA_DIR: dataDir,
      BIBLE_MODULES_DIR: modulesDir,
    },
    // Wait for the app to answer, not merely for the port to be bound.
    url: 'http://localhost:3100/api/health',
    // Deliberately not reusing: a server already on 3100 was started with some
    // other data directory and build, and silently testing against it is how a
    // green run stops meaning anything. Set PW_REUSE_SERVER=1 to opt in while
    // iterating on a single spec.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 60000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
