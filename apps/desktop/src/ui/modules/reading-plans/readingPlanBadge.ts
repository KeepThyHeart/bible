/**
 * The Reading plans rail dot (task 0222 R3-3): shown while some plan has an unticked reading today, its tooltip
 * label naming it ("Today: Genesis 4-6"). Follows Memory's precedent (`modules/memory/module.ts`): one
 * `appRegistry.setBadge` call, cleared on dispose. Re-evaluated whenever the plan store changes (ticks, day
 * rollover and focus ticks all refresh it) and when the language changes.
 */
import { ReadingPlans } from '@bible/core/browser';
import { appRegistry } from '../../apps/appHost';
import { i18nService } from '../../services/I18nService';
import { ensureBookNames, formatReadingText, rpText } from './rpText';
import { useReadingPlanStore } from './useReadingPlanStore';

export const READING_PLANS_APP_ID = 'reading-plans';

interface Disposable { dispose(): void }

/** The badge for today's views, or undefined when nothing is due. */
export function readingPlanBadge(todays: readonly ReadingPlans.TodayView[]) {
  for (const view of todays) {
    if (!view.dueUnread) continue;
    const first = ReadingPlans.dueReadings(view)[0];
    if (!first) continue;
    return {
      kind: 'dot' as const,
      tone: 'neutral' as const,
      label: rpText('readingPlans.badge.today', 'Today: {reading}', { reading: formatReadingText(first.reading) }),
    };
  }
  return undefined;
}

export function activateReadingPlanBadge(): Disposable {
  let disposed = false;
  const apply = (): void => {
    if (disposed) return;
    appRegistry.setBadge(READING_PLANS_APP_ID, readingPlanBadge(useReadingPlanStore.getState().todays)); // allow-getstate: subscription callback
  };
  const unsubscribe = useReadingPlanStore.subscribe(apply);
  const locale = i18nService.onDidChangeLocale(() => { void ensureBookNames().then(apply); });
  void ensureBookNames().then(() => {
    if (disposed) return;
    apply();
    void useReadingPlanStore.getState().ensureLoaded(); // allow-getstate: one-off load
  });
  return {
    dispose: () => {
      disposed = true;
      unsubscribe();
      locale.dispose();
      appRegistry.setBadge(READING_PLANS_APP_ID, undefined);
    },
  };
}
