/**
 * Timeline: activation code (lazy). Registers the `timeline.open` command in the app's command
 * registry; switching the module off disposes it with everything else in `subscriptions`.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { getModuleHostServices } from '../host/hostServices';
import { registerTimelineCommands } from './timelineCommands';

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  const services = getModuleHostServices();
  if (!services) return; // a window without a command registry (detached window)
  // The command's title and category live in this module's namespace: have them before it is listed.
  await services.i18n.loadNamespace('timeline');
  ctx.subscriptions.push(...registerTimelineCommands(services.registry));
}
