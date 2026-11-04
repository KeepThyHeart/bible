/**
 * Shared hooks for tests that boot the real desktop module host (`vi.resetModules()` + `registerBuiltinModules()`).
 *
 * Two things make those tests flaky on a busy machine, and both are fixed here rather than by re-running:
 *
 * 1. The first import of the host graph transforms hundreds of modules (a minute or more under load). Charged to
 *    whichever test runs first it times out, and the timed-out boot keeps running into the next test ("Feature module
 *    host is already added"). `installModuleBootHooks` pays for it once, in a `beforeAll` with its own budget.
 * 2. Startup activations are fire-and-forget (an idle callback). One still loading when a test ends finishes after the
 *    next test's `vi.resetModules()` and registers into THAT test's fresh registries (duplicate-contribution errors,
 *    a leaked entity action). `trackHost` records the host a test booted and the `afterEach` here drains it first.
 */
import { afterEach, beforeAll } from 'vitest';

let lastHost: { fire(event: string): Promise<void> } | null = null;

/** Call with the `moduleHost` namespace right after `registerBuiltinModules()` in a test's boot. */
export function trackHost(host: { featureModules: { fire(event: string): Promise<void> } }): void {
  lastHost = host.featureModules;
}

export function installModuleBootHooks(warm: () => Promise<unknown>): void {
  beforeAll(async () => {
    await warm();
  }, 300_000);
  afterEach(async () => {
    const host = lastHost;
    lastHost = null;
    await host?.fire('onStartupFinished');
  });
}
