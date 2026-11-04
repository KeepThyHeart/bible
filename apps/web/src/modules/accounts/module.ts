/**
 * The Accounts module's code (lazy chunk): what `activate()` adds to the host.
 *
 * - `headerItems`: the sync status badge (a click opens the account dialog);
 * - `shellOverlays`: the account dialog and its toast;
 * - connects to the worker's sync host (`configure`, which resumes a remembered session) and keeps the status;
 * - `visibilitychange` -> sync now (throttled to once a minute);
 * - takes the e-mail link handoff (`/account/verify-email#token=`, `/account/reset-password#token=`), see `binding.ts`.
 *
 * The host activates this module only while flag `accounts` is on, so with it off nothing is registered and the
 * worker is never opened by this module.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { headerItems, shellOverlays } from '../../host/slots';
import { takeAccountHandoff } from './binding';
import type { AccountHandoff } from './binding';
import { AccountDialog } from './AccountDialog';
import { HeaderSyncBadge } from './HeaderSyncBadge';
import { accountStore } from './instance';
import type { AccountStore } from './accountStore';

/** Act on a taken handoff once the store is connected. */
export async function applyHandoff(store: AccountStore, h: AccountHandoff): Promise<void> {
  await store.start();
  if (h.kind === 'verify-email') await store.verifyEmail(h.token);
  else store.beginReset(h.token);
}

export function activate(ctx: FeatureModuleContext): void {
  ctx.subscriptions.push(
    headerItems.register(HeaderSyncBadge),
    shellOverlays.register(AccountDialog),
  );
  const onVisible = () => {
    if (document.visibilityState === 'visible') accountStore.onVisible();
  };
  document.addEventListener('visibilitychange', onVisible);
  ctx.subscriptions.push({
    dispose() {
      document.removeEventListener('visibilitychange', onVisible);
      accountStore.dispose();
    },
  });
  const handoff = takeAccountHandoff();
  void accountStore.start().then(() => (handoff ? applyHandoff(accountStore, handoff) : undefined));
}
