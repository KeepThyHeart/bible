import type { FeatureModuleManifest, VerseActionContribution } from '@bible/core/browser';

export const XREF_GRAPH_MODULE_ID = 'xref-graph';

/**
 * The verse context menu entry "Show connections" (also run by the `xrefGraph.open` command).
 * Group `study`: it renders in the study cluster of the menu. `order` 10 keeps it ahead of
 * "Similar" (order 30). The label stays in `ui.json` (shown before the module's code loads).
 */
export const xrefGraphVerseAction: VerseActionContribution = {
  id: 'xrefGraph.connections',
  title: { key: 'xrefGraph.showConnections', fallback: 'Show connections' },
  icon: { kind: 'builtin', name: 'diagram-project' },
  order: 10,
  group: 'study',
};

/**
 * Cross-ref graph (desktop; data only). No flag. Ids, orders and label keys are exactly what the
 * host declared before the module existed. The command-palette entry (`xrefGraph.open`) is
 * registered by `binding.commands`; its title stays in `commands.json`.
 */
export const xrefGraphManifest: FeatureModuleManifest = {
  id: XREF_GRAPH_MODULE_ID,
  platforms: ['desktop'],
  contributes: {
    verseActions: [xrefGraphVerseAction],
    i18nNamespace: 'xrefGraph',
  },
};
