import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true, // Run tests across files in parallel
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4, // Parallel Electron instances (isolated per worker)
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],

  timeout: 60000, // Electron apps need longer timeouts
  expect: {
    timeout: 10000,
  },

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
    },
  ],

  // Output folder for test artifacts
  outputDir: path.join(__dirname, 'test-results'),
});
