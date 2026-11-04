/**
 * The Accounts web binding: entry-chunk code, so only lazy loaders, a boot probe and the URL handoff taker. Never import
 * `./module` (or anything from `src/userdb`, `@bible/core` Sync) statically from here: the entry-chunk guard forbids it.
 *
 * The server's e-mails link to `<publicUrl>/account/verify-email#token=...` and `<publicUrl>/account/reset-password#token=...`
 * (`packages/sync-server/src/email/messages.ts`). `takeUrl` keeps the token in memory and rewrites the address bar to the app's base path (`/`)
 * before anything else runs, whether or not the module is on; `module.ts` picks it up with `takeAccountHandoff()`.
 */
import type { WebFeatureModule } from '../moduleHost';
import { loadNamespace } from '../../i18n';
import { accountsManifest } from './manifest';

export interface AccountHandoff {
  kind: 'verify-email' | 'reset-password';
  token: string;
}

let handoff: AccountHandoff | null = null;

/** The deployment's base path (`import.meta.env.BASE_URL`, e.g. `/bible/`); `/` when the app is served from the root. */
function basePath(): string {
  const b = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return b.startsWith('/') ? b : '/';
}

/**
 * Parse an address (path + hash) into a handoff; null when it is not one of the two e-mail links or has no token.
 * Under a base path (`BASE_PATH=/bible/`) the links are `/bible/account/...`: the base is stripped before matching.
 */
export function parseAccountUrl(pathname: string, hash: string, base: string = basePath()): AccountHandoff | null {
  const prefix = base.replace(/\/+$/, '');
  const rel = prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`)) ? pathname.slice(prefix.length) : pathname;
  const path = rel.replace(/\/+$/, '');
  const kind = path === '/account/verify-email' ? 'verify-email' : path === '/account/reset-password' ? 'reset-password' : null;
  if (!kind) return null;
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token ? { kind, token } : null;
}

function takeUrl(): void {
  if (typeof location === 'undefined') return;
  const found = parseAccountUrl(location.pathname, location.hash);
  if (!found) return;
  handoff = found;
  try {
    history.replaceState(null, '', basePath());
  } catch {
    /* the address bar keeps the link; the token is already taken */
  }
}

/** The handoff taken from the URL, once (then null). */
export function takeAccountHandoff(): AccountHandoff | null {
  const h = handoff;
  handoff = null;
  return h;
}

/** Test hook. */
export function setAccountHandoffForTests(h: AccountHandoff | null): void {
  handoff = h;
}

export const accountsModule: WebFeatureModule = {
  manifest: accountsManifest,
  binding: {
    id: 'accounts',
    load: () => import('./module'),
    views: {
      // The tab can open before the module's catalog has loaded, so wait for it here.
      'preferences:account': async () => {
        await loadNamespace('accounts');
        return import('./AccountSettingsView');
      },
    },
  },
  takeUrl,
  // Resumes a remembered session and picks up a handoff link after the first paint.
  probe: () => ({ activate: true }),
};
