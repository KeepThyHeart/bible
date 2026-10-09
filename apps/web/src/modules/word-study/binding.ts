/**
 * The Word study web binding: entry-chunk code, so only lazy loaders. The pane
 * view and the module code load when the tab, the phone view or an "open Word
 * study" request first needs them. Never import them statically from anywhere else.
 */
import type { WebFeatureModule } from '../moduleHost';
import { wordStudyManifest } from './manifest';

export const wordStudyModule: WebFeatureModule = {
  manifest: wordStudyManifest,
  binding: {
    id: 'word-study',
    load: () => import('./module'),
    views: { 'pane:wordStudy': () => import('./WordStudyPaneView') },
  },
};
