/**
 * The Genealogy web binding (entry-chunk code): a lazy loader and a boot probe.
 * The probe only asks for activation after first paint, because the module's
 * code registers the Study tab, the phone section and the Topics action; the
 * family tree itself loads when its tab or sheet is first opened.
 */
import type { WebFeatureModule } from '../moduleHost';
import { genealogyManifest } from './manifest';

export const genealogyModule: WebFeatureModule = {
  manifest: genealogyManifest,
  binding: { id: 'genealogy', load: () => import('./module') },
  probe: () => ({ activate: true }),
};
