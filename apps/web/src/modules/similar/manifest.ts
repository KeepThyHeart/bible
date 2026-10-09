/**
 * The Similar-passages feature module, web half: data only, loaded at boot.
 * Ids are persisted or user-visible (`rightPaneMode: 'similar'`): never rename them.
 *
 * The tab and the menu entry exist only while the server offers the neighbour
 * table (feature detection): the module sets the `similar.available` /
 * `similar.menu` context keys once it is active (see `module.ts`). The menu
 * entry is also hidden on the phone layout (its target pane has no Similar view).
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const similarManifest: FeatureModuleManifest = {
  id: 'similar',
  platforms: ['web'],
  contributes: {
    paneModes: [{ id: 'similar', title: { key: 'rightPane.similar', fallback: 'Similar' }, order: 80, when: 'similar.available' }],
    verseActions: [
      {
        id: 'similar.find',
        title: { key: 'contextMenu.similar', fallback: 'Find similar passages' },
        icon: { kind: 'builtin', name: 'fa-clone' },
        group: 'study',
        order: 30,
        when: 'similar.menu',
      },
    ],
    i18nNamespace: 'similar',
  },
};
