/**
 * Wires module i18n namespaces (`contributes.i18nNamespace`, task 0113) to the
 * catalog loader.
 *
 * Policy: a namespace's files (`locales/<locale>/<ns>.json`) are NOT read by
 * `loadAll()`. They load lazily, on the first `t()` of a key under `<ns>.` or
 * when a module's activation calls `i18n.loadNamespace(ns)`, whichever is first.
 * Keys stay fully qualified (`quiz.title`) in the same key space as `ui.json`.
 *
 * Call `bindModuleNamespaces(modulePoints.i18nNamespace, loader)` before
 * `loader.loadAll()` so the namespaces are known when the catalogs are listed.
 * The registry may fill later (modules reconcile after boot); each namespace that
 * appears is registered as it does.
 */
import type { I18nNamespaceContribution, ContributionRegistry } from '@bible/core/browser';
import type { LocaleCatalogLoader } from '../../services/LocaleCatalogLoader';

/** Returns the unsubscribe function. */
export function bindModuleNamespaces(
  registry: ContributionRegistry<I18nNamespaceContribution>,
  loader: Pick<LocaleCatalogLoader, 'registerLazyNamespace'>,
): () => void {
  const seen = new Set<string>();
  const sync = () => {
    for (const ns of registry.list()) {
      if (seen.has(ns.id)) continue;
      seen.add(ns.id);
      loader.registerLazyNamespace(ns.id);
    }
  };
  sync();
  return registry.subscribe(sync);
}
