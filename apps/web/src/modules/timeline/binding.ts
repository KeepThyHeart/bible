/**
 * The Timeline web binding (entry-chunk code): lazy loaders and a boot probe.
 * The pane's view loads when its tab opens. The probe asks for activation
 * after first paint, because `module.tsx` registers the phone Study section;
 * the dataset itself is fetched only when the pane or sheet is first opened.
 */
import type { WebFeatureModule } from '../moduleHost';
import { timelineManifest } from './manifest';

export const timelineModule: WebFeatureModule = {
  manifest: timelineManifest,
  binding: {
    id: 'timeline',
    load: () => import('./module'),
    views: { 'pane:timeline': () => import('./TimelinePaneView') },
  },
  probe: () => ({ activate: true }),
};
