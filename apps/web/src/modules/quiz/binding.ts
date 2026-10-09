/**
 * The Quiz web binding: entry-chunk code, so only lazy loaders. The pane view,
 * the app and the module code load when the tab, the app or the phone Study
 * pane first needs them. Never import them statically from anywhere else.
 */
import type { WebFeatureModule } from '../moduleHost';
import { quizManifest } from './manifest';

export const quizModule: WebFeatureModule = {
  manifest: quizManifest,
  binding: {
    id: 'quiz',
    load: () => import('./module'),
    views: { 'pane:quiz': () => import('./QuizPaneView') },
  },
  apps: [{ id: 'quiz', load: () => import('./QuizApp').then((m) => ({ View: m.QuizApp })) }],
};
