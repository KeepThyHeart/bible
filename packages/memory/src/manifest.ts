/**
 * The memory feature module's manifest (task 0114): data only, loaded at boot
 * by every host that lists the module. Code loads on activation.
 *
 * - Desktop and web. On desktop this manifest is used as is. On the web it is
 *   registered by `apps/web/src/modules/memory` (a wrapper manifest) behind the
 *   `localUserDb` flag, because Memory needs the local user database there. No
 *   `flag` belongs here: it would switch Memory off on desktop (flag default
 *   false). The core and the UI are platform-free.
 * - Contributes the Memory app (`app:memory`, `#/@memory`) and the
 *   "Memorize" verse action. The desktop main process serves the core over
 *   `module:memory:*` IPC; its main registry ignores `contributes`.
 * - Titles are catalog keys with English fallbacks (desktop `ui` namespace).
 */
import type { AppDescriptor, FeatureModuleManifest, VerseActionContribution } from '@bible/core/browser';

export const MEMORY_MODULE_ID = 'memory';
export const MEMORY_APP_ID = 'memory';
export const MEMORIZE_ACTION_ID = 'memory.memorize';

export const memoryAppDescriptor: AppDescriptor = {
  id: MEMORY_APP_ID,
  title: { key: 'apps.memory.title', fallback: 'Memory' },
  icon: { kind: 'builtin', name: 'brain' },
  order: 30,
  platforms: ['desktop', 'web'],
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
  platforms: ['desktop', 'web'],
  contributes: {
    apps: [memoryAppDescriptor],
    verseActions: [memorizeVerseAction],
  },
};
