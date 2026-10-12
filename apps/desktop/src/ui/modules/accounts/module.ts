/**
 * Lazy half of the Accounts module (desktop, task 0150). Activated once the renderer is idle: it loads the sync
 * status and keeps it current from main's `statusChanged` events. Switching the module off removes the subscription.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { accountsClient } from './accountsClient';
import { useAccountsStore } from './useAccountsStore';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = accountsClient.on('statusChanged', (status) => useAccountsStore.getState().setStatus(status)); // allow-getstate: event handler
  } catch {
    return; // no module bridge (not running in Electron)
  }
  ctx.subscriptions.push({ dispose: unsubscribe });
  await useAccountsStore.getState().refreshStatus(); // allow-getstate: activation, outside render
}
