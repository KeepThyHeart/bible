/**
 * The Accounts web binding: entry-chunk code, so only a lazy loader. Never import `./module` (or anything from
 * `src/userdb`, `@bible/core` Sync) statically from here: the entry-chunk guard forbids it.
 */
import type { WebFeatureModule } from '../moduleHost';
import { accountsManifest } from './manifest';

export const accountsModule: WebFeatureModule = {
  manifest: accountsManifest,
  binding: { id: 'accounts', load: () => import('./module') },
};
