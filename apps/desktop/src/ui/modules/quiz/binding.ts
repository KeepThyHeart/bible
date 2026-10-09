/**
 * The Quiz module's entry-chunk half (task 0125): lazy loaders only. `QuizPane` is
 * reached through `views['panel:quiz']` and the app's `load()` (both dynamic, so it
 * stays one separate chunk) and must never be imported statically elsewhere.
 */
import type { DesktopFeatureModule } from '../moduleHost';
import { quizManifest } from './manifest';
import { registerQuizCommands } from './quizCommands';

export const quizModule: DesktopFeatureModule = {
  manifest: quizManifest,
  binding: {
    id: 'quiz',
    load: () => import('./module'),
    views: { 'panel:quiz': () => import('./QuizPane') },
  },
  // The app form shows the same quiz UI as the panel; the stage supplies the chrome.
  apps: [{ id: 'quiz', load: async () => import('./QuizPane').then((m) => ({ View: m.default })) }],
  commands: registerQuizCommands,
};
