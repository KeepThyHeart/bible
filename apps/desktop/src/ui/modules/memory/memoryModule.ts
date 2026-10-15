/**
 * The Scripture Memory feature module in the desktop renderer (task 0114). Entry-chunk half: the
 * manifest/binding pair plus lazy loaders only. The host wiring (badge, push events, notices,
 * click routing) is `module.ts`, activated once the renderer is idle; the app view and
 * `@bible/memory/ui` are lazy chunks, loaded only when the Memory app opens. Everything registers
 * and unregisters with the module, so switching it off or on at runtime needs no reload.
 */
import { MEMORIZE_ACTION_ID, MEMORY_APP_ID, memoryManifest } from '@bible/memory/manifest';
import type { DesktopFeatureModule } from '../moduleHost';

export { onMemoryCardsRequest, openMemoryRoute, requestMemoryCards, takePendingMemoryCards } from './cardsRequest';

export const memoryModule: DesktopFeatureModule = {
  manifest: memoryManifest,
  binding: { id: 'memory', load: () => import('./module') },
  apps: [{ id: MEMORY_APP_ID, load: async () => ({ View: (await import('./MemoryAppView')).MemoryAppView }) }],
  verseActionHandlers: [{ id: MEMORIZE_ACTION_ID, load: () => import('./memorize') }],
};
