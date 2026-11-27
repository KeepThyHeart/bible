/**
 * The opt-in "Check for updates at startup" (task 0234).
 *
 * Runs once per launch, only when the user has ticked the preference
 * themselves (default off), and only when "Allow web requests" is on. It makes
 * the same single check as Check for Updates and then, at most, shows a toast
 * - it never downloads or installs (those are separate IPC calls this file
 * never makes) and never opens a dialog by itself.
 */

import { useNetworkStore } from '../stores/useNetworkStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useToastStore } from '../stores/useToastStore';
import { unwrap } from './ipcResult';

export type StartupUpdateCheckResult = 'disabled' | 'offline' | 'unavailable' | 'up-to-date' | 'update-available' | 'error';

/** @param message Builds the toast text for a newer version (the caller owns the i18n). */
export async function runStartupUpdateCheck(
  message: (version: string) => string
): Promise<StartupUpdateCheckResult> {
  if (!usePreferencesStore.getState().checkUpdatesAtStartup) return 'disabled'; // allow-getstate: one-shot startup task

  const network = useNetworkStore.getState(); // allow-getstate: one-shot startup task
  await network.load();
  if (!useNetworkStore.getState().allowWebRequests) return 'offline'; // allow-getstate: one-shot startup task

  const updates = window.electron?.updates;
  if (!updates) return 'unavailable';
  try {
    const info = await unwrap(updates.getInfo());
    if (!info.configured || info.offline) return info.offline ? 'offline' : 'unavailable';
    const outcome = await unwrap(updates.check({ skipBlocklist: true }));
    if (outcome.status === 'update-available') {
      useToastStore.getState().addToast(message(outcome.latestVersion), 'info', 15000); // allow-getstate: one-shot startup task
      return 'update-available';
    }
    return outcome.status === 'up-to-date' ? 'up-to-date' : outcome.status === 'offline' ? 'offline' : 'error';
  } catch {
    return 'error'; // a failed background-ish check says nothing; the manual check reports errors
  }
}
