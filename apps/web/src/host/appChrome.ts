/**
 * Apps that draw their own top bar (and put an `AppSwitchSlot` and a way back
 * in it): their descriptor says `ownChrome`. Every other app on the phone
 * layout gets the shell's "Back to Study" bar (`AppTopBar`).
 */
import type { AppId } from '@bible/core/browser';
import { appRegistry } from './appHost';

export function appHasOwnChrome(id: AppId): boolean {
  return appRegistry.get(id)?.ownChrome === true;
}
