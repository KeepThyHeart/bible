/**
 * The Genealogy (family tree) feature module, web half: data only, loaded at
 * boot. It contributes no app or pane: the family tree is a Study mode, so its
 * tab, phone section and Topics action are registered by `module.ts` in the
 * host slots while the module is on. The `genealogy` flag (which itself needs
 * `tagGraph`) is the off switch. The dataset is served by the tag graph's
 * `/api/taggraph/genealogy`, which is shared and stays in the host.
 */
import type { FeatureModuleManifest } from '@bible/core/browser';

export const genealogyManifest: FeatureModuleManifest = {
  id: 'genealogy',
  flag: 'genealogy',
  platforms: ['web'],
  contributes: { i18nNamespace: 'genealogy' },
};
