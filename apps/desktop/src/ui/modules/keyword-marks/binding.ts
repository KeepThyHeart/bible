/**
 * Keyword marks binding (entry-chunk code): lazy loaders only. The module code and the stores are
 * imported by nobody else.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { keywordMarksManifest, KEYWORD_MARKS_MODULE_ID, KEYWORD_SESSION_KEY } from './manifest';
import { registerKeywordCommands } from './keywordCommands';

export const keywordMarksModule: DesktopFeatureModule = {
  manifest: keywordMarksManifest,
  binding: {
    id: KEYWORD_MARKS_MODULE_ID,
    load: () => import('./module'),
  },
  commands: registerKeywordCommands,
  sessionKeys: [KEYWORD_SESSION_KEY],
};
