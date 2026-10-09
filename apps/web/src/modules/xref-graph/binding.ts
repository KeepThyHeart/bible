/**
 * The Cross-ref graph web binding: entry-chunk code, so only lazy loaders. The
 * module code (the dialog overlay) and the verse action handler load when the
 * "Show connections" entry first runs.
 */
import type { WebFeatureModule } from '../moduleHost';
import { xrefGraphManifest } from './manifest';

export const xrefGraphModule: WebFeatureModule = {
  manifest: xrefGraphManifest,
  binding: { id: 'xref-graph', load: () => import('./module') },
  verseActionHandlers: [
    { id: 'xrefGraph.connections', load: () => import('./verseAction').then((m) => m.showConnectionsHandler) },
  ],
};
