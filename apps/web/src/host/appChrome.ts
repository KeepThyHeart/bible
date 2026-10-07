/**
 * Apps that draw their own top bar (and put an `AppSwitchSlot` and a way back
 * in it). Every other app on the phone layout gets the shell's "Back to Study"
 * bar (`AppTopBar`).
 */
import type { AppId } from '@bible/core/browser';

const OWN_CHROME = new Set<AppId>(['study', 'present']);

export function appHasOwnChrome(id: AppId): boolean {
  return OWN_CHROME.has(id);
}
