/**
 * Platform bindings: the code half of an app (task 0080).
 *
 * The descriptor (data) is registered at boot; the binding says how to get
 * the view and set the app up, *lazily*:
 *
 * ```ts
 * // apps/web/src/apps/registerBuiltinApps.ts
 * const presentBinding: AppBinding<ComponentType> = {
 *   id: 'present',
 *   load: async () => {
 *     const m = await import('./present/PresenterApp');
 *     return { View: m.PresenterApp, activate: m.activatePresenter };
 *   },
 *   companion: { when: 'busy', load: async () => ({ View: (await import('../components/Present/PresentBar')).PresentBar }) },
 * };
 * ```
 *
 * `View` is generic: core never sees a framework. Web binds Preact
 * components, desktop React components (eagerly imported from disk, same
 * shape), an extension app (M3) an iframe host component.
 *
 * `createAppBindingController` wires bindings to an `IAppHostState`: it loads
 * the chunk and runs `activate(ctx)` inside the host's will-activate phase, so
 * the view is ready (and the app's stores initialised) when the activation
 * commits, and runs `deactivate()` when the host unmounts the app.
 */

import { lazyOnce, toDisposable } from '../Modules/types';
import type { Disposable, OnceLoader } from '../Modules/types';
import type { AppId } from './AppDescriptor';
import type { ActivateSource, IAppHostState, WillActivateEvent } from './AppHostState';

/** What an app's `activate()` receives. */
export interface AppActivationContext {
  readonly appId: AppId;
  /** The route the app opens at ('' when none). */
  readonly route: string;
  readonly source: ActivateSource;
  readonly host: IAppHostState;
  /** False once the activation that triggered this setup has been superseded. */
  isCurrent(): boolean;
}

/** The result of an app's `load()`: its view plus optional lifecycle hooks. */
export interface LoadedApp<View, Ctx = AppActivationContext> {
  readonly View: View;
  /**
   * Called when the app is mounted: on its first activation, and again after
   * an eviction. This is where it initialises its stores and services (lean
   * loading: nothing app-specific runs at shell boot). Must be safe to call
   * again after `deactivate()`. Awaited before the view is shown; a rejection
   * fails the activation.
   */
  activate?(ctx: Ctx): void | Promise<void>;
  /** Called when the host unmounts the app (eviction, feature switched off). */
  deactivate?(): void | Promise<void>;
}

/**
 * A slim strip an app shows inside Study (the Presenter's `PresentBar`).
 * Its code loads only while the condition holds.
 */
export interface AppCompanionBinding<View> {
  /** `busy`: only while the app reports busy. `always`: whenever the app is registered. */
  readonly when: 'busy' | 'always';
  load(): Promise<{ readonly View: View }>;
}

export interface AppBinding<View, Ctx = AppActivationContext> {
  readonly id: AppId;
  load(): Promise<LoadedApp<View, Ctx>>;
  readonly companion?: AppCompanionBinding<View>;
}

export interface AppBindingControllerOptions<View> {
  readonly host: IAppHostState;
  readonly bindings?: Iterable<AppBinding<View>>;
  /**
   * Fire the feature-module activation event for an app before its view
   * loads (`onApp:<id>`), so the module that contributes it is active first.
   * Wire to `FeatureModuleHost.fire`.
   */
  readonly fireActivationEvent?: (event: string) => Promise<void>;
  /** Errors from `deactivate()` and prefetches (which never throw to the caller). */
  readonly onError?: (error: unknown, appId: AppId, phase: 'deactivate' | 'prefetch') => void;
}

export interface AppBindingController<View> {
  /** Add a binding (e.g. an extension app later). Throws on a duplicate id. */
  add(binding: AppBinding<View>): Disposable;
  has(id: AppId): boolean;
  /** Start loading an app's chunk without activating it (idle, hover or focus prefetch). */
  prefetch(id: AppId): void;
  /** The loaded view, synchronously, once `load()` has resolved; undefined before. */
  getView(id: AppId): View | undefined;
  getCompanion(id: AppId): AppCompanionBinding<View> | undefined;
  /** True while the app's `activate()` has run and `deactivate()` has not. */
  isLive(id: AppId): boolean;
  dispose(): void;
}

interface Slot<View> {
  readonly binding: AppBinding<View>;
  readonly load: OnceLoader<LoadedApp<View>>;
}

export function createAppBindingController<View>(
  options: AppBindingControllerOptions<View>,
): AppBindingController<View> {
  const { host } = options;
  const slots = new Map<AppId, Slot<View>>();
  /** Apps whose `activate()` has completed (or is in flight) and not been deactivated. */
  const live = new Map<AppId, Promise<void>>();

  const add = (binding: AppBinding<View>): Disposable => {
    if (slots.has(binding.id)) throw new Error(`App binding "${binding.id}" is already registered`);
    const slot: Slot<View> = { binding, load: lazyOnce(() => binding.load()) };
    slots.set(binding.id, slot);
    return toDisposable(() => {
      if (slots.get(binding.id) === slot) slots.delete(binding.id);
    });
  };
  for (const b of options.bindings ?? []) add(b);

  const onWill = async (e: WillActivateEvent): Promise<void> => {
    const slot = slots.get(e.id);
    if (!slot) throw new Error(`No binding for app "${e.id}"`);
    if (options.fireActivationEvent) await options.fireActivationEvent(`onApp:${e.id}`);
    const loaded = await slot.load();
    const running = live.get(e.id);
    if (running) {
      // Already set up (or being set up by an earlier, possibly superseded,
      // request): wait for it rather than running activate twice.
      await running;
      return;
    }
    // A request that is already stale does not start the app's setup; the
    // request that superseded it will (if it targets this app).
    if (!e.isCurrent()) return;
    const ctx: AppActivationContext = {
      appId: e.id,
      route: e.route,
      source: e.source,
      host,
      isCurrent: e.isCurrent,
    };
    const run = Promise.resolve().then(() => loaded.activate?.(ctx));
    live.set(e.id, run);
    try {
      await run;
    } catch (err) {
      if (live.get(e.id) === run) live.delete(e.id);
      throw err;
    }
  };

  const onUnmount = (id: AppId): void => {
    if (!live.has(id)) return;
    live.delete(id);
    const loaded = slots.get(id)?.load.peek();
    if (!loaded?.deactivate) return;
    Promise.resolve()
      .then(() => loaded.deactivate?.())
      .catch((err: unknown) => options.onError?.(err, id, 'deactivate'));
  };

  const subs = [host.onWillActivate(onWill), host.onDidUnmount(onUnmount)];

  return {
    add,
    has: (id) => slots.has(id),
    prefetch(id) {
      const slot = slots.get(id);
      if (!slot) return;
      slot.load().catch((err: unknown) => options.onError?.(err, id, 'prefetch'));
    },
    getView: (id) => slots.get(id)?.load.peek()?.View,
    getCompanion: (id) => slots.get(id)?.binding.companion,
    isLive: (id) => live.has(id),
    dispose() {
      for (const s of subs) s.dispose();
      slots.clear();
      live.clear();
    },
  };
}
