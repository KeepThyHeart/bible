/**
 * Lazy half of the Notifications module (desktop, task 0128). Activated once the renderer is idle
 * (`onStartupFinished`), it routes notification clicks that main sends (`open-target`) and picks up
 * one that arrived while the page was loading. Switching the module off removes the subscription.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { startNotificationOpenTargetRouting } from './openTarget';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(startNotificationOpenTargetRouting());
}
