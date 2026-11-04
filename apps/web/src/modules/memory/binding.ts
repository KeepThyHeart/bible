/**
 * The Memory web binding: entry-chunk code, so only lazy loaders. The module code, the app (and with it
 * `@bible/memory/ui`), the verse-action handler and the user-DB client all load through dynamic `import()`.
 *
 * `probe` asks for activation after the first paint: the worker reaches the Bible data through the leader tab's main
 * thread (`memory.bible`), and any tab may be the leader, so every tab with the module on registers that host API.
 */
import type { WebFeatureModule } from '../moduleHost';
import { memoryWebManifest } from './manifest';

export const memoryWebModule: WebFeatureModule = {
  manifest: memoryWebManifest,
  binding: {
    id: 'memory',
    load: () => import('./module'),
  },
  apps: [
    {
      id: 'memory',
      load: () => import('./MemoryApp').then((m) => ({ View: m.MemoryApp })),
    },
  ],
  verseActionHandlers: [
    { id: 'memory.memorize', load: () => import('./memorize').then((m) => m.memorizeHandler) },
  ],
  probe: () => ({ activate: true }),
};
