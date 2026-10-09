/**
 * The Similar module's code (lazy chunk): what `activate()` adds to the host.
 * It loads after first paint (boot probe), when the tab opens, or when the menu
 * entry runs.
 *
 * - starts the neighbour-table feature detection (one probe per page);
 * - defines the context keys `similar.available` (the tab) and `similar.menu`
 *   (the verse-menu entry: also false on the phone layout).
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { registerWhenKey, whenKeys } from '../../host/verseActionWhen';
import { isMobileLayout } from '../../utils/isMobileLayout';
import { similarAvailability } from './similarAvailability';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(
    registerWhenKey('similar.available', () => similarAvailability.available),
    registerWhenKey('similar.menu', () => similarAvailability.available && !isMobileLayout()),
    // The keys read the detection result: tell the tab strip and the menu when it changes.
    { dispose: similarAvailability.subscribe(() => whenKeys.invalidate()) },
  );
  void similarAvailability.probe();
}
