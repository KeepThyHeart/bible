/**
 * Entity actions: buttons a feature module adds to the Topics pane's entity detail view
 * (for example "Show family tree" on a person). A generic slot: the host renders whatever is
 * registered for the entity's category, and a module registers its action in `activate()`
 * (pushing the disposable into `ctx.subscriptions`), so the button vanishes when the module is off.
 */
import { ContributionRegistry } from '@bible/core/browser';
import type { ContributionItem, Disposable } from '@bible/core/browser';

export interface EntityActionTarget {
  readonly id: string;
  readonly category: string;
}

export interface EntityAction extends ContributionItem {
  /** Entity categories (`people`, `places`, ...) the action applies to. */
  readonly categories: readonly string[];
  /** Catalog key of the button label. It must be in `ui.json`: it renders before the module's strings load. */
  readonly labelKey: string;
  readonly testId?: string;
  run(entity: EntityActionTarget): void;
}

export const entityActions = new ContributionRegistry<EntityAction>('entityActions');

/** Register an action on behalf of a built-in module. */
export function registerEntityAction(moduleId: string, action: EntityAction): Disposable {
  return entityActions.register(action, { kind: 'builtin', moduleId });
}
