/**
 * The Similar web binding (entry-chunk code): lazy loaders and a boot probe.
 * The probe asks for activation after first paint, because `module.ts` starts
 * the neighbour-table feature detection and defines the `when` keys that show
 * the tab and the menu entry; the pane and the handler load when first used.
 */
import type { WebFeatureModule } from '../moduleHost';
import { similarManifest } from './manifest';

export const similarModule: WebFeatureModule = {
  manifest: similarManifest,
  binding: {
    id: 'similar',
    load: () => import('./module'),
    views: { 'pane:similar': () => import('./SimilarPaneView') },
  },
  verseActionHandlers: [{ id: 'similar.find', load: () => import('./verseAction').then((m) => m.handler) }],
  probe: () => ({ activate: true }),
};
