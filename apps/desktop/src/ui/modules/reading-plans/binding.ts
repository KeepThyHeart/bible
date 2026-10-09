/**
 * Reading plans binding (entry-chunk code): lazy loaders only. The pane view is imported by nobody
 * else; the app form renders the same plans UI as the panel.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { readingPlansManifest } from './manifest';
import { registerReadingPlanCommands } from './readingPlanCommands';

export const readingPlansModule: DesktopFeatureModule = {
  manifest: readingPlansManifest,
  binding: {
    id: 'reading-plans',
    load: () => import('./module'),
    views: { 'panel:reading-plans': () => import('./ReadingPlans/ReadingPlansPane') },
  },
  apps: [
    {
      id: 'reading-plans',
      load: async () => ({ View: (await import('./ReadingPlans/ReadingPlansPane')).default }),
    },
  ],
  commands: registerReadingPlanCommands,
};
