/**
 * The `test` every web e2e spec imports: Playwright's, plus a console guard.
 *
 * Any `console.error`, `console.warn` or uncaught page error in any page of the
 * test's browser context fails the test when it ends. The guard and its short,
 * explained allowlist live in the desktop e2e fixtures and are shared here, so
 * the two harnesses cannot drift apart on what counts as noise.
 *
 * A spec that provokes an error on purpose opts out for itself with
 * `test.use({ failOnConsoleProblems: false })` and a comment saying why. A single
 * test that provokes one does it with `expectConsoleProblems('why')`.
 */
import { test as base, expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { createConsoleGuard } from '../../desktop/e2e/fixtures/consoleGuard';

const EXPECTED = 'expected-console-problems';
/** What a deliberately failed request leaves in the console: the browser's own line, or the app's report of the failure. */
const PROVOKED = /Failed to load resource|net::ERR_|Failed to load module manifest|A preload for .* cross-world service worker/;

/** The running test provokes console errors on purpose (offline, a 404 probe...): the guard stays quiet for it alone. */
export function expectConsoleProblems(reason: string, info?: TestInfo): void {
  (info ?? base.info()).annotations.push({ type: EXPECTED, description: reason });
}

export const test = base.extend<{ failOnConsoleProblems: boolean }>({
  failOnConsoleProblems: [true, { option: true }],

  context: async ({ context, failOnConsoleProblems }, use, testInfo) => {
    const guard = createConsoleGuard();
    context.pages().forEach(p => guard.attach(p));
    context.on('page', p => guard.attach(p));
    await use(context);
    if (!failOnConsoleProblems) return;
    if (!testInfo.annotations.some(a => a.type === EXPECTED)) { guard.assertClean(); return; }
    // The test provokes failed requests on purpose; anything else (an exception, an app error) still fails it.
    const unexpected = guard.problems().filter(p => p.kind === 'pageerror' || !PROVOKED.test(p.text));
    if (unexpected.length > 0) {
      throw new Error(`Unexpected console problems in a test that expects failed requests:\n${unexpected.map(p => `  ${p.kind}: ${p.text.split('\n')[0]}`).join('\n')}`);
    }
  },
});

export { expect };
export type { Page, Locator, BrowserContext, APIRequestContext, TestInfo } from '@playwright/test';
