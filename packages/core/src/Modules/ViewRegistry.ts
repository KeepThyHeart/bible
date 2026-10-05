/**
 * The `views` contribution point: platform code (React/Preact components) for
 * contributed panel types, panes, preferences sections and so on. Registered
 * from a binding's `views` table when the module is enabled; nothing is
 * imported until `resolve(id)()` is called.
 */

import { ContributionRegistry } from './ContributionRegistry';
import type { ViewContribution } from './Contributions';
import { lazyOnce } from './types';
import type { OnceLoader } from './types';

export class ViewRegistry extends ContributionRegistry<ViewContribution> {
  private readonly loaders = new WeakMap<ViewContribution, OnceLoader<unknown>>();

  constructor() {
    super('views');
  }

  /** The memoised loader for a view, or undefined (module off, or no view bound). */
  resolve<C = unknown>(id: string): OnceLoader<C> | undefined {
    const item = this.get(id);
    if (!item) return undefined;
    let loader = this.loaders.get(item);
    if (!loader) {
      loader = lazyOnce(item.load);
      this.loaders.set(item, loader);
    }
    return loader as OnceLoader<C>;
  }
}
