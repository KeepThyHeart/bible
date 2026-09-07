/**
 * Stand-in for `virtual:pwa-register` when the PWA is disabled at build time.
 *
 * `vite-plugin-pwa` is what normally provides that module, and it is out of the
 * plugin graph when `ENABLE_PWA` is unset — so vite.config.ts aliases the import
 * here instead. This exists purely so `src/utils/appUpdate.ts` keeps its static
 * import and needs no `#ifdef`-style branching; nothing calls into it, because
 * `registerServiceWorker()` returns early on the same build flag.
 */

export function registerSW(_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
