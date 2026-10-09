/**
 * The Cross-ref graph desktop binding (entry-chunk code): lazy loaders only. The module code (the
 * dialog overlay) and the verse action handler load when "Show connections" first runs, from the
 * verse menu, the Study pane or the `xrefGraph.open` command.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { xrefGraphManifest } from './manifest';
import { registerXrefGraphCommands } from './xrefGraphCommands';

export const xrefGraphModule: DesktopFeatureModule = {
  manifest: xrefGraphManifest,
  binding: { id: 'xref-graph', load: () => import('./module') },
  verseActionHandlers: [
    { id: 'xrefGraph.connections', load: () => import('./verseAction').then((m) => m.showConnectionsHandler) },
  ],
  commands: registerXrefGraphCommands,
};
