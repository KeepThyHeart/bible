/**
 * Loads `contributes.i18nNamespace` catalogs (task 0113): every namespace a
 * module contributes is fetched (a lazy Vite chunk per locale) as soon as its
 * module is enabled, and again for a new language by `ensureLocaleLoaded`.
 * Call `startModuleNamespaceLoading()` once after `registerBuiltinModules()`.
 */
import type { ContributionRegistry, I18nNamespaceContribution } from '@bible/core/browser';
import { loadNamespace } from '../../i18n';
import { modulePoints } from '../moduleHost';

type Point = Pick<ContributionRegistry<I18nNamespaceContribution>, 'list' | 'subscribe'>;

/** Load every namespace now registered, and each one registered later. Returns the unsubscribe. */
export function startModuleNamespaceLoading(
  point: Point = modulePoints.i18nNamespace,
  load: (ns: string) => Promise<void> = loadNamespace,
): () => void {
  const seen = new Set<string>();
  const sync = () => {
    for (const item of point.list()) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      void load(item.id);
    }
  };
  sync();
  return point.subscribe(sync);
}
