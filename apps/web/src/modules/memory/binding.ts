/**
 * Scripture Memory on the web (task 0114 M3): registered, and hidden.
 *
 * The web saves no user content in the browser until accounts exist (0063), and memory is all user
 * content, so the shared manifest's `platforms: ['desktop']` keeps it off here: the host lists the
 * module as off for its platform and registers no app, verse action or strings. Nothing loads.
 *
 * Enabling it later is a manifest change (add `'web'` to `platforms`, here and on the app
 * descriptor) plus this binding gaining `apps`/`verseActionHandlers` over a browser `MemoryApi`
 * (the core and the UI package are platform-free: `MemoryService` over a `MemorySql`, then
 * `mountMemoryUi`). `memoryModule.test.ts` pins the hidden state.
 */
import { memoryManifest } from '@bible/memory/manifest';
import type { WebFeatureModule } from '../moduleHost';

export const memoryModule: WebFeatureModule = { manifest: memoryManifest };
