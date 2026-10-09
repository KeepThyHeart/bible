/**
 * The Similar passages feature-module manifest (desktop; data only, task 0126). It has no flag:
 * the desktop always offers the feature when the data is installed (the module detects that
 * and sets the `similarAvailable` when-context key). Ids, orders and label keys are exactly what
 * the host manifests (`host/panels.ts`) and `VerseContextMenu` declared. The labels stay in
 * `ui.json` (they show before the module's code loads); the rest of the `similar.*` strings
 * live in the `similar` namespace.
 *
 * `onStartupFinished`: the availability probe and the verse-menu entry's condition must be ready
 * without opening anything, so the small `module.ts` activates after the first paint.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const similarManifest: FeatureModuleManifest = {
  id: 'similar',
  platforms: ['desktop'],
  activationEvents: ['onStartupFinished'],
  contributes: {
    panelTypes: [{ id: 'similar', title: { key: 'paneName.similar', fallback: 'Similar' }, order: 64 }],
    verseActions: [
      {
        id: 'similar.find',
        title: { key: 'ui.verseContextMenu.findSimilar', fallback: 'Find similar passages' },
        icon: { kind: 'builtin', name: 'similar' },
        group: 'study',
        order: 30,
        when: 'similarAvailable',
      },
    ],
    i18nNamespace: 'similar',
  },
};
