/**
 * The `test` every web e2e spec imports: Playwright's, plus a console guard.
 *
 * Any `console.error`, `console.warn` or uncaught page error in any page of the
 * test's browser context fails the test when it ends. The guard and its short,
 * explained allowlist live in the desktop e2e fixtures and are shared here, so
 * the two harnesses cannot drift apart on what counts as noise.
 *
 * A spec that provokes an error on purpose opts out for itself with
 * `test.use({ failOnConsoleProblems: false })` and a comment saying why.
 */
import { test as base, expect } from '@playwright/test';
import { createConsoleGuard } from '../../desktop/e2e/fixtures/consoleGuard';

export const test = base.extend<{ failOnConsoleProblems: boolean }>({
  failOnConsoleProblems: [true, { option: true }],

  context: async ({ context, failOnConsoleProblems }, use) => {
    const guard = createConsoleGuard();
    context.pages().forEach(p => guard.attach(p));
    context.on('page', p => guard.attach(p));
    await use(context);
    if (failOnConsoleProblems) guard.assertClean();
  },
});

export { expect };
export type { Page, Locator, BrowserContext, APIRequestContext, TestInfo } from '@playwright/test';
