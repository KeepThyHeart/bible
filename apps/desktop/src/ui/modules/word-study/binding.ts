/**
 * The Word study module's entry-chunk half: lazy loaders only. `WordStudyPane` is reached
 * through `views['panel:wordStudy']` (dynamic, so it stays a separate chunk) and must never be
 * imported statically elsewhere. The palette command is registered while the module is on; its
 * handler imports the panel code lazily.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { wordStudyManifest } from './manifest';
import { registerWordStudyCommands } from './wordStudyCommands';

export const wordStudyModule: DesktopFeatureModule = {
  manifest: wordStudyManifest,
  binding: {
    id: 'word-study',
    load: () => import('./module'),
    views: { 'panel:wordStudy': () => import('./WordStudyPane') },
  },
  commands: registerWordStudyCommands,
  // Saved panes (`ui.wordStudyPanels`) are kept whole while the module is off or not loaded yet.
  sessionKeys: ['wordStudyPanels'],
};
