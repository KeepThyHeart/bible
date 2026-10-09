/**
 * The Similar module's entry-chunk half (task 0126): lazy loaders only. `SimilarPane` is reached
 * through `views['panel:similar']` and must never be imported statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { similarManifest } from './manifest';
import { registerSimilarCommands } from './similarCommands';

export const similarModule: DesktopFeatureModule = {
  manifest: similarManifest,
  binding: {
    id: 'similar',
    load: () => import('./module'),
    views: { 'panel:similar': () => import('./SimilarPane') },
  },
  verseActionHandlers: [{ id: 'similar.find', load: () => import('./verseAction').then((m) => m.handler) }],
  commands: registerSimilarCommands,
};
