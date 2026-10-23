/**
 * The Presenter module's entry-chunk half (task 0198): lazy loaders only. The app view is a
 * separate chunk, reached through `apps[].load()`; never import it statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { presentManifest } from './manifest';

export const presentModule: DesktopFeatureModule = {
  manifest: presentManifest,
  apps: [{ id: 'present', load: async () => import('./PresenterApp').then((m) => ({ View: m.PresenterApp })) }],
};
