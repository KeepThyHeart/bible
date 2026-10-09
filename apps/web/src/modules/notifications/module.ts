/**
 * Lazy half of the Notifications module (web): starts the tier-1 reminders (notifications while a
 * tab is open). It runs after first paint (the binding's probe), where the shell used to import it
 * during boot. The verse-of-the-day provider is resolved at fire time only.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { getShellContext } from '../../host/appHost';
import { getOfflineBible } from '../../boot/offlineBible';
import { getWebReminders, setVerseOfTheDayFetcher, startWebReminders } from './webReminders';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  setVerseOfTheDayFetcher(async () => (await getOfflineBible(getShellContext())).getVerseOfTheDay());
  ctx.subscriptions.push({
    dispose() {
      // Switched off at runtime: stop the timers and the leader lock.
      getWebReminders().stop();
    },
  });
  try {
    await startWebReminders();
  } catch (err) {
    console.warn('[Notifications] Reminders failed to start:', err);
  }
}
