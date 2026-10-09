import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'off' },
  webServer: {
    command: 'node build.mjs && node scripts/build-static.mjs --db=test/fixtures/mini.db --out=e2e/.data --gzip && node e2e/server.mjs',
    url: 'http://127.0.0.1:4173/demo/article.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 5'] }, grep: /@phone/ },
  ],
});
