/**
 * The `apps` contribution point (task 0080): every registered app, plus the
 * two pieces of live status the host and the surfaces need, badge and busy.
 *
 * Built-in feature modules register through the feature-module host
 * (`contributes.apps`); extensions (M3) through their adapter with an
 * `extension` source. Surfaces never read this directly: they read
 * `selectNavItems()` (M2), which applies order prefs, `when` and platform.
 */

import { ContributionRegistry } from '../Modules/ContributionRegistry';
import type { ContributionEntry } from '../Modules/ContributionRegistry';
import type { ReadableStore } from '../Ui/ReadableStore';
import { normalizeBadge } from './AppDescriptor';
import type { AppBadge, AppDescriptor, AppId } from './AppDescriptor';

export interface AppRegistryEntry extends ContributionEntry<AppDescriptor> {
  readonly badge?: AppBadge;
  readonly busy: boolean;
}

export interface AppRegistryState {
  /** Sorted by order, then id. */
  readonly apps: readonly AppRegistryEntry[];
}

export interface IAppRegistry {
  get(id: AppId): AppDescriptor | undefined;
  has(id: AppId): boolean;
  list(): readonly AppDescriptor[];
  getBadge(id: AppId): AppBadge | undefined;
  isBusy(id: AppId): boolean;
  /** Set or clear (undefined) an app's badge. Ignored for an unknown id. */
  setBadge(id: AppId, badge: AppBadge | undefined): void;
  /** Report whether the app is doing something that must keep it mounted. Ignored for an unknown id. */
  setBusy(id: AppId, busy: boolean): void;
  readonly state: ReadableStore<AppRegistryState>;
}

export class AppRegistry extends ContributionRegistry<AppDescriptor> implements IAppRegistry {
  private readonly badges = new Map<AppId, AppBadge>();
  private readonly busyIds = new Set<AppId>();
  private appState: AppRegistryState = { apps: [] };

  readonly state: ReadableStore<AppRegistryState> = {
    subscribe: (listener) => this.subscribe(listener),
    getSnapshot: () => this.appState,
  };

  constructor() {
    super('apps');
  }

  getBadge(id: AppId): AppBadge | undefined {
    return this.badges.get(id);
  }

  isBusy(id: AppId): boolean {
    return this.busyIds.has(id);
  }

  setBadge(id: AppId, badge: AppBadge | undefined): void {
    if (!this.has(id)) return;
    const next = normalizeBadge(badge);
    const prev = this.badges.get(id);
    if (sameBadge(prev, next)) return;
    if (next) this.badges.set(id, next);
    else this.badges.delete(id);
    this.changed();
  }

  setBusy(id: AppId, busy: boolean): void {
    if (!this.has(id)) return;
    if (busy === this.busyIds.has(id)) return;
    if (busy) this.busyIds.add(id);
    else this.busyIds.delete(id);
    this.changed();
  }

  protected override onDidRemove(entry: ContributionEntry<AppDescriptor>): void {
    this.badges.delete(entry.item.id);
    this.busyIds.delete(entry.item.id);
  }

  protected override buildSnapshot(sorted: readonly ContributionEntry<AppDescriptor>[]): void {
    this.appState = {
      apps: sorted.map((e) => ({
        ...e,
        badge: this.badges.get(e.item.id),
        busy: this.busyIds.has(e.item.id),
      })),
    };
  }
}

function sameBadge(a: AppBadge | undefined, b: AppBadge | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.value === b.value && a.tone === b.tone && a.label === b.label;
}
