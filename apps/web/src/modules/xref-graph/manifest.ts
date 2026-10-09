/**
 * The Cross-ref graph feature-module manifest (web): data only, loaded at boot.
 * Ids, orders and label keys are shown before the module's code loads: never
 * rename them. The server half (`server/modules/xref-graph`) mounts
 * `/api/xref-graph`; with the server reporting the module off, the client drops all of this.
 */
import type { FeatureModuleManifest, VerseActionContribution } from '@bible/core/browser';

export const XREF_GRAPH_MODULE_ID = 'xref-graph';

/**
 * The verse context menu entry "Show connections". Group `study`: it renders right after the
 * built-in "Study" entry. `order` 10 keeps it ahead of "Similar" (order 30).
 */
export const xrefGraphVerseAction: VerseActionContribution = {
  id: 'xrefGraph.connections',
  title: { key: 'xrefGraph.showConnections', fallback: 'Show connections' },
  icon: { kind: 'builtin', name: 'fa-diagram-project' },
  order: 10,
  group: 'study',
};

export const xrefGraphManifest: FeatureModuleManifest = {
  id: XREF_GRAPH_MODULE_ID,
  platforms: ['web'],
  contributes: {
    verseActions: [xrefGraphVerseAction],
    i18nNamespace: 'xrefGraph',
    // Informational: the server half mounts this.
    serverRoutes: [{ id: 'xref-graph-api', path: '/api/xref-graph' }],
  },
};
