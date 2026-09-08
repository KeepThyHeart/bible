/**
 * Electron Fixture for Playwright E2E Tests
 *
 * This fixture provides a custom test setup for launching and managing
 * the Electron app during E2E tests.
 */

import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Custom fixture types
type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

// Path to the built Electron main process
const MAIN_JS_PATH = path.resolve(__dirname, '../../out/main/index.js');

/**
 * Extended test with Electron fixtures
 */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use, testInfo) => {
    // Ensure the app is built
    if (!fs.existsSync(MAIN_JS_PATH)) {
      throw new Error(
        `Electron app not built. Run 'npm run build' first.\n` +
        `Expected path: ${MAIN_JS_PATH}`
      );
    }

    // Use a per-worker temp directory for Electron userData so that:
    //   1. Tests are isolated from each other (no shared session/user DB state)
    //   2. Each run starts with fresh default state (John 3, no saved session)
    // The directory is passed via ELECTRON_USER_DATA and main.ts calls
    // app.setPath('userData', ...) before app.whenReady() so all
    // app.getPath('userData') calls (sharedUserDb, diagnostics, etc.) use it.
    const userDataDir = path.join(os.tmpdir(), 'bible-e2e', `worker-${testInfo.workerIndex}`);

    // Delete entire userData dir so each test starts from scratch.
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true });
    }
    fs.mkdirSync(userDataDir, { recursive: true });

    // Launch Electron with specific environment
    // Note: Electron windows cannot be fully hidden during Playwright tests,
    // but we can minimize impact by keeping the window in background
    const app = await electron.launch({
      args: [
        // Use basic password store to avoid system keyring prompts during tests
        '--password-store=basic',
        // Disable sandbox to avoid SUID permission issues in test environments.
        // app.commandLine.appendSwitch('no-sandbox') in main.ts fires after Playwright's
        // loader.js has already spawned the zygote process, so the flag must be passed
        // here to take effect before the renderer sandbox is set up.
        '--no-sandbox',
        // Avoid using /dev/shm for shared memory. On some Linux setups the Chromium
        // renderer FATAL-crashes when trying to mmap a file in /dev/shm, even when
        // /dev/shm has correct permissions, because the sandbox namespace setup fails.
        '--disable-dev-shm-usage',
        MAIN_JS_PATH,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        // Use a test-specific user data directory to isolate tests
        ELECTRON_USER_DATA: userDataDir,
      },
    });

    await use(app);

    // Cleanup: close the app after test
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    // Wait for the first window to open
    const window = await electronApp.firstWindow();

    // Wait for the app to fully load BEFORE minimizing.
    // Minimizing before the React app renders can cause a blank window because
    // Electron may suspend rendering for off-screen minimized windows.
    try {
      await window.waitForSelector('[data-testid="app-loaded"]', { timeout: 30000 });
    } catch {
      // Fallback: wait for Bible content to appear (indicates app is ready)
      await window.waitForSelector('.bible-pane, .verse, [data-testid="bible-pane"]', { timeout: 30000 });
    }

    // The sleep this replaces was covering the gap between `app-loaded` (the
    // React tree mounting) and dockview actually laying out its panels. Waiting
    // on the tab strip states that condition directly, and it is the condition
    // every test depends on.
    await window
      .waitForSelector('.dockview-tab-content', { timeout: 20000 })
      .catch(() => undefined);

    await dismissFirstRunDialog(window);

    await use(window);
  },
});

/**
 * Get past the first-run onboarding dialog.
 *
 * Every test starts from a wiped `userData`, so the language/starter-pack
 * dialog opens on every launch - and it is modal: a `fixed inset-0 z-50`
 * overlay across the whole window. Its scrim is only `bg-black/40`, so
 * everything behind it stays *visible*, which is why `toBeVisible()`
 * assertions kept passing while every click silently landed on the scrim
 * instead of its target. That is what made the failures so confusing: a test
 * would confirm the Commentary tab existed, click it, and then be told the
 * Commentary pane did not exist - because the tab was never actually
 * activated. `{ force: true }` does not help; forcing skips actionability
 * checks but still dispatches the event at the point, where the overlay is.
 *
 * Dismissed here rather than per spec so no future test has to rediscover it.
 * The dialog arrived with the language starter packs and nothing in `e2e/` was
 * taught about it.
 *
 * Deliberately NOT the welcome bar, which is a separate, non-modal first-run
 * affordance that `chrome-bands.spec.ts` measures on purpose.
 *
 * Tolerant of absence: a spec that seeds `bible.onboarding.languageChosen`, or
 * a future build that drops the dialog, must not start failing here.
 */
async function dismissFirstRunDialog(window: Page): Promise<void> {
  const dialog = window.locator('[data-testid="first-run-language-dialog"]');

  const appeared = await dialog
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;

  // Two steps - choose a language ("Continue"), then suggested content
  // ("Start reading") - and it opens straight on the second when only one
  // language is selectable. Advance through whichever step is on screen rather
  // than assuming either shape, so this keeps working if the language question
  // comes back.
  // "done" first, and both must be VISIBLE to count: the two steps' buttons can
  // both be in the DOM at once, so matching them with one selector and taking
  // `.first()` picked "continue" by document order and clicked a button that
  // was not on screen - which advanced nothing and cost a timeout per attempt.
  for (let step = 0; step < 4; step++) {
    const done = window.locator('[data-testid="first-run-language-done"]:visible');
    const advance = (await done.count()) > 0
      ? done.first()
      : window.locator('[data-testid="first-run-language-continue"]:visible').first();

    if (await advance.count() === 0) break;
    await advance.click();

    const gone = await dialog
      .waitFor({ state: 'detached', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (gone) return;
  }

  // Still up after advancing through every step it offers: fail loudly here
  // rather than let the test report a confusing "element not found" for
  // whatever it was really trying to click.
  await dialog.waitFor({ state: 'detached', timeout: 5000 });
}

export { expect } from '@playwright/test';
// Re-exported because every spec imports `Page` alongside `test`/`expect`
// from this module. It resolved at run time only because Playwright's
// transpiler erases type-only imports.
export type { Page } from '@playwright/test';
