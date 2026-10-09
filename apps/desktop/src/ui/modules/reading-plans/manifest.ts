/**
 * The Reading plans feature-module manifest (desktop only): data only, loaded at boot. Ids, orders
 * and keys are what `host/panels.ts` and `host/ui.ts` declared before the migration (task 0125):
 * the `reading-plans` panel type is persisted in saved layouts, so never rename it.
 *
 * `onStartupFinished`: the Bible pane's "today's reading" bar must appear for a user with an
 * enrolled plan without opening anything, so the module's small `module.ts` activates after the
 * first paint (it only registers the bar; the bar and the plans UI load lazily).
 */
import type { AppDescriptor, FeatureModuleManifest, NewTabTileContribution, PanelTypeContribution } from '@bible/core/browser';

export const READING_PLANS_MODULE_ID = 'reading-plans';

export const readingPlansPanelType: PanelTypeContribution = {
  id: 'reading-plans',
  title: { key: 'paneName.readingPlans', fallback: 'Reading plans' },
  order: 62,
};

export const readingPlansTile: NewTabTileContribution = {
  id: 'reading-plans',
  title: { key: 'newTabPage.type.readingPlans', fallback: 'Reading plans' },
  icon: { kind: 'builtin', name: 'reading-plans' },
  order: 55,
  target: { panelType: 'reading-plans' },
  keywords: ['plans', 'plan', 'reading'],
};

export const readingPlansApp: AppDescriptor = {
  id: 'reading-plans',
  title: { key: 'apps.readingPlans.title', fallback: 'Reading plans' },
  icon: { kind: 'builtin', name: 'calendar-check' },
  order: 30,
  platforms: ['desktop'],
  lifecycle: { keepAlive: 'never', restore: 'default' },
};

export const readingPlansManifest: FeatureModuleManifest = {
  id: READING_PLANS_MODULE_ID,
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    panelTypes: [readingPlansPanelType],
    newTabTiles: [readingPlansTile],
    apps: [readingPlansApp],
    i18nNamespace: 'readingPlans',
  },
};
