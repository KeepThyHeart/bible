/**
 * The memory feature module's manifest (task 0114): data only, loaded at boot
 * by every host that lists the module. Code loads on activation.
 *
 * - Desktop only for now: on the web, memory is hidden until user content can
 *   be saved there (accounts, 0063). Enabling it later is a change to
 *   `platforms` here (and the app's own `platforms`); the core and the UI are
 *   platform-free.
 * - Contributes the Memory app (`app:memory`, `#/@memory`) and the
 *   "Memorize" verse action. The desktop main process serves the core over
 *   `module:memory:*` IPC; its main registry ignores `contributes`.
 * - Titles are catalog keys with English fallbacks (desktop `ui` namespace).
 */
import type { AppDescriptor, FeatureModuleManifest, VerseActionContribution } from '@bible/core/browser';

export const MEMORY_MODULE_ID = 'memory';
/** The old extension this module replaces (its data is imported once; see `legacyImport.ts`). */
export const LEGACY_EXTENSION_ID = 'ext.bible-app.scripture-memory';
export const MEMORY_APP_ID = 'memory';
export const MEMORIZE_ACTION_ID = 'memory.memorize';

export const memoryAppDescriptor: AppDescriptor = {
  id: MEMORY_APP_ID,
  title: { key: 'apps.memory.title', fallback: 'Memory' },
  icon: { kind: 'builtin', name: 'brain' },
  order: 30,
  platforms: ['desktop'],
  lifecycle: { keepAlive: 'while-busy', restore: 'reopen' },
};

export const memorizeVerseAction: VerseActionContribution = {
  id: MEMORIZE_ACTION_ID,
  title: { key: 'verseActions.memorize', fallback: 'Memorize' },
  icon: { kind: 'builtin', name: 'brain' },
  appId: MEMORY_APP_ID,
  order: 30,
  group: 'app',
};

export const memoryManifest: FeatureModuleManifest = {
  id: MEMORY_MODULE_ID,
  platforms: ['desktop'],
  // Idle after startup: the badge, notices and notification-click routing (`module.ts`).
  activationEvents: ['onStartupFinished'],
  contributes: {
    apps: [memoryAppDescriptor],
    verseActions: [memorizeVerseAction],
    i18nNamespace: 'memory',
  },
};
